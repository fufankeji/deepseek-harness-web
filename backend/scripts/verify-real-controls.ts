import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { AcceptanceRecord, CommandReceipt, HarnessEvent, ModelInfo, SessionSummary, WorkspaceInfo } from "../src/contracts.js";
import { BridgeApp } from "../src/app.js";

const credentialFile = process.env.FF_CREDENTIAL_FILE;
if (!credentialFile) throw new Error("FF_CREDENTIAL_FILE must point to the user-authorized local credential file");

const projectRoot = resolve(import.meta.dirname, "../..");
const dataDir = resolve(process.env.FF_VERIFICATION_DATA_DIR ?? resolve(projectRoot, "backend/data/verification"), "real-controls");
const acceptanceLedger = resolve(projectRoot, "backend/data/acceptance-ledger.sqlite");
const app = new BridgeApp({ host: "127.0.0.1", port: 0, dataDir, acceptanceLedger, credentialFile, projectRoot });
let sessionId = "";

try {
  const { url } = await app.start();
  const model = await post<ModelInfo>(`${url}/api/model/connect`, { credentialSource: "configured-file", verify: true });
  assert.equal(model.status, "ready");
  const workspace = await post<WorkspaceInfo>(`${url}/api/workspaces/acceptance`, { templateVersion: "control-v1" });
  const session = await post<SessionSummary>(`${url}/api/sessions`, { name: "真实验收 · 运行控制" });
  sessionId = session.id;
  const settledPromise = collectRun(`${url}/api/sessions/${encodeURIComponent(session.id)}/stream`);

  const requestId = randomUUID();
  const submitUrl = `${url}/api/sessions/${encodeURIComponent(session.id)}/runs`;
  const [receipt, duplicate] = await Promise.all([
    post<CommandReceipt>(submitUrl, {
      requestId,
      text: "请先用 read 读取 wait.mjs，然后必须用 bash 运行精确命令 node wait.mjs。命令结束前不要做其他事。"
    }),
    post<CommandReceipt>(submitUrl, {
      requestId,
      text: "这条并发重复请求不应被执行"
    })
  ]);
  assert.equal(receipt.accepted, true, receipt.reason);
  assert.deepEqual(duplicate, receipt, "concurrent duplicate requestId did not return the original receipt");

  await waitForEvent(url, session.id, receipt.runId!, (event) => event.kind === "tool.started" && event.payload.toolName === "bash");
  const steer = await post<CommandReceipt>(`${url}/api/sessions/${encodeURIComponent(session.id)}/controls/steer`, {
    requestId: randomUUID(),
    text: "保持当前命令运行，结束后只汇报真实结果。"
  });
  const followUp = await post<CommandReceipt>(`${url}/api/sessions/${encodeURIComponent(session.id)}/controls/follow-up`, {
    requestId: randomUUID(),
    text: "如果任务未被中断，随后说明本次调用过的工具。"
  });
  assert.equal(steer.accepted, true, steer.reason);
  assert.equal(followUp.accepted, true, followUp.reason);
  const interruptRequest = randomUUID();
  const interruptUrl = `${url}/api/sessions/${encodeURIComponent(session.id)}/controls/interrupt`;
  const [interrupted, duplicateInterrupt] = await Promise.all([
    post<CommandReceipt>(interruptUrl, { requestId: interruptRequest }),
    post<CommandReceipt>(interruptUrl, { requestId: interruptRequest })
  ]);
  assert.equal(interrupted.accepted, true, interrupted.reason);
  assert.deepEqual(duplicateInterrupt, interrupted);

  const streamed = await settledPromise;
  const terminal = streamed.findLast((event) => event.kind === "run.settled" && event.runId === receipt.runId);
  assert.equal(terminal?.payload.status, "cancelled");
  assert.ok(streamed.some((event) => event.kind === "queue.updated" && event.payload.clearedSteeringCount === 1 && event.payload.clearedFollowUpCount === 1));
  const bashEnd = streamed.find((event) => event.kind === "tool.completed" && event.payload.toolName === "bash");
  assert.equal(bashEnd?.payload.cancelled, true);

  const records = await waitForRecord(url, receipt.runId!);
  const record = records.find((entry) => entry.runId === receipt.runId)!;
  assert.equal(record.workspaceTemplateVersion, "control-v1");
  assert.equal(record.finalStatus, "cancelled");
  assert.equal(record.verification.passed, true);

  const forkPoints = await get<{ points: Array<{ entryId: string; text: string }> }>(`${url}/api/sessions/${encodeURIComponent(session.id)}/fork-points`);
  assert.ok(forkPoints.points.length > 0);
  const forked = await post<SessionSummary>(`${url}/api/sessions/${encodeURIComponent(session.id)}/fork`, { entryId: forkPoints.points.at(-1)!.entryId });
  assert.notEqual(forked.id, session.id);
  await post<SessionSummary>(`${url}/api/sessions/${encodeURIComponent(forked.id)}/close`, {});
  const reopenedOriginal = await post<SessionSummary>(`${url}/api/sessions/${encodeURIComponent(session.id)}/open`, {});
  assert.equal(reopenedOriginal.id, session.id);
  const persisted = await get<{ events: HarnessEvent[] }>(`${url}/api/sessions/${encodeURIComponent(session.id)}/events`);
  assert.ok(persisted.events.some((event) => event.kind === "run.settled" && event.payload.status === "cancelled"));

  process.stdout.write(`${JSON.stringify({
    success: true,
    workspace: workspace.displayPath,
    sessionId: session.id,
    runId: receipt.runId,
    acceptanceRecordId: record.id,
    terminalStatus: terminal?.payload.status,
    idempotency: { concurrentSubmit: true, concurrentInterrupt: true },
    controls: { steer: steer.accepted, followUp: followUp.accepted, interrupt: interrupted.accepted, queueCleared: true },
    lifecycle: { forkedSessionId: forked.id, close: true, reopenOriginal: true },
    eventCount: persisted.events.length,
    retained: true
  }, null, 2)}\n`);
} finally {
  if (sessionId) {
    await fetch(`${app.address.url}/api/sessions/${encodeURIComponent(sessionId)}/controls/interrupt`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId: randomUUID() })
    }).catch(() => undefined);
  }
  await app.stop();
}

async function collectRun(url: string): Promise<HarnessEvent[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  const response = await fetch(url, { signal: controller.signal });
  assert.ok(response.ok && response.body);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events: HarnessEvent[] = [];
  let buffer = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error("SSE ended before run settled");
      buffer += decoder.decode(chunk.value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const line = frame.split("\n").find((entry) => entry.startsWith("data: "));
        if (!line) continue;
        const event = JSON.parse(line.slice(6)) as HarnessEvent;
        events.push(event);
        if (event.kind === "run.settled") return events;
      }
    }
  } finally {
    clearTimeout(timer);
    await reader.cancel().catch(() => undefined);
  }
}

async function waitForEvent(url: string, session: string, run: string, predicate: (event: HarnessEvent) => boolean): Promise<HarnessEvent> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const result = await get<{ events: HarnessEvent[] }>(`${url}/api/sessions/${encodeURIComponent(session)}/events`);
    const event = result.events.find((entry) => entry.runId === run && predicate(entry));
    if (event) return event;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error("timed out waiting for real runtime event");
}

async function waitForRecord(url: string, runId: string): Promise<AcceptanceRecord[]> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const result = await get<{ records: AcceptanceRecord[] }>(`${url}/api/acceptance-records`);
    if (result.records.some((entry) => entry.runId === runId)) return result.records;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error("acceptance record was not persisted");
}

async function get<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const text = await response.text();
  assert.equal(response.ok, true, text);
  return JSON.parse(text) as T;
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const text = await response.text();
  assert.equal(response.ok, true, text);
  return JSON.parse(text) as T;
}
