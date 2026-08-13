import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { BridgeApp } from "../src/app.js";
import type { CommandExecutionResult, HarnessCommand, SessionSummary } from "../src/contracts.js";

test("slash command catalog and non-model commands use the real Pi session without model fallback", async () => {
  const root = await mkdtemp(join(tmpdir(), "ff-command-center-"));
  let modelRequests = 0;
  const modelServer = createServer((_request, response) => {
    modelRequests += 1;
    response.writeHead(500, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "A non-model slash command reached the model" }));
  });
  await new Promise<void>((resolveListen) => modelServer.listen(0, "127.0.0.1", resolveListen));
  const modelAddress = modelServer.address();
  assert.ok(modelAddress && typeof modelAddress === "object");

  const app = new BridgeApp({
    host: "127.0.0.1",
    port: 0,
    dataDir: join(root, "data"),
    projectRoot: resolve(import.meta.dirname, "../..")
  });
  const address = await app.start();
  try {
    await postJson(`${address.url}/api/model/connect`, {
      apiKey: "test-key-command-center",
      baseUrl: `http://127.0.0.1:${modelAddress.port}`,
      modelId: "deepseek-v4-flash",
      verify: false
    });
    await postJson(`${address.url}/api/workspaces/acceptance`, { templateVersion: "command-center-v1" });
    await postJson(`${address.url}/api/workspaces/trust`, { projectTrusted: true });
    const original = await postJson<SessionSummary>(`${address.url}/api/sessions`, { name: "命令中心验收 A" });

    const catalog = await getJson<{ commands: HarnessCommand[] }>(
      `${address.url}/api/sessions/${encodeURIComponent(original.id)}/commands`
    );
    const byId = new Map(catalog.commands.map((command) => [command.id, command]));
    for (const id of [
      "session.new", "session.resume", "session.rename", "session.fork", "session.clone",
      "context.compact", "session.details", "resources.reload", "message.copy-last",
      "session.export", "session.import", "settings.model", "settings.open", "settings.trust",
      "session.tree", "prompt:command-check", "skill:command-check"
    ]) {
      assert.ok(byId.has(id), `Missing slash command: ${id}`);
    }
    assert.equal(byId.get("session.rename")?.argumentRequired, true);
    assert.equal(byId.get("session.tree")?.available, false);
    assert.equal(byId.get("prompt:command-check")?.startsRun, true);
    assert.equal(byId.get("skill:command-check")?.startsRun, true);
    assert.equal(byId.get("extension:extension-check")?.available, false);
    assert.match(byId.get("extension:extension-check")?.unavailableReason ?? "", /TUI/);

    const unknown = await execute(address.url, original.id, {
      requestId: randomUUID(),
      commandId: "not-a-real-command"
    });
    assert.equal(unknown.accepted, false);
    assert.match(unknown.reason ?? "", /不在当前 Harness 命令目录/);

    const missingName = await execute(address.url, original.id, {
      requestId: randomUUID(),
      commandId: "session.rename"
    });
    assert.equal(missingName.accepted, false);
    assert.match(missingName.reason ?? "", /请输入新的会话名称/);

    const renameRequestId = randomUUID();
    const renamed = await execute(address.url, original.id, {
      requestId: renameRequestId,
      commandId: "session.rename",
      argument: "命令中心已重命名"
    });
    assert.equal(renamed.accepted, true);
    assert.equal(renamed.effect?.type, "session");
    if (renamed.effect?.type === "session") assert.equal(renamed.effect.session.name, "命令中心已重命名");

    const replayed = await execute(address.url, original.id, {
      requestId: renameRequestId,
      commandId: "session.rename",
      argument: "不应覆盖原结果"
    });
    assert.deepEqual(replayed, renamed, "requestId replay must return the original command result");

    const details = await execute(address.url, original.id, {
      requestId: randomUUID(),
      commandId: "session.details"
    });
    assert.equal(details.accepted, true);
    assert.equal(details.effect?.type, "details");

    const reload = await execute(address.url, original.id, {
      requestId: randomUUID(),
      commandId: "resources.reload"
    });
    assert.equal(reload.accepted, true);
    assert.equal(reload.effect?.type, "details");
    if (reload.effect?.type === "details") {
      assert.deepEqual(reload.effect.data.promptTemplates, ["command-check"]);
      assert.ok(Array.isArray(reload.effect.data.skills));
      assert.ok((reload.effect.data.skills as string[]).includes("command-check"));
    }

    for (const [commandId, path] of [
      ["settings.model", "/setup?step=model"],
      ["settings.open", "/setup"],
      ["settings.trust", "/setup?step=trust"]
    ] as const) {
      const result = await execute(address.url, original.id, { requestId: randomUUID(), commandId });
      assert.deepEqual(result.effect, { type: "navigate", path });
    }

    const invalidImport = await execute(address.url, original.id, {
      requestId: randomUUID(),
      commandId: "session.import",
      file: { name: "session.txt", content: Buffer.from("not jsonl").toString("base64") }
    });
    assert.equal(invalidImport.accepted, false);
    assert.match(invalidImport.reason ?? "", /只能导入 .jsonl/);

    const exported = await execute(address.url, original.id, {
      requestId: randomUUID(),
      commandId: "session.export",
      argument: "jsonl"
    });
    assert.equal(exported.effect?.type, "download");
    let exportedJsonl = "";
    if (exported.effect?.type === "download") {
      assert.ok(exported.effect.url.startsWith("/api/command-exports/"));
      assert.equal(exported.effect.fileName.endsWith(".jsonl"), true);
      const download = await fetch(`${address.url}${exported.effect.url}`);
      assert.equal(download.status, 200);
      assert.match(download.headers.get("content-type") ?? "", /application\/x-ndjson/);
      exportedJsonl = await download.text();
      assert.match(exportedJsonl, /"type":"session"/);
    }

    const created = await execute(address.url, original.id, {
      requestId: randomUUID(),
      commandId: "session.new"
    });
    assert.equal(created.effect?.type, "session");
    assert.notEqual(created.sessionId, original.id);
    const createdId = created.sessionId!;

    const createdCatalog = await getJson<{ commands: HarnessCommand[] }>(
      `${address.url}/api/sessions/${encodeURIComponent(createdId)}/commands`
    );
    const resume = createdCatalog.commands.find((command) => command.id === "session.resume");
    assert.equal(resume?.available, false, "Pi does not persist a session until an assistant message exists");

    const importedOriginal = await execute(address.url, createdId, {
      requestId: randomUUID(),
      commandId: "session.import",
      file: { name: "session.jsonl", content: Buffer.from(exportedJsonl).toString("base64") }
    });
    assert.notEqual(importedOriginal.sessionId, original.id, "import must create a new product session identity");
    assert.notEqual(importedOriginal.sessionId, createdId);
    assert.equal(importedOriginal.effect?.type, "session");
    const firstImportedId = importedOriginal.sessionId!;

    const lines = exportedJsonl.trimEnd().split("\n");
    const header = JSON.parse(lines[0]!) as Record<string, unknown>;
    const spoofedSourceId = randomUUID();
    lines[0] = JSON.stringify({ ...header, id: spoofedSourceId, cwd: "/untrusted/source/path", timestamp: new Date().toISOString() });
    const importedSecond = await execute(address.url, firstImportedId, {
      requestId: randomUUID(),
      commandId: "session.import",
      file: { name: "second-session.jsonl", content: Buffer.from(`${lines.join("\n")}\n`).toString("base64") }
    });
    assert.notEqual(importedSecond.sessionId, spoofedSourceId, "an uploaded header cannot choose the product session identity");
    assert.notEqual(importedSecond.sessionId, original.id);
    assert.notEqual(importedSecond.sessionId, firstImportedId);
    const secondImportedId = importedSecond.sessionId!;

    const malformedImport = await execute(address.url, secondImportedId, {
      requestId: randomUUID(),
      commandId: "session.import",
      file: { name: "malformed.jsonl", content: Buffer.from(`${exportedJsonl}{broken-json}\n`).toString("base64") }
    });
    assert.equal(malformedImport.accepted, false);
    assert.match(malformedImport.reason ?? "", /不是有效的 Pi 会话/);

    const importCatalog = await getJson<{ commands: HarnessCommand[] }>(
      `${address.url}/api/sessions/${encodeURIComponent(secondImportedId)}/commands`
    );
    const recoverable = importCatalog.commands.find((command) => command.id === "session.resume");
    assert.equal(recoverable?.available, true);
    assert.ok(recoverable?.options?.some((option) => option.value === firstImportedId));
    const resumed = await execute(address.url, secondImportedId, {
      requestId: randomUUID(),
      commandId: "session.resume",
      argument: firstImportedId
    });
    assert.equal(resumed.sessionId, firstImportedId);
    assert.equal(resumed.effect?.type, "session");

    assert.equal(modelRequests, 0, "non-model slash commands must never fall back to a model prompt");
  } finally {
    await app.stop();
    await new Promise<void>((resolveClose) => modelServer.close(() => resolveClose()));
  }
});

async function execute(
  baseUrl: string,
  sessionId: string,
  body: { requestId: string; commandId: string; argument?: string; file?: { name: string; content: string } }
): Promise<CommandExecutionResult> {
  return await postJson<CommandExecutionResult>(
    `${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/commands`,
    body
  );
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const text = await response.text();
  assert.equal(response.ok, true, text);
  return JSON.parse(text) as T;
}

async function postJson<T = Record<string, unknown>>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  assert.equal(response.ok, true, text);
  return JSON.parse(text) as T;
}
