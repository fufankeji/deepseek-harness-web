import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { AcceptanceRecord, CommandReceipt, HarnessEvent, ModelInfo, SessionSummary, WorkspaceInfo } from "../src/contracts.js";
import { BridgeApp } from "../src/app.js";

const credentialFile = process.env.FF_CREDENTIAL_FILE;
if (!credentialFile) throw new Error("FF_CREDENTIAL_FILE must point to the user-authorized local credential file");
const authorizedCredentialFile = credentialFile;

const projectRoot = resolve(import.meta.dirname, "../..");
const dataDir = resolve(process.env.FF_VERIFICATION_DATA_DIR ?? resolve(projectRoot, "backend/data/verification"), "real-restart");
const acceptanceLedger = resolve(projectRoot, "backend/data/acceptance-ledger.sqlite");
const task = [
  "先使用 read 读取 long-output.mjs，",
  "然后必须使用 bash 运行精确命令 node long-output.mjs。",
  "不要访问其他文件或运行其他命令，结束后只说明命令已完成。"
].join("\n");

let app: BridgeApp | undefined;

try {
  app = createApp();
  const firstAddress = await app.start();
  await connectModel(firstAddress.url);
  const workspace = await post<WorkspaceInfo>(`${firstAddress.url}/api/workspaces/acceptance`, { templateVersion: "long-output-v1" });
  const session = await post<SessionSummary>(`${firstAddress.url}/api/sessions`, { name: "真实验收 · Bridge 重启恢复" });
  const firstRequestId = randomUUID();
  const firstReceipt = await post<CommandReceipt>(`${firstAddress.url}/api/sessions/${encodeURIComponent(session.id)}/runs`, {
    requestId: firstRequestId,
    text: task
  });
  assert.equal(firstReceipt.accepted, true, firstReceipt.reason);
  const firstEvents = await waitForSettled(firstAddress.url, session.id, firstReceipt.runId!);
  assert.equal(firstEvents.findLast((event) => event.kind === "run.settled")?.payload.status, "completed");
  const firstGeneration = Math.max(...firstEvents.map((event) => event.runtimeGeneration));
  const firstLastSequence = Math.max(...firstEvents.map((event) => event.sequence));

  await app.stop();
  app = undefined;

  app = createApp();
  const secondAddress = await app.start();
  await connectModel(secondAddress.url);
  const restoredWorkspace = await get<{ workspace: WorkspaceInfo }>(`${secondAddress.url}/api/workspaces/current`);
  assert.equal(restoredWorkspace.workspace.id, workspace.id, "workspace was not restored after Bridge restart");
  const reopened = await post<SessionSummary>(`${secondAddress.url}/api/sessions/${encodeURIComponent(session.id)}/open`, {});
  assert.equal(reopened.id, session.id, "Pi session was not reopened after Bridge restart");

  const durableDuplicate = await post<CommandReceipt>(`${secondAddress.url}/api/sessions/${encodeURIComponent(session.id)}/runs`, {
    requestId: firstRequestId,
    text: "这条跨进程重复请求不应再次执行"
  });
  assert.deepEqual(durableDuplicate, firstReceipt, "persisted request receipt was not reused after restart");

  const secondReceipt = await post<CommandReceipt>(`${secondAddress.url}/api/sessions/${encodeURIComponent(session.id)}/runs`, {
    requestId: randomUUID(),
    text: task
  });
  assert.equal(secondReceipt.accepted, true, secondReceipt.reason);
  const secondEvents = await waitForSettled(secondAddress.url, session.id, secondReceipt.runId!);
  assert.equal(secondEvents.findLast((event) => event.kind === "run.settled")?.payload.status, "completed");
  const secondGenerations = [...new Set(secondEvents.map((event) => event.runtimeGeneration))];
  assert.equal(secondGenerations.length, 1, "one run crossed multiple runtime generations");
  assert.ok(secondGenerations[0]! > firstGeneration, "runtime generation did not advance after Bridge restart");
  assert.ok(Math.min(...secondEvents.map((event) => event.sequence)) > firstLastSequence, "session sequence did not continue after restart");

  const replay = await get<{ events: HarnessEvent[] }>(
    `${secondAddress.url}/api/sessions/${encodeURIComponent(session.id)}/events?after=${firstLastSequence}`
  );
  assert.ok(replay.events.length > 0);
  assert.ok(replay.events.every((event) => event.sequence > firstLastSequence), "incremental replay returned an old event");
  assert.ok(replay.events.some((event) => event.runId === secondReceipt.runId && event.kind === "run.settled"));

  const records = await waitForRecord(secondAddress.url, secondReceipt.runId!);
  const record = records.find((entry) => entry.runId === secondReceipt.runId)!;
  assert.equal(record.passed, true);

  process.stdout.write(`${JSON.stringify({
    success: true,
    workspace: workspace.displayPath,
    sessionId: session.id,
    firstRunId: firstReceipt.runId,
    secondRunId: secondReceipt.runId,
    runtimeGeneration: { beforeRestart: firstGeneration, afterRestart: secondGenerations[0] },
    sequence: { beforeRestartLast: firstLastSequence, afterRestartFirst: secondEvents[0]!.sequence },
    durableIdempotency: true,
    incrementalReplay: true,
    acceptanceRecordId: record.id,
    retained: true
  }, null, 2)}\n`);
} finally {
  await app?.stop();
}

function createApp(): BridgeApp {
  return new BridgeApp({ host: "127.0.0.1", port: 0, dataDir, acceptanceLedger, credentialFile: authorizedCredentialFile, projectRoot });
}

async function connectModel(url: string): Promise<void> {
  const model = await post<ModelInfo>(`${url}/api/model/connect`, { credentialSource: "configured-file", verify: true });
  assert.equal(model.status, "ready");
}

async function waitForSettled(url: string, sessionId: string, runId: string): Promise<HarnessEvent[]> {
  for (let attempt = 0; attempt < 1_200; attempt += 1) {
    const result = await get<{ events: HarnessEvent[] }>(`${url}/api/sessions/${encodeURIComponent(sessionId)}/events`);
    const events = result.events.filter((event) => event.runId === runId);
    if (events.some((event) => event.kind === "run.settled")) return events;
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  throw new Error("timed out waiting for run.settled across restart verification");
}

async function waitForRecord(url: string, runId: string): Promise<AcceptanceRecord[]> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await get<{ records: AcceptanceRecord[] }>(`${url}/api/acceptance-records`);
    if (result.records.some((entry) => entry.runId === runId)) return result.records;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error("acceptance record was not persisted after restart run");
}

async function get<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const text = await response.text();
  assert.equal(response.ok, true, text);
  return JSON.parse(text) as T;
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  assert.equal(response.ok, true, text);
  return JSON.parse(text) as T;
}
