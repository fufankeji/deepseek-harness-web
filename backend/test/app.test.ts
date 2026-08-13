import assert from "node:assert/strict";
import { mkdtemp, realpath } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { BridgeApp } from "../src/app.js";

test("Bridge exposes health, runtime probe, model sources, acceptance workspace and Git APIs", async () => {
  const root = await mkdtemp(join(tmpdir(), "ff-bridge-http-"));
  const app = new BridgeApp({
    host: "127.0.0.1",
    port: 0,
    dataDir: join(root, "data"),
    projectRoot: resolve(import.meta.dirname, "../..")
  });
  const address = await app.start();
  try {
    const health = await getJson(`${address.url}/api/health`);
    assert.equal(health.status, "ready");
    assert.equal(health.transport, "http+sse");

    const runtime = await postJson(`${address.url}/api/runtime/probe`, {});
    assert.equal(runtime.status, "ready");
    assert.equal(runtime.harnessVersion, "0.84.1");
    assert.equal(runtime.harnessId, "pi");

    const runtimeOptions = await getJson(`${address.url}/api/runtime/options`);
    assert.equal(runtimeOptions.activeAdapterId, "pi");
    assert.deepEqual(runtimeOptions.options.map((entry: { adapterId: string }) => entry.adapterId), ["pi", "deepseek-official"]);
    const official = await postJson(`${address.url}/api/runtime/select`, { adapterId: "deepseek-official" });
    assert.equal(official.harnessId, "deepseek-harness");
    assert.equal(official.harnessVersion, "0.1.0-rc.6");
    assert.equal(official.status, "ready");
    assert.equal(official.capabilities.approvals, false);
    assert.equal(official.capabilities.sandbox, true);
    const piAgain = await postJson(`${address.url}/api/runtime/select`, { adapterId: "pi" });
    assert.equal(piAgain.harnessId, "pi");

    const sources = await getJson(`${address.url}/api/model/sources`);
    assert.equal(sources.configuredFile, false);

    const workspace = await postJson(`${address.url}/api/workspaces/acceptance`, {});
    assert.equal(workspace.status, "ready");
    assert.equal(workspace.git, true);

    const diagnostics = await getJson(`${address.url}/api/diagnostics`);
    assert.deepEqual(diagnostics.capabilityDecisions.structuredEvents, {
      runtimeCapability: true,
      productAvailability: true,
      userPermission: true
    });
    assert.equal(diagnostics.capabilityDecisions.resumableSessions.userPermission, true);
    assert.equal(diagnostics.capabilityDecisions.tools.userPermission, false);
    assert.equal(diagnostics.capabilityDecisions.approvals.productAvailability, false);

    const files = await getJson(`${address.url}/api/workspaces/files`);
    assert.ok(Array.isArray(files.files));
    assert.ok(files.files.some((entry: { path: string }) => entry.path === "src/counter.js"));

    const diff = await getJson(`${address.url}/api/workspaces/diff`);
    assert.equal(diff.unstaged, "");
    assert.equal(diff.staged, "");
  } finally {
    await app.stop();
  }
});

test("Bridge restores the current workspace and marks interrupted runs unknown", async () => {
  const root = await mkdtemp(join(tmpdir(), "ff-bridge-restart-"));
  const dataDir = join(root, "data");
  const projectRoot = resolve(import.meta.dirname, "../..");
  const first = new BridgeApp({ host: "127.0.0.1", port: 0, dataDir, projectRoot });
  const firstAddress = await first.start();
  const workspace = await postJson(`${firstAddress.url}/api/workspaces/acceptance`, {});
  await first.stop();

  const second = new BridgeApp({ host: "127.0.0.1", port: 0, dataDir, projectRoot });
  const secondAddress = await second.start();
  try {
    const restored = await getJson(`${secondAddress.url}/api/workspaces/current`);
    assert.equal(restored.workspace.id, workspace.id);
    assert.equal(restored.workspace.displayPath, workspace.displayPath);
  } finally {
    await second.stop();
  }
});

test("native directory selection opens the selected workspace and cancellation preserves the current workspace", async () => {
  const root = await mkdtemp(join(tmpdir(), "ff-bridge-picker-"));
  const selected = join(root, "selected");
  await import("node:fs/promises").then(({ mkdir, writeFile }) => mkdir(selected).then(() => writeFile(join(selected, "README.md"), "# selected\n")));
  let nextSelection: string | null = selected;
  const app = new BridgeApp({
    host: "127.0.0.1",
    port: 0,
    dataDir: join(root, "data"),
    projectRoot: resolve(import.meta.dirname, "../.."),
    directoryPicker: async () => nextSelection
  });
  const address = await app.start();
  try {
    const picked = await postJson(`${address.url}/api/workspaces/pick`, {});
    assert.equal(picked.cancelled, false);
    assert.equal(picked.selectedPath, await realpath(selected));
    assert.equal(picked.workspace.name, "selected");
    assert.equal(picked.workspace.status, "ready");

    nextSelection = null;
    const cancelled = await postJson(`${address.url}/api/workspaces/pick`, {});
    assert.deepEqual(cancelled, { cancelled: true });
    const current = await getJson(`${address.url}/api/workspaces/current`);
    assert.equal(current.workspace.id, picked.workspace.id);
  } finally {
    await app.stop();
  }
});

test("Bridge creates a non-Git starter workspace without requiring a repository URL", async () => {
  const root = await mkdtemp(join(tmpdir(), "ff-bridge-starter-"));
  const app = new BridgeApp({ host: "127.0.0.1", port: 0, dataDir: join(root, "data"), projectRoot: resolve(import.meta.dirname, "../..") });
  const address = await app.start();
  try {
    const starter = await postJson(`${address.url}/api/workspaces/starter`, {});
    assert.equal(starter.name, "DeepSeek 示例项目");
    assert.equal(starter.git, false);
    const current = await getJson(`${address.url}/api/workspaces/current`);
    assert.equal(current.workspace.id, starter.id);
    assert.equal(current.changeScope, "workspace");
  } finally {
    await app.stop();
  }
});

test("Bridge rejects non-loopback Host and Origin headers", async () => {
  const root = await mkdtemp(join(tmpdir(), "ff-bridge-host-"));
  const app = new BridgeApp({ host: "127.0.0.1", port: 0, dataDir: join(root, "data"), projectRoot: resolve(import.meta.dirname, "../..") });
  const address = await app.start();
  try {
    assert.equal(await statusWithHost(address.host, address.port, "attacker.example"), 403);
    const badOrigin = await fetch(`${address.url}/api/health`, { headers: { Origin: "https://attacker.example" } });
    assert.equal(badOrigin.status, 403);
    const localOrigin = await fetch(`${address.url}/api/health`, { headers: { Origin: "http://127.0.0.1:4173" } });
    assert.equal(localOrigin.status, 200);
    const unrelatedLocalOrigin = await fetch(`${address.url}/api/health`, { headers: { Origin: "http://127.0.0.1:9999" } });
    assert.equal(unrelatedLocalOrigin.status, 403);
  } finally {
    await app.stop();
  }
});

async function statusWithHost(host: string, port: number, authority: string): Promise<number | undefined> {
  return await new Promise((resolveStatus, rejectStatus) => {
    const request = httpRequest({ host, port, path: "/api/health", headers: { Host: authority } }, (response) => {
      response.resume();
      response.once("end", () => resolveStatus(response.statusCode));
    });
    request.once("error", rejectStatus);
    request.end();
  });
}

async function getJson(url: string): Promise<Record<string, any>> {
  const response = await fetch(url);
  const text = await response.text();
  assert.equal(response.ok, true, text);
  return JSON.parse(text) as Record<string, any>;
}

async function postJson(url: string, body: unknown): Promise<Record<string, any>> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  assert.equal(response.ok, true, text);
  return JSON.parse(text) as Record<string, any>;
}
