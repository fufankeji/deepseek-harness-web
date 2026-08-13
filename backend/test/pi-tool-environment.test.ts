import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createBashTool } from "@earendil-works/pi-coding-agent";
import { createSafeBashSpawnHook, deriveSettledStatus, normalizeToolPath } from "../src/adapters/pi/pi-harness-adapter.js";

test("Pi bash tool receives an explicit environment allowlist", async () => {
  process.env.FF_TOOL_SECRET_PROBE = "must-not-reach-tool";
  const tool = createBashTool(process.cwd(), {
    exposeSessionEnvironment: false,
    spawnHook: createSafeBashSpawnHook()
  });
  try {
    const result = await tool.execute("env-probe", { command: "node -e \"console.log(process.env.FF_TOOL_SECRET_PROBE ?? 'missing')\"" }, undefined);
    const output = result.content.map((entry) => entry.type === "text" ? entry.text : "").join("\n");
    assert.match(output, /missing/);
    assert.doesNotMatch(output, /must-not-reach-tool/);
  } finally {
    delete process.env.FF_TOOL_SECRET_PROBE;
  }
});

test("Pi file tool boundary rejects a new file below an escaping symlink directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "ff-tool-path-"));
  const workspace = join(root, "workspace");
  const outside = join(root, "outside");
  await mkdir(workspace);
  await mkdir(outside);
  await symlink(outside, join(workspace, "escape"));

  await assert.rejects(() => normalizeToolPath(workspace, "escape/new-file.txt"), /超出工作区/);
  assert.equal(await normalizeToolPath(workspace, "safe/new-file.txt"), "safe/new-file.txt");
});

test("a terminal blocked tool call settles the Run as failed", () => {
  const status = deriveSettledStatus({
    messages: [{ role: "assistant", stopReason: "toolUse" }]
  } as never, {
    interruptRequested: false,
    lastToolCompletionFailed: true
  });
  assert.equal(status, "failed");
});

test("a later assistant conclusion can recover from an earlier tool failure", () => {
  const status = deriveSettledStatus({
    messages: [{ role: "assistant", stopReason: "stop" }]
  } as never, {
    interruptRequested: false,
    lastToolCompletionFailed: true
  });
  assert.equal(status, "completed");
});
