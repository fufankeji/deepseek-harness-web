import assert from "node:assert/strict";
import test from "node:test";
import { mapPiEvent } from "../src/adapters/pi/pi-event-mapper.js";

test("Pi text updates become delta and tool updates become snapshot", () => {
  const messageEvents = mapPiEvent({
    type: "message_update",
    message: assistantMessage(),
    assistantMessageEvent: {
      type: "text_delta",
      contentIndex: 0,
      delta: "你好",
      partial: assistantMessage()
    }
  });
  assert.equal(messageEvents[0]?.kind, "message.delta");
  assert.equal(messageEvents[0]?.updateMode, "delta");
  assert.equal(messageEvents[0]?.payload.delta, "你好");

  const toolEvents = mapPiEvent({
    type: "tool_execution_update",
    toolCallId: "tool-1",
    toolName: "bash",
    args: { command: "node test.mjs" },
    partialResult: { content: [{ type: "text", text: "complete snapshot" }], details: {} }
  });
  assert.equal(toolEvents[0]?.kind, "tool.output");
  assert.equal(toolEvents[0]?.updateMode, "snapshot");
  assert.equal(toolEvents[0]?.payload.output, "complete snapshot");

  const completion = mapPiEvent({
    type: "tool_execution_end",
    toolCallId: "tool-1",
    toolName: "bash",
    result: { content: [{ type: "text", text: "ok" }], details: {} },
    isError: false
  });
  assert.equal(completion[0]?.payload.exitCode, 0);
  assert.equal(completion[0]?.payload.cancelled, false);

  const usage = mapPiEvent({ type: "message_end", message: assistantMessage() });
  const usageEvent = usage.find((event) => event.kind === "usage.updated");
  assert.equal(usageEvent?.payload.costSource, "pi-model-config-estimate");
});

test("raw fallback excludes prompt and content bodies", () => {
  const events = mapPiEvent({
    type: "entry_appended",
    entry: {
      type: "custom",
      id: "entry-1",
      parentId: null,
      timestamp: new Date().toISOString(),
      customType: "private",
      data: { prompt: "secret prompt", apiKey: "sk-secretsecret" }
    }
  });
  const serialized = JSON.stringify(events);
  assert.doesNotMatch(serialized, /secret prompt|sk-secretsecret|apiKey/);
  assert.match(serialized, /entry_appended/);
});

function assistantMessage() {
  return {
    role: "assistant" as const,
    content: [{ type: "text" as const, text: "" }],
    api: "openai-completions" as const,
    provider: "deepseek",
    model: "deepseek-v4-flash",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    },
    stopReason: "pending" as const,
    timestamp: Date.now()
  };
}
