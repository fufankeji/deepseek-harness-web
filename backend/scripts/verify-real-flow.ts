import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { AcceptanceRecord, CommandReceipt, HarnessEvent, ModelInfo, RuntimeInfo, SessionSummary, WorkspaceInfo } from "../src/contracts.js";
import { BridgeApp } from "../src/app.js";
import { CredentialStore } from "../src/secrets/credential-store.js";

const credentialFile = process.env.FF_CREDENTIAL_FILE;
if (!credentialFile) throw new Error("FF_CREDENTIAL_FILE must point to the user-authorized local credential file");

const projectRoot = resolve(import.meta.dirname, "../..");
const dataDir = verificationDataDir(projectRoot, "real-flow");
const acceptanceLedger = resolve(projectRoot, "backend/data/acceptance-ledger.sqlite");
const leakProbe = new CredentialStore();
await leakProbe.loadFromFile(credentialFile);
const apiKey = leakProbe.require().apiKey;

const app = new BridgeApp({
  host: "127.0.0.1",
  port: 0,
  dataDir,
  acceptanceLedger,
  credentialFile,
  projectRoot
});

let activeSessionId: string | undefined;
let activeRunId: string | undefined;
const startedAt = performance.now();

try {
  const address = await app.start();
  const runtime = await postJson<RuntimeInfo>(`${address.url}/api/runtime/probe`, {});
  assert.equal(runtime.status, "ready", "Pi runtime probe did not become ready");

  const model = await postJson<ModelInfo>(`${address.url}/api/model/connect`, {
    credentialSource: "configured-file",
    verify: true
  });
  assert.equal(model.status, "ready", "DeepSeek real connection check did not become ready");

  const workspace = await postJson<WorkspaceInfo>(`${address.url}/api/workspaces/acceptance`, {});
  assert.equal(workspace.status, "ready");
  assert.equal(workspace.git, true);

  const session = await postJson<SessionSummary>(`${address.url}/api/sessions`, {
    name: "真实验收 · Counter 修复"
  });
  activeSessionId = session.id;

  const eventStream = collectUntilSettled(`${address.url}/api/sessions/${encodeURIComponent(session.id)}/stream`);
  const receiptStartedAt = performance.now();
  const receipt = await postJson<CommandReceipt>(`${address.url}/api/sessions/${encodeURIComponent(session.id)}/runs`, {
    requestId: randomUUID(),
    text: [
      "修复当前工作区里的计数器错误。",
      "必须先分别使用 read 工具读取 src/counter.js 与 test.mjs，",
      "然后必须使用 edit 工具修复 src/counter.js 中的 increment，",
      "最后必须使用 bash 工具运行精确命令 node test.mjs。",
      "不要读取或修改其他文件，不要运行其他命令；测试通过后用一句中文说明结果。"
    ].join("\n")
  });
  const receiptLatencyMs = Math.round(performance.now() - receiptStartedAt);
  assert.equal(receipt.accepted, true, receipt.reason ?? "Task was rejected");
  assert.ok(receipt.runId, "Accepted task did not include a runId");
  activeRunId = receipt.runId;

  const streamedEvents = await eventStream;
  const runEvents = streamedEvents.filter((event) => event.runId === receipt.runId);
  const settled = runEvents.findLast((event) => event.kind === "run.settled");
  assert.equal(settled?.payload.status, "completed", `Run did not complete: ${JSON.stringify(settled?.payload)}`);

  const persisted = await getJson<{ events: HarnessEvent[] }>(
    `${address.url}/api/sessions/${encodeURIComponent(session.id)}/events`
  );
  const persistedRunEvents = persisted.events.filter((event) => event.runId === receipt.runId);
  const toolNames = unique(persistedRunEvents.flatMap((event) => {
    const name = event.payload.toolName;
    return typeof name === "string" ? [name] : [];
  }));
  for (const requiredTool of ["read", "edit", "bash"]) {
    assert.ok(toolNames.includes(requiredTool), `Required real tool was not observed: ${requiredTool}`);
  }
  assert.ok(persistedRunEvents.some((event) => event.kind === "message.delta" && event.updateMode === "delta"));
  assert.ok(persistedRunEvents.some((event) => event.kind === "tool.output" && event.updateMode === "snapshot"));
  assert.ok(persistedRunEvents.some((event) => event.kind === "message.completed" && event.updateMode === "final"));

  const changes = await getJson<{ changes: Array<{ path: string; status: string }> }>(`${address.url}/api/workspaces/changes`);
  assert.deepEqual(changes.changes.map((entry) => entry.path), ["src/counter.js"]);
  const diff = await getJson<{ unstaged: string; staged: string }>(
    `${address.url}/api/workspaces/diff?path=${encodeURIComponent("src/counter.js")}`
  );
  assert.match(diff.unstaged, /value \+ 1/);

  const recordsResult = await waitForAcceptanceRecord(address.url, receipt.runId);
  const record = recordsResult.records.find((entry) => entry.runId === receipt.runId);
  assert.ok(record, "Acceptance record was not retained");
  assert.equal(record.finalStatus, "completed");
  assert.equal(record.verification.passed, true, record.verification.output);
  assert.deepEqual(record.changedFiles, ["src/counter.js"]);

  const credentialLeaked = await directoryContains(dataDir, apiKey);
  assert.equal(credentialLeaked, false, "API key was found in persisted Bridge data");

  process.stdout.write(`${JSON.stringify({
    success: true,
    runtime: {
      nodeVersion: runtime.nodeVersion,
      harnessId: runtime.harnessId,
      harnessVersion: runtime.harnessVersion,
      adapter: runtime.displayName,
      modelId: model.modelId,
      credentialStorage: model.credentialStorage
    },
    commandProtocol: {
      receiptAccepted: receipt.accepted,
      receiptLatencyMs,
      terminalStatus: settled.payload.status,
      sseEventCount: runEvents.length,
      persistedEventCount: persistedRunEvents.length
    },
    observed: {
      toolNames,
      eventKinds: unique(persistedRunEvents.map((event) => event.kind)),
      updateModes: unique(persistedRunEvents.flatMap((event) => event.updateMode ? [event.updateMode] : [])),
      changedFiles: record.changedFiles,
      independentVerification: record.verification
    },
    retainedEvidence: {
      acceptanceRecordId: record.id,
      workspaceId: record.workspaceId,
      workspaceDisplayPath: record.workspaceDisplayPath,
      workspaceTemplateVersion: record.workspaceTemplateVersion,
      sessionId: record.sessionId,
      runId: record.runId,
      features: record.features,
      persistedUnderBridgeData: true
    },
    safety: {
      projectTrusted: workspace.projectTrusted,
      credentialPersisted: credentialLeaked,
      absoluteWorkspacePathExposedInRecord: record.workspaceDisplayPath.startsWith("/")
    },
    elapsedMs: Math.round(performance.now() - startedAt)
  }, null, 2)}\n`);
} catch (error) {
  if (activeSessionId && activeRunId) {
    await fetch(`http://${app.address.host}:${app.address.port}/api/sessions/${encodeURIComponent(activeSessionId)}/controls/interrupt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: randomUUID() })
    }).catch(() => undefined);
  }
  throw error;
} finally {
  leakProbe.clear();
  await app.stop();
}

function verificationDataDir(root: string, scenario: string): string {
  return resolve(process.env.FF_VERIFICATION_DATA_DIR ?? resolve(root, "backend/data/verification"), scenario);
}

async function collectUntilSettled(url: string): Promise<HarnessEvent[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 240_000);
  const response = await fetch(url, { signal: controller.signal });
  assert.equal(response.ok, true, `SSE connection failed: ${response.status}`);
  assert.ok(response.body, "SSE response body is missing");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events: HarnessEvent[] = [];
  let buffer = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error("SSE stream ended before run.settled");
      buffer += decoder.decode(chunk.value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const dataLine = frame.split("\n").find((line) => line.startsWith("data: "));
        if (!dataLine) continue;
        const event = JSON.parse(dataLine.slice(6)) as HarnessEvent;
        events.push(event);
        if (event.kind === "run.settled") {
          controller.abort();
          return events;
        }
      }
    }
  } finally {
    clearTimeout(timeout);
    await reader.cancel().catch(() => undefined);
  }
}

async function waitForAcceptanceRecord(url: string, runId: string): Promise<{ records: AcceptanceRecord[] }> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const result = await getJson<{ records: AcceptanceRecord[] }>(`${url}/api/acceptance-records`);
    if (result.records.some((entry) => entry.runId === runId)) return result;
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error("Acceptance record was not available after run settlement");
}

async function directoryContains(root: string, needle: string): Promise<boolean> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (await directoryContains(path, needle)) return true;
    } else if (entry.isFile()) {
      const content = await readFile(path).catch(() => Buffer.alloc(0));
      if (content.includes(Buffer.from(needle))) return true;
    }
  }
  return false;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const text = await response.text();
  assert.equal(response.ok, true, text);
  return JSON.parse(text) as T;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  assert.equal(response.ok, true, text);
  return JSON.parse(text) as T;
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}
