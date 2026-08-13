import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ToolOutputStore } from "../src/runtime/tool-output-store.js";

test("truncated Pi output is copied behind an opaque id and sanitized", async () => {
  const root = await mkdtemp(join(tmpdir(), "ff-tool-output-"));
  const source = join(tmpdir(), `ff-pi-output-${crypto.randomUUID()}.txt`);
  await writeFile(source, "first\nsk-secretsecret\nauthorization: bearer-value\n");
  const store = new ToolOutputStore(root);
  const captured = await store.capturePiTempFile(source);
  assert.ok(captured?.outputId);
  assert.doesNotMatch(captured.outputId, /ff-pi-output|tmp/);
  const opened = await store.open(captured.outputId);
  const chunks: Buffer[] = [];
  for await (const chunk of opened.stream) chunks.push(Buffer.from(chunk));
  const value = Buffer.concat(chunks).toString("utf8");
  assert.match(value, /\[REDACTED\]/);
  assert.doesNotMatch(value, /sk-secretsecret|bearer-value/);
  await assert.rejects(() => store.open("../../escape"), /标识无效/);
  await store.remove(captured.outputId);
  await assert.rejects(() => store.open(captured.outputId), /完整工具输出不存在/);
});
