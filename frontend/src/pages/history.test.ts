import { describe, expect, it } from "vitest";
import type { HarnessEvent } from "../api/contracts";
import { summarizeHistoricalRuns } from "./history";

describe("会话历史摘要", () => {
  it("排除当前 Run，并从历史真实事件恢复任务、回答、工具数与终态", () => {
    const events: HarnessEvent[] = [
      event(1, "run-old", "message.completed", { role: "user", text: "  修复   历史任务  " }),
      event(2, "run-old", "tool.started", { toolCallId: "read-1" }),
      event(3, "run-old", "tool.started", { toolCallId: "read-1" }),
      event(4, "run-old", "message.completed", { role: "assistant", text: "已修复。" }),
      event(5, "run-old", "run.settled", { status: "completed" }),
      event(6, "run-current", "message.completed", { role: "user", text: "当前任务" })
    ];

    expect(summarizeHistoricalRuns(events, "run-current")).toEqual([{
      id: "run-old",
      prompt: "修复 历史任务",
      assistant: "已修复。",
      status: "completed",
      toolCount: 1,
      firstSequence: 1,
      lastSequence: 5
    }]);
  });

  it("历史摘要不会把 Harness 注入消息当成用户任务", () => {
    const events: HarnessEvent[] = [
      event(1, "run-old", "message.completed", { role: "user", text: "分析完整项目" }),
      event(2, "run-old", "message.completed", { role: "user", text: "<system-reminder>internal catalog</system-reminder>" }),
      event(3, "run-old", "message.completed", { role: "user", text: "Current runtime context. Internal only." }),
      event(4, "run-old", "message.completed", { role: "assistant", text: "分析完成。" }),
      event(5, "run-old", "run.settled", { status: "completed" })
    ];

    expect(summarizeHistoricalRuns(events, null)[0]?.prompt).toBe("分析完整项目");
  });

  it("只有 Harness 注入消息的内部 Run 不进入用户历史", () => {
    const events: HarnessEvent[] = [
      event(1, "run-internal", "message.completed", { role: "user", text: "Current runtime context. Internal only." }),
      event(2, "run-internal", "tool.started", { toolCallId: "read-internal" }),
      event(3, "run-internal", "message.completed", { role: "assistant", text: "内部处理完成。" }),
      event(4, "run-internal", "run.settled", { status: "completed" })
    ];

    expect(summarizeHistoricalRuns(events, null)).toEqual([]);
  });
});

function event(sequence: number, runId: string, kind: string, payload: Record<string, unknown>): HarnessEvent {
  return {
    id: `${runId}-${sequence}`,
    sequence,
    sessionId: "session-history",
    runId,
    runtimeGeneration: 1,
    kind,
    source: "harness",
    timestamp: `2026-08-12T00:00:${String(sequence).padStart(2, "0")}.000Z`,
    payload
  };
}
