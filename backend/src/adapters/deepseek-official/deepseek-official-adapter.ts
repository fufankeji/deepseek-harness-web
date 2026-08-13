import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type {
  AcceptanceRecord,
  CapabilitySet,
  CommandExecutionResult,
  CommandReceipt,
  ExecuteHarnessCommandInput,
  HarnessCommand,
  HarnessEvent,
  ModelInfo,
  RunStatus,
  RuntimeInfo,
  SessionSummary
} from "../../contracts.js";
import { BridgeError } from "../../errors.js";
import type { CredentialStore } from "../../secrets/credential-store.js";
import type { EventBus } from "../../runtime/event-bus.js";
import { runProcess } from "../../runtime/process-runner.js";
import type { AcceptanceRecordStore, EventStore } from "../../sessions/event-store.js";
import type { WorkspaceService } from "../../workspace/workspace-service.js";
import type { HarnessAdapter, SubmitTaskInput } from "../harness-adapter.js";
import { dshTurnStatus, mapDshEvent } from "./dsh-event-mapper.js";
import { DSH_RESTRICTED_PRESET, DSH_VERSION, DshWebRuntime, type DshFrame, type DshSessionEvent } from "./dsh-web-runtime.js";

const CAPABILITIES: CapabilitySet = {
  structuredEvents: true,
  resumableSessions: true,
  sessionFork: true,
  steering: true,
  followUp: true,
  interrupt: true,
  tools: true,
  compaction: true,
  retry: true,
  approvals: false,
  sandbox: true
};

interface DshSessionListItem {
  sessionId: string;
  updatedAt: number;
  running: boolean;
  blank: boolean;
  cwd?: string;
  origin?: "subagent";
  agentPreset?: string;
  projections?: { values?: Record<string, unknown> };
}

interface ActiveRun {
  id: string;
  requestId: string;
  status: RunStatus;
  settled: boolean;
}

export class DeepSeekOfficialAdapter implements HarnessAdapter {
  readonly id = "deepseek-official" as const;
  #runtime: DshWebRuntime | undefined;
  #runtimeCwd: string | undefined;
  #activeSessionId: string | null = null;
  #runtimeGeneration = 0;
  #activeRun: ActiveRun | undefined;
  #eventQueue = Promise.resolve();
  #pendingRequests = new Map<string, Promise<CommandReceipt>>();
  #pendingCommands = new Map<string, Promise<CommandExecutionResult>>();
  #lastSourceSeq = new Map<string, number>();
  #toolNames = new Map<string, string>();
  #model: ModelInfo;

  constructor(
    private readonly dataDir: string,
    private readonly credentialStore: CredentialStore,
    private readonly workspaceService: WorkspaceService,
    private readonly eventStore: EventStore,
    private readonly eventBus: EventBus,
    private readonly acceptanceRecordStore: AcceptanceRecordStore,
    defaultModel = "deepseek-v4-flash"
  ) {
    this.#model = {
      provider: "deepseek",
      modelId: normalizeModelId(defaultModel),
      thinkingLevel: "high",
      availableThinkingLevels: ["high", "max"],
      status: "unconfigured",
      credentialStorage: "ephemeral-runtime"
    };
  }

  get activeSessionId(): string | null {
    return this.#activeSessionId;
  }

  async probe(): Promise<RuntimeInfo> {
    return {
      adapterId: this.id,
      adapterVersion: "0.1.0",
      harnessId: "deepseek-harness",
      harnessVersion: DSH_VERSION,
      displayName: "DeepSeek Harness",
      bridgeVersion: "0.1.0",
      nodeVersion: process.version,
      status: Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10) >= 24 ? "ready" : "incompatible",
      capabilities: this.getCapabilities(),
      checkedAt: new Date().toISOString()
    };
  }

  getCapabilities(): CapabilitySet {
    return { ...CAPABILITIES };
  }

  getModelInfo(): ModelInfo {
    return { ...this.#model };
  }

  async connectModel(modelId?: string, verify = true, thinkingLevel: "high" | "max" = "high"): Promise<ModelInfo> {
    this.assertIdle();
    await this.dispose();
    const selectedModel = normalizeModelId(modelId ?? this.#model.modelId);
    this.#model = cleanModel({ ...this.#model, modelId: selectedModel, thinkingLevel, status: "probing", checkedAt: new Date().toISOString() });
    try {
      const probeRoot = join(this.dataDir, "deepseek-official", "connection-check");
      await mkdir(probeRoot, { recursive: true, mode: 0o700 });
      const runtime = await this.startRuntime(probeRoot);
      const created = await runtime.call<{ sessionId: string }>("session.create", { cwd: probeRoot });
      await this.selectModel(created.sessionId);
      if (verify) {
        await runtime.call("session.prompt", {
          sessionId: created.sessionId,
          mode: "queue",
          content: [{ type: "text", text: "只回复 OK" }],
          clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
        });
        await waitForTurnEnd(runtime, created.sessionId, 120_000);
      }
      this.#model = cleanModel({ ...this.#model, status: "ready", checkedAt: new Date().toISOString() });
    } catch (error) {
      const normalized = modelFailure(error);
      this.#model = { ...this.#model, status: normalized.status, checkedAt: new Date().toISOString(), errorCode: normalized.code, errorMessage: normalized.message };
      await this.dispose();
      throw error;
    }
    return this.getModelInfo();
  }

  async disconnectModel(): Promise<ModelInfo> {
    this.assertIdle();
    await this.dispose();
    this.credentialStore.clear();
    this.#model = cleanModel({ ...this.#model, status: "unconfigured", checkedAt: new Date().toISOString() });
    return this.getModelInfo();
  }

  assertIdle(): void {
    if (this.#activeRun && !this.#activeRun.settled) throw new BridgeError(409, "run_in_progress", "当前任务仍在执行，请先停止或等待完成。", false);
  }

  async createSession(name?: string): Promise<SessionSummary> {
    this.ensureReadyForSession();
    this.assertIdle();
    const workspace = this.workspaceService.requireCurrent();
    const runtime = await this.ensureRuntime(workspace.path);
    const created = await runtime.call<{ sessionId: string }>("session.create", {
      cwd: workspace.path,
      agentPreset: workspace.info.projectTrusted ? "standard" : DSH_RESTRICTED_PRESET
    });
    this.#activeSessionId = created.sessionId;
    this.#runtimeGeneration = this.eventStore.nextRuntimeGeneration(created.sessionId);
    // session.create publishes official events immediately. Establish the local
    // projection before issuing any follow-up RPC so those events always have a
    // valid foreign-key owner.
    this.persistSession(created.sessionId, normalizeSessionName(name), "idle", true);
    await this.selectModel(created.sessionId);
    await this.applyPermission(created.sessionId);
    if (name?.trim()) await runtime.call("session.rename", { sessionId: created.sessionId, title: normalizeSessionName(name) });
    this.persistSession(created.sessionId, normalizeSessionName(name), "idle", true);
    await this.syncHistory(created.sessionId);
    return this.requireSummary(created.sessionId);
  }

  async listSessions(): Promise<SessionSummary[]> {
    this.ensureReadyForSession();
    const workspace = this.workspaceService.requireCurrent();
    const runtime = await this.ensureRuntime(workspace.path);
    const listed = await runtime.call<{ items: DshSessionListItem[] }>("session.list", {});
    for (const item of listed.items) {
      if (!isVisibleWorkspaceSession(item, workspace.path, workspace.info.projectTrusted)) continue;
      this.persistSession(item.sessionId, sessionTitle(item), item.running ? "running" : persistedTerminalStatus(this.eventStore.getSession(item.sessionId)?.runStatus), true, item.updatedAt);
    }
    const visibleIds = new Set(listed.items.filter((item) => isVisibleWorkspaceSession(item, workspace.path, workspace.info.projectTrusted)).map((item) => item.sessionId));
    return this.eventStore.listSessions(workspace.path, this.id).filter((session) => visibleIds.has(session.id));
  }

  async openSession(sessionId: string): Promise<SessionSummary> {
    this.ensureReadyForSession();
    this.assertIdle();
    const found = (await this.listSessions()).find((session) => session.id === sessionId);
    if (!found) throw new BridgeError(404, "session_not_found", "找不到该 DeepSeek Harness 会话。", false);
    this.#activeSessionId = sessionId;
    this.#runtimeGeneration = this.eventStore.nextRuntimeGeneration(sessionId);
    await this.applyPermission(sessionId);
    await this.syncHistory(sessionId);
    this.eventStore.updateSessionStatus(sessionId, "idle");
    return this.requireSummary(sessionId);
  }

  async closeSession(sessionId: string): Promise<SessionSummary> {
    this.assertCurrentSession(sessionId);
    this.assertIdle();
    this.#activeSessionId = null;
    this.eventStore.updateSessionStatus(sessionId, "idle");
    return this.requireSummary(sessionId);
  }

  async deleteSession(sessionId: string): Promise<{ deletedSessionId: string }> {
    this.assertIdle();
    const existing = this.eventStore.getSession(sessionId);
    if (!existing) throw new BridgeError(404, "session_not_found", "找不到该会话。", false);
    const runtime = await this.ensureWorkspaceRuntime();
    await runtime.call("workspace.archiveSession", { sessionId });
    if (this.#activeSessionId === sessionId) this.#activeSessionId = null;
    this.eventStore.deleteSession(sessionId);
    return { deletedSessionId: sessionId };
  }

  async renameSession(name: string): Promise<SessionSummary> {
    const sessionId = this.requireActiveSessionId();
    this.assertIdle();
    const normalized = normalizeSessionName(name);
    await this.requireRuntime().call("session.rename", { sessionId, title: normalized });
    this.persistSession(sessionId, normalized, this.eventStore.getSession(sessionId)?.runStatus ?? "idle", true);
    return this.requireSummary(sessionId);
  }

  listForkPoints(): Array<{ entryId: string; text: string }> {
    const sessionId = this.requireActiveSessionId();
    return this.eventStore.listEvents(sessionId).filter((event) => event.kind === "message.completed" && event.payload.role === "user" && event.raw?.officialSeq !== undefined).map((event) => ({
      entryId: String(event.raw?.officialSeq),
      text: typeof event.payload.text === "string" ? event.payload.text.slice(0, 240) : "用户消息"
    }));
  }

  async forkSession(entryId: string): Promise<SessionSummary> {
    this.assertIdle();
    const sourceId = this.requireActiveSessionId();
    const atSeq = Number.parseInt(entryId, 10);
    if (!Number.isInteger(atSeq) || atSeq < 0) throw new BridgeError(400, "invalid_fork_point", "分叉位置无效。", false);
    const runtime = this.requireRuntime();
    const forked = await runtime.call<{ sessionId: string }>("session.fork", { sessionId: sourceId, atSeq });
    this.#activeSessionId = forked.sessionId;
    this.#runtimeGeneration = this.eventStore.nextRuntimeGeneration(forked.sessionId);
    await this.selectModel(forked.sessionId);
    await this.applyPermission(forked.sessionId);
    await runtime.call("session.rename", { sessionId: forked.sessionId, title: normalizeSessionName("分叉会话") });
    this.persistSession(forked.sessionId, normalizeSessionName("分叉会话"), "idle", true);
    await this.syncHistory(forked.sessionId);
    return this.requireSummary(forked.sessionId);
  }

  async listCommands(): Promise<HarnessCommand[]> {
    const sessionId = this.requireActiveSessionId();
    const idle = !this.#activeRun;
    const descriptors = await this.requireRuntime().remote<Array<{ name: string; description: string; input?: { hint?: string } }>>("commands/list", { agentId: sessionId });
    const official = descriptors.map((entry) => command(`official:${entry.name}`, entry.name, entry.description, "harness", entry.input ? "text" : "none", idle, idle ? undefined : "当前任务仍在执行。", entry.input?.hint));
    const sessions = await this.listSessions();
    const points = this.listForkPoints();
    const lastAssistant = [...this.eventStore.listEvents(sessionId)].reverse().find((event) => event.kind === "message.completed" && event.payload.role === "assistant" && typeof event.payload.text === "string");
    return dedupeCommands([
      command("session.new", "new", "开始新的开发会话", "product", "none", idle, idle ? undefined : "当前任务仍在执行。"),
      command("session.resume", "resume", "恢复当前工作区中的其他会话", "product", "select", idle && sessions.some((entry) => entry.id !== sessionId), idle ? "没有其他可恢复会话。" : "当前任务仍在执行。", undefined, sessions.filter((entry) => entry.id !== sessionId).map((entry) => ({ value: entry.id, label: entry.name, description: entry.modelId }))),
      command("session.rename", "name", "修改当前会话名称", "product", "text", idle, idle ? undefined : "当前任务仍在执行。", "<会话名称>"),
      command("session.fork", "fork", "从一条用户消息创建新会话", "product", "select", idle && points.length > 0, idle ? "当前会话还没有可分叉的用户消息。" : "当前任务仍在执行。", undefined, points.map((point) => ({ value: point.entryId, label: point.text }))),
      command("message.copy-last", "copy", "复制最后一条 Assistant 回复", "product", "none", Boolean(lastAssistant), lastAssistant ? undefined : "当前会话还没有 Assistant 回复。"),
      command("settings.model", "model", "打开 DeepSeek 模型设置", "product", "none", idle),
      command("settings.open", "settings", "打开环境配置", "product", "none", idle),
      command("settings.trust", "trust", "打开项目资源信任设置", "product", "none", idle),
      ...official
    ]);
  }

  async executeCommand(input: ExecuteHarnessCommandInput): Promise<CommandExecutionResult> {
    const saved = this.eventStore.getRequest<CommandExecutionResult>(input.requestId);
    if (saved) return saved;
    const pending = this.#pendingCommands.get(input.requestId);
    if (pending) return await pending;
    const current = this.executeCommandOnce(input).then((result) => {
      this.eventStore.saveRequest(input.requestId, result);
      return result;
    }).finally(() => {
      if (this.#pendingCommands.get(input.requestId) === current) this.#pendingCommands.delete(input.requestId);
    });
    this.#pendingCommands.set(input.requestId, current);
    return await current;
  }

  async submitTask(input: SubmitTaskInput): Promise<CommandReceipt> {
    return await this.runIdempotent(input.requestId, async () => await this.submitTaskOnce(input));
  }

  async steer(requestId: string, text: string): Promise<CommandReceipt> {
    return await this.controlPrompt(requestId, text, "steer");
  }

  async followUp(requestId: string, text: string): Promise<CommandReceipt> {
    return await this.controlPrompt(requestId, text, "queue");
  }

  async interrupt(requestId: string): Promise<CommandReceipt> {
    return await this.runIdempotent(requestId, async () => {
      const sessionId = this.requireActiveSessionId();
      const activeRun = this.#activeRun;
      if (!activeRun) return this.rejectReceipt(requestId, "当前没有可停止的执行。", sessionId);
      await this.requireRuntime().call("session.cancel", { sessionId });
      activeRun.status = "interrupting";
      this.eventStore.updateSessionStatus(sessionId, "interrupting");
      const receipt = { requestId, accepted: true, sessionId, runId: activeRun.id };
      this.eventStore.saveRequest(requestId, receipt);
      return receipt;
    });
  }

  assertCurrentSession(sessionId: string): void {
    if (this.#activeSessionId !== sessionId) throw new BridgeError(409, "session_not_active", "该会话当前未激活，请先打开会话。", false);
  }

  async notifyWorkspaceChanged(): Promise<void> {
    if (!this.#activeSessionId) return;
    const snapshot = await this.workspaceService.snapshot(this.#activeRun?.id);
    this.emit("workspace.changed", "workspace", { changes: snapshot.changes, fileCount: snapshot.workspace.fileCount, trigger: "filesystem" }, "snapshot", this.#activeRun?.id);
  }

  async dispose(): Promise<void> {
    const runtime = this.#runtime;
    this.#runtime = undefined;
    this.#runtimeCwd = undefined;
    await runtime?.dispose();
    await this.#eventQueue;
  }

  private async executeCommandOnce(input: ExecuteHarnessCommandInput): Promise<CommandExecutionResult> {
    const sessionId = this.requireActiveSessionId();
    const available = (await this.listCommands()).find((entry) => entry.id === input.commandId);
    if (!available) return commandRejected(input, sessionId, "该命令不在当前 Harness 命令目录中。");
    if (!available.available) return commandRejected(input, sessionId, available.unavailableReason ?? "该命令当前不可用。");
    const argument = input.argument?.trim();
    if ((available.input === "select" || available.argumentRequired) && !argument) return commandRejected(input, sessionId, "请选择或填写命令参数。");
    if (input.commandId === "session.new") return commandAccepted(input, (await this.createSession()).id, { type: "session", session: this.requireSummary(this.#activeSessionId!) });
    if (input.commandId === "session.resume") return commandAccepted(input, (await this.openSession(argument!)).id, { type: "session", session: this.requireSummary(this.#activeSessionId!) });
    if (input.commandId === "session.rename") return commandAccepted(input, sessionId, { type: "session", session: await this.renameSession(argument ?? "") });
    if (input.commandId === "session.fork") return commandAccepted(input, (await this.forkSession(argument!)).id, { type: "session", session: this.requireSummary(this.#activeSessionId!) });
    if (input.commandId === "message.copy-last") {
      const latest = [...this.eventStore.listEvents(sessionId)].reverse().find((event) => event.kind === "message.completed" && event.payload.role === "assistant");
      return commandAccepted(input, sessionId, { type: "clipboard", text: typeof latest?.payload.text === "string" ? latest.payload.text : "" });
    }
    if (input.commandId === "settings.model") return commandAccepted(input, sessionId, { type: "navigate", path: "/setup?step=model" });
    if (input.commandId === "settings.open") return commandAccepted(input, sessionId, { type: "navigate", path: "/setup" });
    if (input.commandId === "settings.trust") return commandAccepted(input, sessionId, { type: "navigate", path: "/setup?step=permissions" });
    if (input.commandId.startsWith("official:")) {
      const line = `/${input.commandId.slice("official:".length)}${argument ? ` ${argument}` : ""}`;
      const executed = await this.requireRuntime().remote<{ commandId?: string; result?: { kind?: string; text?: string; sourceEventSeq?: number } }>("commands/execute", { agentId: sessionId, line }, 120_000);
      if (executed.result?.kind === "error") return commandRejected(input, sessionId, executed.result.text ?? "DeepSeek Harness 命令执行失败。");
      await this.syncHistory(sessionId);
      return commandAccepted(input, sessionId, { type: "details", title: line, data: { source: "DeepSeek Harness", result: executed.result?.text ?? "命令已完成", sourceEventSeq: executed.result?.sourceEventSeq ?? null } });
    }
    return commandRejected(input, sessionId, "该命令当前没有可执行映射。");
  }

  private async submitTaskOnce(input: SubmitTaskInput): Promise<CommandReceipt> {
    const text = input.text.trim();
    const sessionId = this.requireActiveSessionId();
    if (!text) return this.rejectReceipt(input.requestId, "任务内容不能为空。", sessionId);
    if (this.#activeRun) return this.rejectReceipt(input.requestId, "当前会话正在执行，请选择引导、跟进或停止。", sessionId);
    const runId = randomUUID();
    const active: ActiveRun = { id: runId, requestId: input.requestId, status: "submitting", settled: false };
    this.#activeRun = active;
    this.eventStore.updateSessionStatus(sessionId, "submitting");
    try {
      await this.workspaceService.captureRunBaseline(runId);
      await this.requireRuntime().call("session.prompt", { sessionId, mode: "queue", content: [{ type: "text", text }], clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
      active.status = "acknowledged";
      this.eventStore.updateSessionStatus(sessionId, "acknowledged");
      this.emit("run.acknowledged", "bridge", { requestId: input.requestId, status: "acknowledged" }, "final", runId);
      const receipt = { requestId: input.requestId, accepted: true, sessionId, runId };
      this.eventStore.saveRequest(input.requestId, receipt);
      return receipt;
    } catch (error) {
      this.#activeRun = undefined;
      this.eventStore.updateSessionStatus(sessionId, "idle");
      await this.workspaceService.removeRunBaselines([runId]);
      throw error;
    }
  }

  private async controlPrompt(requestId: string, text: string, mode: "queue" | "steer"): Promise<CommandReceipt> {
    return await this.runIdempotent(requestId, async () => {
      const sessionId = this.requireActiveSessionId();
      const active = this.#activeRun;
      if (!active) return this.rejectReceipt(requestId, mode === "steer" ? "当前没有可引导的执行。" : "当前没有运行中的任务；请直接发送新任务。", sessionId);
      await this.requireRuntime().call("session.prompt", { sessionId, mode, content: [{ type: "text", text: text.trim() }], clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
      const receipt = { requestId, accepted: true, sessionId, runId: active.id };
      this.eventStore.saveRequest(requestId, receipt);
      return receipt;
    });
  }

  private async handleMuxFrame(frame: DshFrame, rpcId: string): Promise<void> {
    if (frame.type === "approval/requested" && typeof frame.sessionId === "string" && typeof frame.approvalId === "string") {
      await this.#runtime?.respond(rpcId, { sessionId: frame.sessionId, approvalId: frame.approvalId, outcome: "rejected" }).catch(() => undefined);
      if (frame.sessionId === this.#activeSessionId) this.emit("error", "harness", { code: "approval_required", message: `DeepSeek Harness 请求额外权限（${String(frame.toolName ?? "tool")}），当前 Web 安全策略已拒绝。`, retryable: false }, "final", this.#activeRun?.id);
      return;
    }
    if (frame.type === "question/requested" && typeof frame.sessionId === "string") {
      await this.#runtime?.respondCancelled(rpcId, "当前 Web 尚未提供用户问答卡片。", {}).catch(() => undefined);
      if (frame.sessionId === this.#activeSessionId) this.emit("error", "harness", { code: "question_ui_unavailable", message: "DeepSeek Harness 请求用户确认；当前版本尚未提供问答卡片，任务已安全停止。", retryable: false }, "final", this.#activeRun?.id);
      return;
    }
    if (frame.type === "session/queue" && frame.sessionId === this.#activeSessionId) {
      const items = Array.isArray(frame.items) ? frame.items : [];
      this.emit("queue.updated", "harness", {
        steeringCount: items.filter((item) => asRecord(item).placement === "steering").length,
        followUpCount: items.filter((item) => asRecord(item).placement === "queued").length
      }, "snapshot", this.#activeRun?.id);
      return;
    }
    if (frame.type === "session/projection" && frame.sessionId === this.#activeSessionId && frame.key === "tokenUsage") {
      this.emit("usage.updated", "model", sanitizeRecord(frame.value), "snapshot", this.#activeRun?.id);
      return;
    }
    if (frame.type !== "session/event" || frame.sessionId !== this.#activeSessionId || !frame.event) return;
    await this.applySourceEvent(frame.sessionId, frame.event);
  }

  private async handleHostFrame(frame: DshFrame): Promise<void> {
    if (frame.type === "host/agent-error" && frame.sessionId === this.#activeSessionId) {
      this.emit("error", "harness", { code: "dsh_agent_error", message: redactText(typeof frame.message === "string" ? frame.message : "DeepSeek Harness Agent 执行失败。"), retryable: true }, "final", this.#activeRun?.id);
      if (this.#activeRun) await this.finalizeRun("failed");
    }
  }

  private async applySourceEvent(sessionId: string, event: DshSessionEvent, historical = false): Promise<void> {
    const previous = this.#lastSourceSeq.get(sessionId) ?? this.eventStore.getMetadata<number>(`dsh_last_seq:${sessionId}`) ?? -1;
    if (event.seq <= previous) return;
    const historicalRunId = `dsh-${sessionId}-turn-${String(asRecord(event.data).turn ?? event.seq)}`;
    const runId = historical ? historicalRunId : this.#activeRun?.id ?? historicalRunId;
    const sourceData = asRecord(event.data);
    if (event.type === "tool/call" && typeof sourceData.callId === "string" && typeof sourceData.name === "string") this.#toolNames.set(sourceData.callId, sourceData.name);
    for (const mapped of mapDshEvent(event)) {
      let payload = sanitizeWorkspacePaths(mapped.payload, this.workspaceService.requireCurrent().path);
      const raw = mapped.raw ? sanitizeWorkspacePaths(mapped.raw, this.workspaceService.requireCurrent().path) : undefined;
      if (mapped.kind === "tool.completed") {
        const callId = typeof payload.toolCallId === "string" ? payload.toolCallId : "";
        const toolName = this.#toolNames.get(callId);
        payload = {
          ...payload,
          ...(toolName ? { toolName } : {}),
          ...(toolName === "bash" && payload.isError !== true && payload.exitCode === undefined ? { exitCode: 0, cancelled: false } : {})
        };
        if (callId) this.#toolNames.delete(callId);
      }
      this.emit(mapped.kind, mapped.source, payload, mapped.updateMode, runId, { ...(raw ?? {}), officialType: event.type, officialSeq: event.seq });
    }
    this.#lastSourceSeq.set(sessionId, event.seq);
    this.eventStore.setMetadata(`dsh_last_seq:${sessionId}`, event.seq);
    const status = dshTurnStatus(event);
    if (!historical && status && this.#activeRun) await this.finalizeRun(status);
  }

  private async finalizeRun(status: RunStatus): Promise<void> {
    const active = this.#activeRun;
    const sessionId = this.#activeSessionId;
    if (!active || active.settled || !sessionId) return;
    active.settled = true;
    active.status = status;
    try {
      const snapshot = await this.workspaceService.snapshot(active.id);
      let acceptanceRecord: AcceptanceRecord | undefined;
      this.emit("workspace.changed", "workspace", { changes: snapshot.changes, fileCount: snapshot.workspace.fileCount }, "snapshot", active.id);
      if (this.workspaceService.requireCurrent().acceptance) {
        try {
          acceptanceRecord = await this.buildAcceptanceRecord(active.id, status);
        } catch (error) {
          this.emit("error", "bridge", { code: "acceptance_record_failed", message: safeMessage(error), retryable: true }, "final", active.id);
        }
      }
      this.eventStore.updateSessionStatus(sessionId, status);
      this.emit("run.settled", "harness", { status }, "final", active.id);
      if (acceptanceRecord) {
        const events = this.eventStore.listEvents(sessionId).filter((event) => event.runId === active.id);
        const completeRecord: AcceptanceRecord = {
          ...acceptanceRecord,
          eventCount: events.length,
          eventKinds: unique(events.map((event) => event.kind)),
          eventSequence: { first: events.at(0)?.sequence ?? 0, last: events.at(-1)?.sequence ?? 0 }
        };
        this.eventStore.saveAcceptanceRecord(completeRecord);
        this.acceptanceRecordStore.save(completeRecord);
      }
    } finally {
      this.#activeRun = undefined;
    }
  }

  private async buildAcceptanceRecord(runId: string, finalStatus: RunStatus): Promise<AcceptanceRecord> {
    const current = this.workspaceService.requireCurrent();
    const sessionId = this.requireActiveSessionId();
    const events = this.eventStore.listEvents(sessionId).filter((event) => event.runId === runId);
    const changes = (await this.workspaceService.snapshot(runId)).changes;
    const verificationFile = current.templateVersion === "counter-v1" ? "test.mjs" : "verify.mjs";
    const verification = await runProcess(process.execPath, [verificationFile], current.path, 30_000);
    const toolNames = unique(events.flatMap((event) => typeof event.payload.toolName === "string" ? [event.payload.toolName] : []));
    const expectedFinalStatus: RunStatus = current.templateVersion === "control-v1" ? "cancelled" : "completed";
    return {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      adapterId: this.id,
      adapterVersion: "0.1.0",
      harnessId: "deepseek-harness",
      harnessVersion: DSH_VERSION,
      modelId: this.#model.modelId,
      workspaceTemplateVersion: current.templateVersion,
      workspaceId: current.info.id,
      workspaceDisplayPath: current.info.displayPath,
      sessionId,
      runId,
      finalStatus,
      expectedFinalStatus,
      passed: verification.exitCode === 0 && finalStatus === expectedFinalStatus,
      features: inferFeatures(events, changes.length > 0),
      eventCount: events.length,
      eventKinds: unique(events.map((event) => event.kind)),
      eventSequence: { first: events.at(0)?.sequence ?? 0, last: events.at(-1)?.sequence ?? 0 },
      toolNames,
      changedFiles: changes.map((change) => change.path),
      verification: {
        command: `node ${verificationFile}`,
        exitCode: verification.exitCode,
        passed: verification.exitCode === 0,
        output: redactText(`${verification.stdout}${verification.stderr}`.trim())
      },
      evidenceSource: "real-runtime"
    };
  }

  private async syncHistory(sessionId: string): Promise<void> {
    const runtime = this.requireRuntime();
    const all: DshSessionEvent[] = [];
    let beforeSeq: number | undefined;
    for (let page = 0; page < 100; page += 1) {
      const history = await runtime.call<{ events: Array<{ event: DshSessionEvent }>; hasMore: boolean }>("session.history", { sessionId, maxMessages: 200, ...(beforeSeq !== undefined ? { beforeSeq } : {}) });
      const events = history.events.map((entry) => entry.event);
      all.push(...events);
      if (!history.hasMore || events.length === 0) break;
      beforeSeq = Math.min(...events.map((event) => event.seq));
    }
    all.sort((left, right) => left.seq - right.seq);
    for (const event of all) await this.applySourceEvent(sessionId, event, true);
  }

  private async applyPermission(sessionId: string): Promise<void> {
    const mode = this.workspaceService.requireCurrent().info.projectTrusted ? "workspace-write" : "read-only";
    const executed = await this.requireRuntime().remote<{ result?: { kind?: string; text?: string } }>("commands/execute", { agentId: sessionId, line: `/permission ${mode}` });
    if (executed.result?.kind === "error") throw new BridgeError(502, "dsh_permission_failed", executed.result.text ?? "无法设置 DeepSeek Harness 项目权限。", false);
  }

  private async selectModel(sessionId: string): Promise<void> {
    await this.requireRuntime().call("session.selectModel", { sessionId, provider: "deepseek-official", model: this.#model.modelId, reasoningEffort: this.#model.thinkingLevel });
  }

  private async ensureWorkspaceRuntime(): Promise<DshWebRuntime> {
    return await this.ensureRuntime(this.workspaceService.requireCurrent().path);
  }

  private async ensureRuntime(cwd: string): Promise<DshWebRuntime> {
    if (this.#runtime?.alive && this.#runtimeCwd === cwd) return this.#runtime;
    await this.dispose();
    return await this.startRuntime(cwd);
  }

  private async startRuntime(cwd: string): Promise<DshWebRuntime> {
    const credential = this.credentialStore.require();
    const workspace = this.workspaceService.current;
    const permissionMode = workspace?.path === cwd && workspace.info.projectTrusted ? "workspace-write" : "read-only";
    const runtime = await DshWebRuntime.start({
      cwd,
      dshHome: join(this.dataDir, "deepseek-official", "dsh-home"),
      apiKey: credential.apiKey,
      baseUrl: credential.baseUrl,
      permissionMode,
      onMuxFrame: async (frame, rpcId) => {
        this.#eventQueue = this.#eventQueue.then(async () => await this.handleMuxFrame(frame, rpcId)).catch((error: unknown) => {
          if (this.#activeSessionId) this.emit("error", "bridge", { code: "dsh_event_mapping_failed", message: safeMessage(error), retryable: true }, "final", this.#activeRun?.id);
        });
        await this.#eventQueue;
      },
      onHostFrame: async (frame) => {
        this.#eventQueue = this.#eventQueue.then(async () => await this.handleHostFrame(frame)).catch(() => undefined);
        await this.#eventQueue;
      }
    });
    this.#runtime = runtime;
    this.#runtimeCwd = cwd;
    return runtime;
  }

  private persistSession(sessionId: string, name: string, status: RunStatus, recoverable: boolean, updatedAt?: number): void {
    const workspace = this.workspaceService.requireCurrent();
    this.eventStore.upsertSession({ id: sessionId, adapterId: this.id, runtimeSessionRef: `dsh:${sessionId}`, name, workspacePath: workspace.path, modelId: this.#model.modelId, runStatus: status, recoverable });
    if (updatedAt !== undefined) this.eventStore.setMetadata(`dsh_updated_at:${sessionId}`, updatedAt);
  }

  private emit(kind: HarnessEvent["kind"], source: HarnessEvent["source"], payload: Record<string, unknown>, updateMode?: HarnessEvent["updateMode"], runId?: string, raw?: Record<string, unknown>): void {
    const sessionId = this.requireActiveSessionId();
    const event: HarnessEvent = {
      id: randomUUID(),
      sequence: this.eventStore.nextSessionSequence(sessionId),
      sessionId,
      ...(runId ? { runId } : {}),
      runtimeGeneration: this.#runtimeGeneration,
      kind,
      source,
      timestamp: new Date().toISOString(),
      ...(updateMode ? { updateMode } : {}),
      payload,
      ...(raw ? { raw } : {})
    };
    this.eventStore.appendEvent(event);
    this.eventBus.publish(event);
  }

  private ensureReadyForSession(): void {
    if (this.#model.status !== "ready") throw new BridgeError(409, "model_unconfigured", "请先连接 DeepSeek。", false);
    this.workspaceService.requireCurrent();
  }

  private requireRuntime(): DshWebRuntime {
    if (!this.#runtime?.alive) throw new BridgeError(503, "dsh_runtime_unavailable", "DeepSeek Harness 官方运行时未启动。", true);
    return this.#runtime;
  }

  private requireActiveSessionId(): string {
    if (!this.#activeSessionId) throw new BridgeError(409, "session_unselected", "请先创建或打开一个会话。", false);
    return this.#activeSessionId;
  }

  private requireSummary(sessionId: string): SessionSummary {
    const summary = this.eventStore.getSession(sessionId);
    if (!summary) throw new BridgeError(404, "session_not_found", "找不到该会话。", false);
    return summary;
  }

  private async runIdempotent(requestId: string, operation: () => Promise<CommandReceipt>): Promise<CommandReceipt> {
    const previous = this.eventStore.getRequest<CommandReceipt>(requestId);
    if (previous) return previous;
    const pending = this.#pendingRequests.get(requestId);
    if (pending) return await pending;
    const current = operation().finally(() => {
      if (this.#pendingRequests.get(requestId) === current) this.#pendingRequests.delete(requestId);
    });
    this.#pendingRequests.set(requestId, current);
    return await current;
  }

  private rejectReceipt(requestId: string, reason: string, sessionId?: string): CommandReceipt {
    const receipt = { requestId, accepted: false, ...(sessionId ? { sessionId } : {}), reason };
    this.eventStore.saveRequest(requestId, receipt);
    return receipt;
  }
}

async function waitForTurnEnd(runtime: DshWebRuntime, sessionId: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const history = await runtime.call<{ events: Array<{ event: DshSessionEvent }> }>("session.history", { sessionId, maxMessages: 30 });
    const end = [...history.events].reverse().find((entry) => entry.event.type === "turn/end")?.event;
    if (end) {
      const status = dshTurnStatus(end);
      if (status === "completed") return;
      const reason = asRecord(asRecord(end.data).reason);
      throw new BridgeError(502, "dsh_model_verification_failed", `DeepSeek Harness 模型验证失败：${String(reason.kind ?? "unknown")}`, true);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }
  throw new BridgeError(504, "dsh_model_verification_timeout", "DeepSeek Harness 模型验证超时。", true);
}

function sessionTitle(item: DshSessionListItem): string {
  const title = item.projections?.values?.title;
  if (typeof title === "string" && title.trim()) return title.trim();
  if (typeof title === "object" && title !== null) {
    const record = title as Record<string, unknown>;
    const candidate = record.title ?? record.value;
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return item.blank ? "新的开发任务" : `DeepSeek 会话 ${item.sessionId.slice(0, 8)}`;
}

function isVisibleWorkspaceSession(item: DshSessionListItem, workspacePath: string, projectTrusted: boolean): boolean {
  if (item.cwd !== workspacePath || item.origin === "subagent") return false;
  // DSH fixes the agent preset when a non-blank session is created. A session
  // that once loaded project resources cannot be made resource-blind later by
  // changing only its filesystem permission. Hide it while the workspace is in
  // restricted mode; restoring trust makes the preserved session visible again.
  return projectTrusted || item.agentPreset === DSH_RESTRICTED_PRESET;
}

function normalizeSessionName(name?: string): string {
  const value = name?.trim();
  return value ? value.slice(0, 80) : `会话 ${new Date().toLocaleString("zh-CN", { hour12: false })}`;
}

function normalizeModelId(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/^deepseek-v4-(flash|pro)$/i, "deepseek-v4-$1");
  if (normalized !== "deepseek-v4-flash" && normalized !== "deepseek-v4-pro") throw new BridgeError(400, "model_unsupported", "DeepSeek Harness 当前支持 V4 Flash 与 V4 Pro。", false);
  return normalized;
}

function persistedTerminalStatus(status: RunStatus | undefined): RunStatus {
  return status && ["completed", "failed", "cancelled", "unknown"].includes(status) ? status : "idle";
}

function modelFailure(error: unknown): { status: ModelInfo["status"]; code: string; message: string } {
  const message = safeMessage(error);
  if (/401|403|auth|credential|api.?key/i.test(message)) return { status: "auth_error", code: "authentication_failed", message: "DeepSeek API Key 验证失败。" };
  if (/429|rate/i.test(message)) return { status: "rate_limited", code: "rate_limited", message: "DeepSeek 请求过于频繁，请稍后重试。" };
  if (/quota|balance|insufficient/i.test(message)) return { status: "quota_error", code: "quota_exhausted", message: "DeepSeek 账户额度不足。" };
  return { status: "unavailable", code: "dsh_model_unavailable", message };
}

function cleanModel(model: ModelInfo): ModelInfo {
  const { errorCode: _errorCode, errorMessage: _errorMessage, ...clean } = model;
  return clean;
}

function command(id: string, name: string, description: string, source: HarnessCommand["source"], input: HarnessCommand["input"], available: boolean, unavailableReason?: string, argumentHint?: string, options?: HarnessCommand["options"]): HarnessCommand {
  return { id, name, description, source, input, argumentRequired: input === "select", available, startsRun: false, ...(unavailableReason ? { unavailableReason } : {}), ...(argumentHint ? { argumentHint } : {}), ...(options ? { options } : {}) };
}

function dedupeCommands(commands: HarnessCommand[]): HarnessCommand[] {
  const names = new Set<string>();
  return commands.filter((entry) => names.has(entry.name) ? false : (names.add(entry.name), true));
}

function commandAccepted(input: ExecuteHarnessCommandInput, sessionId: string, effect?: CommandExecutionResult["effect"]): CommandExecutionResult {
  return { requestId: input.requestId, commandId: input.commandId, accepted: true, sessionId, ...(effect ? { effect } : {}) };
}

function commandRejected(input: ExecuteHarnessCommandInput, sessionId: string | undefined, reason: string): CommandExecutionResult {
  return { requestId: input.requestId, commandId: input.commandId, accepted: false, ...(sessionId ? { sessionId } : {}), reason };
}

function safeMessage(error: unknown): string {
  return redactText(error instanceof Error ? error.message : "未知错误").replaceAll(process.cwd(), "[PROJECT]");
}

function redactText(value: string): string {
  return value.slice(0, 20_000).replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]").replace(/(authorization\s*[:=]\s*)([^\s,;]+)/gi, "$1[REDACTED]");
}

function inferFeatures(events: HarnessEvent[], hasChanges: boolean): string[] {
  const features = new Set(["FM-01", "FM-02", "FM-03", "FM-04", "FM-05", "FM-06", "FM-10", "FM-11"]);
  if (events.some((event) => event.kind.startsWith("tool."))) features.add("FM-07");
  if (hasChanges) features.add("FM-08");
  if (events.some((event) => event.kind === "usage.updated" || event.kind.startsWith("retry.") || event.kind.startsWith("compaction."))) features.add("FM-09");
  return [...features].sort();
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function sanitizeRecord(value: unknown): Record<string, unknown> {
  return asRecord(sanitizeValue(value));
}

function sanitizeValue(value: unknown, key = "", depth = 0): unknown {
  if (/api.?key|authorization|credential|secret|access.?token|refresh.?token|bearer/i.test(key) || key.toLowerCase() === "token") return "[REDACTED]";
  if (depth > 5) return "[TRUNCATED]";
  if (typeof value === "string") return redactText(value);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((entry) => sanitizeValue(entry, key, depth + 1));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).slice(0, 100).map(([entryKey, entry]) => [entryKey, sanitizeValue(entry, entryKey, depth + 1)]));
  }
  return undefined;
}

function sanitizeWorkspacePaths<T>(value: T, workspacePath: string): T {
  const canonical = workspacePath.replaceAll("\\", "/").replace(/\/$/, "");
  const platformPath = workspacePath.replace(/\/$/, "");
  const candidates = [...new Set([`/private${canonical}`, platformPath, canonical])].sort((left, right) => right.length - left.length);
  const rewrite = (entry: unknown): unknown => {
    if (typeof entry === "string") {
      return candidates.reduce((result, candidate) => candidate ? result.replaceAll(candidate, ".") : result, entry);
    }
    if (Array.isArray(entry)) return entry.map(rewrite);
    if (typeof entry === "object" && entry !== null) {
      return Object.fromEntries(Object.entries(entry).map(([key, item]) => [key, rewrite(item)]));
    }
    return entry;
  };
  return rewrite(value) as T;
}
