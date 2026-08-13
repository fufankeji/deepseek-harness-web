import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { BridgeApp } from "../src/app.js";
import type {
  AcceptanceRecord,
  CommandExecutionResult,
  HarnessCommand,
  HarnessEvent,
  ModelInfo,
  SessionSummary,
  WorkspaceInfo
} from "../src/contracts.js";
import { CredentialStore } from "../src/secrets/credential-store.js";

const credentialFile = process.env.FF_CREDENTIAL_FILE;
if (!credentialFile) throw new Error("FF_CREDENTIAL_FILE must point to the user-authorized local credential file");

const projectRoot = resolve(import.meta.dirname, "../..");
const dataDir = resolve(process.env.FF_VERIFICATION_DATA_DIR ?? resolve(projectRoot, "backend/data/verification"), "command-center");
const acceptanceLedger = resolve(projectRoot, "backend/data/acceptance-ledger.sqlite");
const leakProbe = new CredentialStore();
await leakProbe.loadFromFile(credentialFile);
const apiKey = leakProbe.require().apiKey;
const app = new BridgeApp({ host: "127.0.0.1", port: 0, dataDir, acceptanceLedger, credentialFile, projectRoot });
const startedAt = performance.now();
let activeSessionId = "";

try {
  const { url } = await app.start();
  const model = await post<ModelInfo>(`${url}/api/model/connect`, {
    credentialSource: "configured-file",
    modelId: "deepseek-v4-flash",
    thinkingLevel: "high",
    verify: true
  });
  assert.equal(model.status, "ready");

  const workspace = await post<WorkspaceInfo>(`${url}/api/workspaces/acceptance`, { templateVersion: "command-center-v1" });
  assert.equal(workspace.projectTrusted, false);
  const trusted = await post<WorkspaceInfo>(`${url}/api/workspaces/trust`, { projectTrusted: true });
  assert.equal(trusted.projectTrusted, true);

  const session = await post<SessionSummary>(`${url}/api/sessions`, { name: "真实验收 · 斜杠命令中心" });
  activeSessionId = session.id;
  const catalog = await get<{ commands: HarnessCommand[] }>(`${url}/api/sessions/${encodeURIComponent(session.id)}/commands`);
  const byId = new Map(catalog.commands.map((command) => [command.id, command]));
  assert.equal(byId.get("prompt:command-check")?.available, true);
  assert.equal(byId.get("skill:command-check")?.available, true);
  assert.equal(byId.get("extension:extension-check")?.available, false);

  const unknown = await execute(url, session.id, "unknown-command");
  assert.equal(unknown.accepted, false);

  const named = await execute(url, session.id, "session.rename", "真实验收 · 已通过命令重命名");
  assert.equal(named.accepted, true);
  const details = await execute(url, session.id, "session.details");
  assert.equal(details.effect?.type, "details");
  const reloaded = await execute(url, session.id, "resources.reload");
  assert.equal(reloaded.accepted, true);
  assert.equal(reloaded.effect?.type, "details");

  const promptResult = await execute(url, session.id, "prompt:command-check", "真实 Prompt Template 链路");
  assert.equal(promptResult.accepted, true, promptResult.reason);
  assert.ok(promptResult.runId);
  const promptEvents = await waitForRun(url, session.id, promptResult.runId!);
  assert.equal(terminalStatus(promptEvents), "completed");
  assert.match(finalAssistantText(promptEvents), /FF-COMMAND-PROMPT-OK/);
  assert.equal(userText(promptEvents), "/command-check 真实 Prompt Template 链路");
  assert.equal(promptEvents.some((event) => event.payload.commandId === "prompt:command-check"), true);
  assert.equal(promptEvents.some((event) => JSON.stringify(event.payload).includes("<skill name=")), false);

  const skillResult = await execute(url, session.id, "skill:command-check", "真实 Skill 链路");
  assert.equal(skillResult.accepted, true, skillResult.reason);
  assert.ok(skillResult.runId);
  const skillEvents = await waitForRun(url, session.id, skillResult.runId!);
  assert.equal(terminalStatus(skillEvents), "completed");
  assert.match(finalAssistantText(skillEvents), /FF-COMMAND-SKILL-OK/);
  assert.equal(userText(skillEvents), "/skill:command-check 真实 Skill 链路");
  assert.equal(skillEvents.some((event) => event.payload.commandId === "skill:command-check"), true);
  assert.equal(skillEvents.some((event) => containsAbsoluteWorkspacePath(event, workspace.displayPath)), false);

  const copy = await execute(url, session.id, "message.copy-last");
  assert.equal(copy.effect?.type, "clipboard");
  if (copy.effect?.type === "clipboard") assert.match(copy.effect.text, /FF-COMMAND-SKILL-OK/);

  const compact = await execute(url, session.id, "context.compact", "只保留命令验收结论");
  assert.equal(compact.accepted, false, "a short real session must report Pi's authoritative compaction refusal");
  assert.match(compact.reason ?? "", /Nothing to compact|session too small/i);
  const afterCompact = await get<{ events: HarnessEvent[] }>(`${url}/api/sessions/${encodeURIComponent(session.id)}/events`);
  assert.ok(afterCompact.events.some((event) => event.kind === "compaction.started"));
  assert.ok(afterCompact.events.some((event) => event.kind === "compaction.completed" && event.payload.aborted === false));

  const exportedJsonl = await exportAndDownload(url, session.id, "jsonl");
  const exportedHtml = await exportAndDownload(url, session.id, "html");
  assert.match(exportedJsonl.body, /"type":"session"/);
  assert.match(exportedHtml.body, /<!doctype html/i);

  const forkCatalog = await get<{ commands: HarnessCommand[] }>(`${url}/api/sessions/${encodeURIComponent(session.id)}/commands`);
  const fork = forkCatalog.commands.find((command) => command.id === "session.fork");
  assert.equal(fork?.available, true);
  const forked = await execute(url, session.id, "session.fork", fork!.options!.at(-1)!.value);
  assert.equal(forked.accepted, true);
  assert.notEqual(forked.sessionId, session.id);
  activeSessionId = forked.sessionId!;

  const cloneCatalog = await get<{ commands: HarnessCommand[] }>(`${url}/api/sessions/${encodeURIComponent(activeSessionId)}/commands`);
  assert.equal(cloneCatalog.commands.find((command) => command.id === "session.clone")?.available, true);
  const cloned = await execute(url, activeSessionId, "session.clone");
  assert.equal(cloned.accepted, true);
  assert.notEqual(cloned.sessionId, activeSessionId);
  activeSessionId = cloned.sessionId!;

  const fresh = await execute(url, activeSessionId, "session.new");
  assert.equal(fresh.accepted, true);
  activeSessionId = fresh.sessionId!;
  const freshCatalog = await get<{ commands: HarnessCommand[] }>(`${url}/api/sessions/${encodeURIComponent(activeSessionId)}/commands`);
  const resume = freshCatalog.commands.find((command) => command.id === "session.resume");
  assert.equal(resume?.available, true);
  assert.ok(resume?.options?.some((option) => option.value === session.id));
  const resumed = await execute(url, activeSessionId, "session.resume", session.id);
  assert.equal(resumed.sessionId, session.id);
  activeSessionId = session.id;

  const spoofedSourceSessionId = randomUUID();
  const jsonlLines = exportedJsonl.body.trimEnd().split("\n");
  jsonlLines[0] = JSON.stringify({
    ...(JSON.parse(jsonlLines[0]!) as Record<string, unknown>),
    id: spoofedSourceSessionId,
    cwd: "/untrusted/source/path",
    timestamp: new Date().toISOString()
  });
  const imported = await execute(url, session.id, "session.import", undefined, {
    name: "command-center-import.jsonl",
    content: Buffer.from(`${jsonlLines.join("\n")}\n`).toString("base64")
  });
  assert.equal(imported.accepted, true);
  assert.notEqual(imported.sessionId, spoofedSourceSessionId);
  assert.notEqual(imported.sessionId, session.id);
  activeSessionId = imported.sessionId!;

  for (const [commandId, path] of [
    ["settings.model", "/setup?step=model"],
    ["settings.open", "/setup"],
    ["settings.trust", "/setup?step=trust"]
  ] as const) {
    const result = await execute(url, activeSessionId, commandId);
    assert.deepEqual(result.effect, { type: "navigate", path });
  }

  const records = await waitForRecords(url, [promptResult.runId!, skillResult.runId!]);
  const promptRecord = records.find((record) => record.runId === promptResult.runId)!;
  const skillRecord = records.find((record) => record.runId === skillResult.runId)!;
  for (const record of [promptRecord, skillRecord]) {
    assert.equal(record.workspaceTemplateVersion, "command-center-v1");
    assert.equal(record.finalStatus, "completed");
    assert.equal(record.verification.passed, true, record.verification.output);
    assert.ok(record.features.includes("FM-12"));
  }

  assert.equal(await directoryContains(dataDir, apiKey), false, "API key leaked into retained command-center data");
  process.stdout.write(`${JSON.stringify({
    success: true,
    runtime: { harness: "pi", harnessVersion: "0.84.1", modelId: model.modelId },
    catalog: {
      total: catalog.commands.length,
      promptDiscovered: true,
      skillDiscovered: true,
      extensionDiscoveredButBlocked: true
    },
    realRuns: [
      { commandId: promptResult.commandId, runId: promptResult.runId, terminal: terminalStatus(promptEvents), marker: "FF-COMMAND-PROMPT-OK" },
      { commandId: skillResult.commandId, runId: skillResult.runId, terminal: terminalStatus(skillEvents), marker: "FF-COMMAND-SKILL-OK" }
    ],
    synchronousCommands: {
      unknownRejected: true,
      rename: true,
      details: true,
      reload: true,
      copy: true,
      compactAuthoritativeRefusal: compact.reason,
      exportJsonl: true,
      exportHtml: true,
      importJsonl: true,
      fork: true,
      clone: true,
      newSession: true,
      resume: true,
      settingsNavigation: true
    },
    retainedEvidence: { acceptanceRecordIds: [promptRecord.id, skillRecord.id], dataDir: "backend/data/verification/command-center" },
    safety: { credentialPersisted: false, expandedResourceTextExposedInUnifiedUserEvent: false },
    elapsedMs: Math.round(performance.now() - startedAt)
  }, null, 2)}\n`);
} finally {
  if (activeSessionId) {
    await fetch(`${app.address.url}/api/sessions/${encodeURIComponent(activeSessionId)}/controls/interrupt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: randomUUID() })
    }).catch(() => undefined);
  }
  leakProbe.clear();
  await app.stop();
}

async function execute(
  baseUrl: string,
  sessionId: string,
  commandId: string,
  argument?: string,
  file?: { name: string; content: string }
): Promise<CommandExecutionResult> {
  return await post(`${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/commands`, {
    requestId: randomUUID(), commandId, ...(argument ? { argument } : {}), ...(file ? { file } : {})
  });
}

async function exportAndDownload(baseUrl: string, sessionId: string, format: "html" | "jsonl") {
  const result = await execute(baseUrl, sessionId, "session.export", format);
  assert.equal(result.effect?.type, "download");
  if (result.effect?.type !== "download") throw new Error(`Missing ${format} export effect`);
  const response = await fetch(`${baseUrl}${result.effect.url}`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-disposition")?.includes(result.effect.fileName), true);
  return { fileName: result.effect.fileName, body: await response.text() };
}

async function waitForRun(baseUrl: string, sessionId: string, runId: string): Promise<HarnessEvent[]> {
  for (let attempt = 0; attempt < 1_200; attempt += 1) {
    const result = await get<{ events: HarnessEvent[] }>(`${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/events`);
    const events = result.events.filter((event) => event.runId === runId);
    if (events.some((event) => event.kind === "run.settled")) return events;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`Timed out waiting for command run ${runId}`);
}

async function waitForRecords(baseUrl: string, runIds: string[]): Promise<AcceptanceRecord[]> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const result = await get<{ records: AcceptanceRecord[] }>(`${baseUrl}/api/acceptance-records`);
    if (runIds.every((runId) => result.records.some((record) => record.runId === runId))) return result.records;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error("Command-center acceptance records were not persisted");
}

function terminalStatus(events: HarnessEvent[]): unknown {
  return events.findLast((event) => event.kind === "run.settled")?.payload.status;
}

function finalAssistantText(events: HarnessEvent[]): string {
  const event = events.findLast((entry) => entry.kind === "message.completed" && entry.payload.role === "assistant");
  return typeof event?.payload.text === "string" ? event.payload.text : "";
}

function userText(events: HarnessEvent[]): string {
  const event = events.find((entry) => entry.kind === "message.completed" && entry.payload.role === "user");
  return typeof event?.payload.text === "string" ? event.payload.text : "";
}

function containsAbsoluteWorkspacePath(event: HarnessEvent, displayPath: string): boolean {
  if (!displayPath.startsWith("/")) return false;
  return JSON.stringify(event).includes(displayPath);
}

async function directoryContains(root: string, needle: string): Promise<boolean> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (await directoryContains(path, needle)) return true;
    } else if (entry.isFile()) {
      if ((await readFile(path).catch(() => Buffer.alloc(0))).includes(Buffer.from(needle))) return true;
    }
  }
  return false;
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
