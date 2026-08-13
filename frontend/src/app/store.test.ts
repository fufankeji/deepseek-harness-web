import { describe, expect, it } from "vitest";
import type { HarnessEvent } from "../api/contracts";
import { harnessActions, harnessReducer } from "./store";

const sessionId = "session-real-fixture";
const runId = "run-real-fixture";

describe("真实事件归约", () => {
  it("模型诊断刷新后保留脱敏错误，并同步真实思考强度", () => {
    let state = harnessReducer(undefined, harnessActions.setModel({
      provider: "deepseek",
      modelId: "deepseek-v4-pro",
      thinkingLevel: "max",
      availableThinkingLevels: ["high", "max"],
      status: "unavailable",
      credentialStorage: "memory-only",
      errorCode: "deepseek_unavailable",
      errorMessage: "暂时无法连接 DeepSeek。"
    }));
    expect(state.setup).toMatchObject({ model: "error", modelId: "deepseek-v4-pro", thinkingLevel: "max", errorMessage: "暂时无法连接 DeepSeek。" });
    state = harnessReducer(state, harnessActions.setSetupStep("model"));
    expect(state.setup.errorMessage).toBe("暂时无法连接 DeepSeek。");

    state = harnessReducer(state, harnessActions.setModel({
      provider: "deepseek",
      modelId: "deepseek-v4-pro",
      thinkingLevel: "max",
      availableThinkingLevels: ["high", "max"],
      status: "ready",
      credentialStorage: "memory-only"
    }));
    expect(state.setup.model).toBe("complete");
    expect(state.setup.errorMessage).toBeNull();
  });

  it("更换模型或思考强度后要求重新验证", () => {
    let state = harnessReducer(undefined, harnessActions.setModel({
      provider: "deepseek",
      modelId: "deepseek-v4-flash",
      thinkingLevel: "high",
      availableThinkingLevels: ["high", "max"],
      status: "ready",
      credentialStorage: "memory-only"
    }));
    state = harnessReducer(state, harnessActions.setThinkingLevel("max"));
    expect(state.setup).toMatchObject({ model: "idle", thinkingLevel: "max", errorMessage: null });

    state = harnessReducer(state, harnessActions.setModelId("deepseek-v4-pro"));
    expect(state.setup).toMatchObject({ model: "idle", modelId: "deepseek-v4-pro", errorMessage: null });
  });

  it("工作台默认打开会话代码坞", () => {
    const state = harnessReducer(undefined, { type: "@@init" });
    expect(state.activeDock).toBe("sessions");
  });

  it("从 Bridge 工作区快照恢复已配置状态与资源信任", () => {
    const state = harnessReducer(undefined, harnessActions.hydrateWorkspace({
      workspace: { id: "restored", name: "restored", status: "ready", displayPath: "已恢复工作区", branch: "main", git: true, projectTrusted: false, fileCount: 0, fileScanLimited: false, checkedAt: new Date().toISOString() },
      files: [],
      changes: [],
      changeScope: "workspace"
    }));

    expect(state.setup.workspace).toBe("complete");
    expect(state.setup.trust).toBe("restricted");
  });

  it("按 delta/snapshot/final 形成消息、Turn、工具、用量和终态", () => {
    let state = harnessReducer(undefined, { type: "@@init" });
    state = harnessReducer(state, harnessActions.setCurrentSession({
      id: sessionId,
      name: "真实事件回放",
      updatedAt: "2026-08-12T15:54:55.000Z",
      modelId: "deepseek-v4-flash",
      runStatus: "idle",
      recoverable: true
    }));
    const events = [
      event(1, "run.acknowledged", { status: "acknowledged" }, "final"),
      event(2, "run.started", { status: "running" }),
      event(3, "turn.started", {}),
      event(4, "message.delta", { delta: "已" }, "delta"),
      event(5, "message.delta", { delta: "完成" }, "delta"),
      event(6, "tool.started", { toolCallId: "tool-1", toolName: "bash", args: { command: "node test.mjs" } }),
      event(7, "tool.output", { toolCallId: "tool-1", output: "running" }, "snapshot"),
      event(8, "tool.output", { toolCallId: "tool-1", output: "done" }, "snapshot"),
      event(9, "tool.completed", { toolCallId: "tool-1", output: "ok", isError: false, exitCode: 0, details: { truncated: false } }, "final"),
      event(10, "turn.completed", { stopReason: "stop" }, "final"),
      event(11, "message.completed", { role: "assistant", text: "任务已完成" }, "final"),
      event(12, "usage.updated", { input: 10, output: 4, totalTokens: 14 }, "snapshot"),
      event(13, "run.settling", { status: "settling" }),
      event(14, "run.settled", { status: "completed" }, "final")
    ];
    state = harnessReducer(state, harnessActions.setEvents(events));

    expect(state.assistantText).toBe("任务已完成");
    expect(state.runStatus).toBe("completed");
    expect(state.tools[0]).toMatchObject({ output: "ok", status: "completed", exitCode: 0 });
    expect(state.tools[0]?.startedAt).toBe(events[5]?.timestamp);
    expect(state.tools[0]?.endedAt).toBe(events[8]?.timestamp);
    expect(state.activity[0]).toMatchObject({ kind: "turn", status: "completed" });
    expect(state.usage?.totalTokens).toBe(14);
  });

  it("不会让 Harness 注入的运行上下文覆盖用户任务", () => {
    let state = harnessReducer(undefined, { type: "@@init" });
    state = harnessReducer(state, harnessActions.setCurrentSession({
      id: sessionId, name: "提示词隔离", updatedAt: new Date().toISOString(), modelId: "deepseek-v4-flash", runStatus: "idle", recoverable: true
    }));
    state = harnessReducer(state, harnessActions.receiveEvent(event(1, "message.completed", { role: "user", text: "修复计数器" }, "final")));
    state = harnessReducer(state, harnessActions.receiveEvent(event(2, "message.completed", { role: "user", text: "Current runtime context. This snapshot supersedes earlier runtime-context snapshots." }, "final")));
    state = harnessReducer(state, harnessActions.receiveEvent(event(3, "message.completed", { role: "user", text: "<system-reminder>internal catalog</system-reminder>" }, "final")));

    expect(state.currentPrompt).toBe("修复计数器");
  });

  it("去重、报告同代序号缺口并阻止旧 runtime generation 污染当前视图", () => {
    let state = harnessReducer(undefined, { type: "@@init" });
    state = harnessReducer(state, harnessActions.setCurrentSession({
      id: sessionId, name: "代次隔离", updatedAt: new Date().toISOString(), modelId: "deepseek-v4-flash", runStatus: "idle", recoverable: true
    }));
    const current = { ...event(3, "message.delta", { delta: "当前" }, "delta"), runtimeGeneration: 2 };
    state = harnessReducer(state, harnessActions.receiveEvent(current));
    state = harnessReducer(state, harnessActions.receiveEvent(current));
    state = harnessReducer(state, harnessActions.receiveEvent({ ...event(5, "message.delta", { delta: "视图" }, "delta"), runtimeGeneration: 2 }));
    state = harnessReducer(state, harnessActions.receiveEvent({ ...event(6, "message.delta", { delta: "旧事件" }, "delta"), runtimeGeneration: 1 }));

    expect(state.events).toHaveLength(3);
    expect(state.assistantText).toBe("当前视图");
    expect(state.sequenceGap).toEqual({ expected: 4, received: 5 });

    state = harnessReducer(state, harnessActions.receiveEvent({ ...event(4, "message.delta", { delta: "补齐" }, "delta"), runtimeGeneration: 2 }));
    expect(state.sequenceGap).toBeNull();
    expect(state.assistantText).toBe("当前补齐视图");
  });

  it("完整历史回放忽略新代次之后才落盘的旧代次事件", () => {
    let state = harnessReducer(undefined, { type: "@@init" });
    state = harnessReducer(state, harnessActions.setCurrentSession({
      id: sessionId, name: "重启代次", updatedAt: new Date().toISOString(), modelId: "deepseek-v4-flash", runStatus: "unknown", recoverable: true
    }));
    state = harnessReducer(state, harnessActions.setEvents([
      { ...event(1, "message.delta", { delta: "有效" }, "delta"), runtimeGeneration: 4 },
      { ...event(2, "run.settled", { status: "unknown" }, "final"), runtimeGeneration: 5 },
      { ...event(3, "message.delta", { delta: "迟到旧事件" }, "delta"), runtimeGeneration: 4 }
    ]));
    expect(state.assistantText).toBe("有效");
    expect(state.runStatus).toBe("unknown");
  });

  it("切换工作区会清除旧工作区的 Session、Run 与文件投影", () => {
    let state = harnessReducer(undefined, { type: "@@init" });
    state = harnessReducer(state, harnessActions.setWorkspace({ id: "old", name: "old", status: "ready", displayPath: "old", branch: null, git: false, projectTrusted: false, fileCount: 1, fileScanLimited: false, checkedAt: new Date().toISOString() }));
    state = harnessReducer(state, harnessActions.setCurrentSession({ id: sessionId, name: "旧会话", updatedAt: new Date().toISOString(), modelId: "deepseek-v4-flash", runStatus: "completed", recoverable: true }));
    state = harnessReducer(state, harnessActions.setWorkspace({ id: "new", name: "new", status: "ready", displayPath: "new", branch: null, git: false, projectTrusted: false, fileCount: 0, fileScanLimited: false, checkedAt: new Date().toISOString() }));
    expect(state.selectedSessionId).toBe("");
    expect(state.sessions).toEqual([]);
    expect(state.runStatus).toBe("idle");
  });

  it("没有运行时活动会话时恢复当前工作区最近会话", () => {
    let state = harnessReducer(undefined, { type: "@@init" });
    state = harnessReducer(state, harnessActions.restoreActiveSession({
      sessions: [{ id: "recent", name: "最近会话", updatedAt: new Date().toISOString(), modelId: "deepseek-v4-flash", runStatus: "completed", recoverable: true }],
      activeSessionId: "recent"
    }));
    expect(state.selectedSessionId).toBe("recent");
    expect(state.runStatus).toBe("completed");
  });

  it("删除会话时只移除目标，并安全清空被删除的当前会话投影", () => {
    let state = harnessReducer(undefined, { type: "@@init" });
    state = harnessReducer(state, harnessActions.setCurrentSession({ id: "keep", name: "保留会话", updatedAt: new Date().toISOString(), modelId: "deepseek-v4-flash", runStatus: "idle", recoverable: true }));
    state = harnessReducer(state, harnessActions.setCurrentSession({ id: "remove", name: "删除会话", updatedAt: new Date().toISOString(), modelId: "deepseek-v4-flash", runStatus: "completed", recoverable: true }));
    state = harnessReducer(state, harnessActions.removeSession("remove"));

    expect(state.sessions.map((entry) => entry.id)).toEqual(["keep"]);
    expect(state.selectedSessionId).toBe("");
    expect(state.sessionDetached).toBe(true);
    expect(state.runStatus).toBe("idle");
    expect(state.events).toEqual([]);
  });

  it("稍晚到达的命令回执不会覆盖已经开始或结束的真实事件状态", () => {
    let state = harnessReducer(undefined, { type: "@@init" });
    state = harnessReducer(state, harnessActions.setCurrentSession({
      id: sessionId, name: "回执竞态", updatedAt: new Date().toISOString(), modelId: "deepseek-v4-flash", runStatus: "idle", recoverable: true
    }));
    state = harnessReducer(state, harnessActions.beginRun({ text: "执行测试", requestId: "request-1" }));
    state = harnessReducer(state, harnessActions.receiveEvent(event(1, "run.started", { status: "running" })));
    state = harnessReducer(state, harnessActions.applyReceipt({ requestId: "request-1", accepted: true, sessionId, runId }));
    expect(state.runStatus).toBe("running");

    state = harnessReducer(state, harnessActions.receiveEvent(event(2, "run.settled", { status: "completed" }, "final")));
    state = harnessReducer(state, harnessActions.applyReceipt({ requestId: "request-1", accepted: true, sessionId, runId }));
    expect(state.runStatus).toBe("completed");
    expect(state.pendingRequestId).toBeNull();
  });

  it("提交失败时保留请求 ID 供安全重试，修改任务后才生成新请求", () => {
    let state = harnessReducer(undefined, { type: "@@init" });
    state = harnessReducer(state, harnessActions.beginRun({ text: "保持同一任务", requestId: "stable-request" }));
    state = harnessReducer(state, harnessActions.commandFailed("网络暂时不可用"));
    expect(state.pendingRequestId).toBe("stable-request");

    state = harnessReducer(state, harnessActions.setComposerDraft("修改后的任务"));
    expect(state.pendingRequestId).toBeNull();
  });

  it("网络丢失回执后由真实 acknowledged 事件收敛提交状态", () => {
    let state = harnessReducer(undefined, { type: "@@init" });
    state = harnessReducer(state, harnessActions.setCurrentSession({ id: sessionId, name: "回执恢复", updatedAt: new Date().toISOString(), modelId: "deepseek-v4-flash", runStatus: "idle", recoverable: true }));
    state = harnessReducer(state, harnessActions.setComposerDraft("真实任务"));
    state = harnessReducer(state, harnessActions.beginRun({ text: "真实任务", requestId: "request-lost" }));
    state = harnessReducer(state, harnessActions.commandFailed("网络中断"));
    expect(state.pendingRequestId).toBe("request-lost");
    state = harnessReducer(state, harnessActions.receiveEvent(event(1, "run.acknowledged", { requestId: "request-lost", status: "acknowledged" }, "final")));
    expect(state.runStatus).toBe("acknowledged");
    expect(state.pendingRequestId).toBeNull();
    expect(state.composerDraft).toBe("");
  });

  it("工作区树保留已删除文件并区分重命名状态", () => {
    let state = harnessReducer(undefined, { type: "@@init" });
    state = harnessReducer(state, harnessActions.hydrateWorkspace({
      workspace: { id: "workspace", name: "repo", status: "ready", displayPath: "repo", branch: "main", git: true, projectTrusted: false, fileCount: 1, fileScanLimited: false, checkedAt: new Date().toISOString() },
      files: [{ path: "new.ts", name: "new.ts", kind: "file", depth: 0 }],
      changes: [
        { path: "new.ts", previousPath: "old.ts", status: "renamed", staged: true, unstaged: false },
        { path: "removed.ts", status: "deleted", staged: false, unstaged: true }
      ],
      changeScope: "run"
    }));
    expect(state.files.find((entry) => entry.path === "new.ts")).toMatchObject({ changeKind: "renamed", staged: true, unstaged: false, previousPath: "old.ts" });
    expect(state.files.find((entry) => entry.path === "removed.ts")).toMatchObject({ changed: true, changeKind: "deleted" });
  });

  it("实时事件先到时，稍后的旧 HTTP 快照不会覆盖它", () => {
    let state = harnessReducer(undefined, { type: "@@init" });
    state = harnessReducer(state, harnessActions.setCurrentSession({ id: sessionId, name: "快照竞态", updatedAt: new Date().toISOString(), modelId: "deepseek-v4-flash", runStatus: "idle", recoverable: true }));
    const first = event(1, "message.delta", { delta: "先" }, "delta");
    const live = event(2, "message.delta", { delta: "到" }, "delta");
    state = harnessReducer(state, harnessActions.receiveEvent(live));
    state = harnessReducer(state, harnessActions.setEvents([first]));
    expect(state.events.map((item) => item.id)).toEqual([first.id, live.id]);
    expect(state.assistantText).toBe("先到");
  });

  it("中断产生的工具终态显示为已取消而不是失败", () => {
    let state = harnessReducer(undefined, { type: "@@init" });
    state = harnessReducer(state, harnessActions.setCurrentSession({
      id: sessionId, name: "中断工具", updatedAt: new Date().toISOString(), modelId: "deepseek-v4-flash", runStatus: "idle", recoverable: true
    }));
    state = harnessReducer(state, harnessActions.receiveEvent(event(1, "tool.started", { toolCallId: "bash-1", toolName: "bash", args: { command: "node wait.mjs" } })));
    state = harnessReducer(state, harnessActions.receiveEvent(event(2, "tool.completed", { toolCallId: "bash-1", toolName: "bash", isError: true, cancelled: true, exitCode: null }, "final")));
    expect(state.tools[0]?.status).toBe("cancelled");
  });

  it("失败工具保留真实拦截原因供工作台直接展示", () => {
    let state = harnessReducer(undefined, { type: "@@init" });
    state = harnessReducer(state, harnessActions.setCurrentSession({
      id: sessionId, name: "受限命令", updatedAt: new Date().toISOString(), modelId: "deepseek-v4-pro", runStatus: "idle", recoverable: true
    }));
    state = harnessReducer(state, harnessActions.receiveEvent(event(1, "tool.started", { toolCallId: "bash-blocked", toolName: "bash", args: { command: "mkdir project" } })));
    state = harnessReducer(state, harnessActions.receiveEvent(event(2, "tool.completed", {
      toolCallId: "bash-blocked",
      toolName: "bash",
      output: "验收工作区只允许运行当前模板的精确命令。",
      isError: true,
      cancelled: false,
      exitCode: null
    }, "final")));
    expect(state.tools[0]).toMatchObject({
      status: "failed",
      output: "验收工作区只允许运行当前模板的精确命令。",
      exitCode: null
    });
  });

  it("并行工具按 toolCallId 关联，逆序完成不会串线", () => {
    let state = harnessReducer(undefined, { type: "@@init" });
    state = harnessReducer(state, harnessActions.setCurrentSession({ id: sessionId, name: "并行工具", updatedAt: new Date().toISOString(), modelId: "deepseek-v4-flash", runStatus: "idle", recoverable: true }));
    state = harnessReducer(state, harnessActions.receiveEvent(event(1, "tool.started", { toolCallId: "first", toolName: "read", args: { path: "a.ts" } })));
    state = harnessReducer(state, harnessActions.receiveEvent(event(2, "tool.started", { toolCallId: "second", toolName: "read", args: { path: "b.ts" } })));
    state = harnessReducer(state, harnessActions.receiveEvent(event(3, "tool.completed", { toolCallId: "second", toolName: "read", output: "B", isError: false }, "final")));
    state = harnessReducer(state, harnessActions.receiveEvent(event(4, "tool.completed", { toolCallId: "first", toolName: "read", output: "A", isError: false }, "final")));
    expect(state.tools.find((tool) => tool.id === "first")).toMatchObject({ detail: "a.ts", output: "A", status: "completed" });
    expect(state.tools.find((tool) => tool.id === "second")).toMatchObject({ detail: "b.ts", output: "B", status: "completed" });
  });

  it("文件变化只作为同一 Run 的观察关联展示", () => {
    let state = harnessReducer(undefined, { type: "@@init" });
    state = harnessReducer(state, harnessActions.setCurrentSession({ id: sessionId, name: "变化关联", updatedAt: new Date().toISOString(), modelId: "deepseek-v4-flash", runStatus: "idle", recoverable: true }));
    state = harnessReducer(state, harnessActions.receiveEvent(event(1, "tool.started", { toolCallId: "edit-1", toolName: "edit", args: { path: "src/a.ts" } })));
    state = harnessReducer(state, harnessActions.receiveEvent(event(2, "workspace.changed", { changes: [{ path: "src/a.ts", status: "modified" }] }, "snapshot")));
    expect(state.tools[0]?.observedChangedPaths).toEqual(["src/a.ts"]);
  });

  it("重连后的首个真实活动恢复运行态，中断请求失败也不会伪造终态", () => {
    let state = harnessReducer(undefined, { type: "@@init" });
    state = harnessReducer(state, harnessActions.setCurrentSession({
      id: sessionId, name: "重连恢复", updatedAt: new Date().toISOString(), modelId: "deepseek-v4-flash", runStatus: "running", recoverable: true
    }));
    state = harnessReducer(state, harnessActions.setConnection("disconnected"));
    expect(state.runStatus).toBe("unknown");
    state = harnessReducer(state, harnessActions.receiveEvent(event(1, "tool.output", { toolCallId: "missing", output: "progress" }, "snapshot")));
    expect(state.runStatus).toBe("running");
    state = harnessReducer(state, harnessActions.markInterrupting());
    state = harnessReducer(state, harnessActions.interruptFailed());
    expect(state.runStatus).toBe("running");
  });
});

function event(sequence: number, kind: string, payload: Record<string, unknown>, updateMode?: HarnessEvent["updateMode"]): HarnessEvent {
  return {
    id: `event-${sequence}`,
    sequence,
    sessionId,
    runId,
    runtimeGeneration: 1,
    kind,
    source: kind.startsWith("run.") ? "bridge" : "harness",
    timestamp: `2026-08-12T15:54:${String(50 + sequence).padStart(2, "0")}.000Z`,
    ...(updateMode ? { updateMode } : {}),
    payload
  };
}
