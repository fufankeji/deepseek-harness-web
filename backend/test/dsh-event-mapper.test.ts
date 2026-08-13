import assert from "node:assert/strict";
import test from "node:test";
import { dshTurnStatus, mapDshEvent } from "../src/adapters/deepseek-official/dsh-event-mapper.js";

test("maps durable DeepSeek Harness message and tool events into the shared contract", () => {
  const started = mapDshEvent(sourceEvent("tool/call", 10, {
    callId: "call-1",
    name: "read",
    arguments: JSON.stringify({ file_path: "src/index.ts" })
  }));
  assert.deepEqual(started[0]?.payload, {
    toolCallId: "call-1",
    toolName: "read",
    args: { file_path: "src/index.ts" }
  });

  const completed = mapDshEvent(sourceEvent("tool/result", 11, {
    message: {
      source: { kind: "tool", callId: "call-1" },
      content: [{ type: "tool-result", toolCallId: "call-1", content: [{ type: "text", text: "ok" }], isError: false }],
      role: "user"
    },
    meta: { diffs: [{ path: "src/index.ts" }] }
  }));
  assert.deepEqual(completed[0]?.payload, {
    toolCallId: "call-1",
    output: "ok",
    details: { diffs: [{ path: "src/index.ts" }] },
    isError: false
  });
});

test("maps streaming deltas while dropping understood construction fragments", () => {
  assert.equal(mapDshEvent(sourceEvent("assistant/chunk", 1, { chunk: { type: "text-delta", index: 0, text: "你好" } }))[0]?.kind, "message.delta");
  assert.equal(mapDshEvent(sourceEvent("assistant/chunk", 2, { chunk: { type: "reasoning-delta", index: 0, text: "分析" } }))[0]?.kind, "thinking.delta");
  assert.deepEqual(mapDshEvent(sourceEvent("assistant/chunk", 3, { chunk: { type: "tool-call-delta", index: 1, delta: "{}" } })), []);
});

test("sanitizes unknown official events before retaining raw diagnostics", () => {
  const [mapped] = mapDshEvent(sourceEvent("future/event", 3, {
    apiKey: "sk-super-secret-value",
    authorization: "Bearer should-not-survive",
    nested: { accessToken: "token-value", text: "safe" },
    content: "private prompt body",
    cwd: "/workspace/private-project"
  }));
  const serialized = JSON.stringify(mapped);
  assert.equal(mapped?.kind, "raw");
  assert.doesNotMatch(serialized, /super-secret|should-not-survive|token-value/);
  assert.doesNotMatch(serialized, /private prompt body|private-project/);
  assert.match(serialized, /REDACTED/);
});

test("retains request header shape without persisting its prompt body", () => {
  const [mapped] = mapDshEvent(sourceEvent("request/header", 4, {
    reason: "turn-start",
    header: [{ role: "system", content: "private system prompt" }, { role: "user", content: "private user context" }]
  }));
  const serialized = JSON.stringify(mapped);
  assert.doesNotMatch(serialized, /private system prompt|private user context/);
  assert.match(serialized, /headerBlockCount/);
});

test("keeps ordinary known diagnostic events intact", () => {
  const [mapped] = mapDshEvent(sourceEvent("step/start", 5, { turn: 2, step: 1 }));
  assert.deepEqual(mapped?.raw?.data, { dataKeys: ["turn", "step"], turn: 2, step: 1 });
});

test("normalizes official turn terminal reasons", () => {
  assert.equal(dshTurnStatus(sourceEvent("turn/end", 20, { reason: { kind: "completed" } })), "completed");
  assert.equal(dshTurnStatus(sourceEvent("turn/end", 21, { reason: { kind: "cancelled" } })), "cancelled");
  assert.equal(dshTurnStatus(sourceEvent("turn/end", 22, { reason: { kind: "provider-error" } })), "failed");
});

function sourceEvent(type: string, seq: number, data: unknown) {
  return { type, seq, time: 1_786_000_000_000 + seq, data };
}
