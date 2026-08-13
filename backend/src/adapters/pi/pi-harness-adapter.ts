import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, realpath, rm, unlink, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { TextDecoder } from "node:util";
import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import {
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  createBashTool,
  createEditTool,
  createReadTool,
  createWriteTool,
  SessionManager,
  SettingsManager,
  type AgentSessionRuntime,
  type CreateAgentSessionRuntimeFactory
} from "@earendil-works/pi-coding-agent";
import type {
  AcceptanceRecord,
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
import type { ModelService } from "../../model/model-service.js";
import type { EventBus } from "../../runtime/event-bus.js";
import { runProcess } from "../../runtime/process-runner.js";
import type { AcceptanceRecordStore, EventStore } from "../../sessions/event-store.js";
import type { WorkspaceService } from "../../workspace/workspace-service.js";
import type { ToolOutputStore } from "../../runtime/tool-output-store.js";
import type { CommandExportStore } from "../../runtime/command-export-store.js";
import type { HarnessAdapter, SubmitTaskInput } from "../harness-adapter.js";
import { mapPiEvent } from "./pi-event-mapper.js";
import { PI_CAPABILITIES, probePiRuntime } from "./runtime-probe.js";
import { PI_VERSION } from "./model-config.js";

interface ActiveRun {
  id: string;
  status: RunStatus;
  commandId?: string;
  displayInput?: string;
  interruptRequested: boolean;
  lastToolCompletionFailed: boolean;
  settled: boolean;
}

export class PiHarnessAdapter implements HarnessAdapter {
  readonly id = "pi" as const;
  #runtime: AgentSessionRuntime | undefined;
  #unsubscribe: (() => void) | undefined;
  #runtimeGeneration = 0;
  #activeRun: ActiveRun | undefined;
  #eventQueue = Promise.resolve();
  #pendingRequests = new Map<string, Promise<CommandReceipt>>();
  #pendingCommandRequests = new Map<string, Promise<CommandExecutionResult>>();

  constructor(
    private readonly dataDir: string,
    private readonly modelService: ModelService,
    private readonly workspaceService: WorkspaceService,
    private readonly eventStore: EventStore,
    private readonly eventBus: EventBus,
    private readonly toolOutputStore: ToolOutputStore,
    private readonly commandExportStore: CommandExportStore,
    private readonly acceptanceRecordStore: AcceptanceRecordStore
  ) {}

  async probe(): Promise<RuntimeInfo> {
    return await probePiRuntime();
  }

  getCapabilities() {
    return { ...PI_CAPABILITIES };
  }

  getModelInfo(): ModelInfo {
    return this.modelService.info;
  }

  async connectModel(modelId?: string, verify = true, thinkingLevel: "high" | "max" = "high"): Promise<ModelInfo> {
    this.assertIdle();
    await this.dispose();
    return await this.modelService.connect(modelId, verify, thinkingLevel);
  }

  async disconnectModel(): Promise<ModelInfo> {
    this.assertIdle();
    await this.dispose();
    this.modelService.clear();
    return this.modelService.info;
  }

  assertIdle(): void {
    this.ensureIdle();
  }

  get activeSessionId(): string | null {
    return this.#runtime?.session.sessionId ?? null;
  }

  async notifyWorkspaceChanged(): Promise<void> {
    if (!this.#runtime) return;
    const snapshot = await this.workspaceService.snapshot(this.#activeRun?.id);
    this.emit("workspace.changed", "workspace", {
      changes: snapshot.changes,
      fileCount: snapshot.workspace.fileCount,
      trigger: "filesystem"
    }, "snapshot", this.#activeRun?.id);
  }

  async createSession(name?: string): Promise<SessionSummary> {
    this.ensureReadyForSession();
    if (!this.#runtime) {
      const workspace = this.workspaceService.requireCurrent();
      const sessionManager = SessionManager.create(workspace.path, this.sessionDir);
      const runtime = await createAgentSessionRuntime(this.createRuntimeFactory(), {
        cwd: workspace.path,
        agentDir: this.agentDir,
        sessionManager
      });
      this.#runtime = runtime;
      runtime.setRebindSession(async (session) => { this.bindSession(session); });
      this.bindSession(runtime.session);
    } else {
      this.ensureIdle();
      const result = await this.#runtime.newSession();
      if (result.cancelled) throw new BridgeError(409, "session_change_cancelled", "新建会话已取消。", false);
    }
    const session = this.requireSession();
    session.setSessionName(normalizeSessionName(name));
    this.persistCurrentSession("idle");
    return this.currentSummary();
  }

  async listSessions(): Promise<SessionSummary[]> {
    const workspace = this.workspaceService.requireCurrent();
    return this.eventStore.listSessions(workspace.path, this.id).map((session) => ({
      ...session,
      recoverable: this.runtimeSessionExists(session.id)
    }));
  }

  async openSession(sessionId: string): Promise<SessionSummary> {
    this.ensureReadyForSession();
    this.ensureIdle();
    if (this.#runtime?.session.sessionId === sessionId) return this.currentSummary();
    const sessionFile = this.eventStore.getRuntimeSessionRef(sessionId);
    if (!sessionFile) throw new BridgeError(404, "session_not_found", "找不到该会话。", false);
    if (!existsSync(sessionFile)) {
      throw new BridgeError(409, "session_unrecoverable", "该会话的 Harness 运行记录尚未落盘，无法重新打开。", false);
    }
    const workspace = this.workspaceService.requireCurrent();
    const expectedWorkspace = this.eventStore.getSessionWorkspace(sessionId);
    if (expectedWorkspace !== workspace.path) {
      throw new BridgeError(409, "session_workspace_mismatch", "该会话属于另一个工作区，请先切换工作区。", false);
    }
    if (!this.#runtime) {
      const manager = SessionManager.open(sessionFile, this.sessionDir, workspace.path);
      const runtime = await createAgentSessionRuntime(this.createRuntimeFactory(), {
        cwd: workspace.path,
        agentDir: this.agentDir,
        sessionManager: manager
      });
      this.#runtime = runtime;
      runtime.setRebindSession(async (session) => { this.bindSession(session); });
      this.bindSession(runtime.session);
    } else {
      const result = await this.#runtime.switchSession(sessionFile, { cwdOverride: workspace.path });
      if (result.cancelled) throw new BridgeError(409, "session_change_cancelled", "切换会话已取消。", false);
    }
    this.persistCurrentSession("idle");
    return this.currentSummary();
  }

  async closeSession(sessionId: string): Promise<SessionSummary> {
    this.assertCurrentSession(sessionId);
    this.ensureIdle();
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    await this.#runtime?.dispose();
    this.#runtime = undefined;
    this.#activeRun = undefined;
    this.eventStore.updateSessionStatus(sessionId, "idle");
    const summary = this.eventStore.getSession(sessionId);
    if (!summary) throw new BridgeError(404, "session_not_found", "找不到该会话。", false);
    return summary;
  }

  async deleteSession(sessionId: string): Promise<{ deletedSessionId: string }> {
    this.ensureIdle();
    const summary = this.eventStore.getSession(sessionId);
    if (!summary) throw new BridgeError(404, "session_not_found", "找不到该会话。", false);
    if (["submitting", "acknowledged", "running", "settling", "interrupting"].includes(summary.runStatus)) {
      throw new BridgeError(409, "session_run_in_progress", "该会话仍在执行，请先停止或等待完成。", false);
    }
    if (this.#runtime?.session.sessionId === sessionId) {
      this.#unsubscribe?.();
      this.#unsubscribe = undefined;
      await this.#runtime.dispose();
      await this.#eventQueue;
      this.#runtime = undefined;
      this.#activeRun = undefined;
    }
    const sessionEvents = this.eventStore.listEvents(sessionId);
    const managedOutputIds = unique(sessionEvents.flatMap((event) => {
      const id = asRecord(event.payload.details).fullOutputId;
      return typeof id === "string" ? [id] : [];
    }));
    for (const outputId of managedOutputIds) await this.toolOutputStore.remove(outputId);
    await this.workspaceService.removeRunBaselines(unique(sessionEvents.flatMap((event) => event.runId ? [event.runId] : [])));
    const runtimeSessionRef = this.eventStore.getRuntimeSessionRef(sessionId);
    if (runtimeSessionRef) await removeOwnedSessionFile(this.sessionDir, runtimeSessionRef);
    const deleted = this.eventStore.deleteSession(sessionId);
    if (!deleted) throw new BridgeError(404, "session_not_found", "找不到该会话。", false);
    return { deletedSessionId: sessionId };
  }

  async forkSession(entryId: string): Promise<SessionSummary> {
    this.ensureIdle();
    const runtime = this.requireRuntime();
    const result = await runtime.fork(entryId, { position: "at" });
    if (result.cancelled) throw new BridgeError(409, "session_fork_cancelled", "分叉会话已取消。", false);
    const session = this.requireSession();
    session.setSessionName(`分叉 · ${new Date().toLocaleString("zh-CN", { hour12: false })}`);
    this.persistCurrentSession("idle");
    return this.currentSummary();
  }

  renameSession(name: string): SessionSummary {
    const session = this.requireSession();
    session.setSessionName(normalizeSessionName(name));
    const status = this.#activeRun?.status ?? "idle";
    this.persistCurrentSession(status);
    return this.currentSummary();
  }

  listForkPoints(): Array<{ entryId: string; text: string }> {
    return this.requireSession().getUserMessagesForForking().map((entry) => ({
      entryId: entry.entryId,
      text: entry.text.slice(0, 240)
    }));
  }

  async listCommands(): Promise<HarnessCommand[]> {
    const session = this.requireSession();
    const idle = !session.isStreaming && !this.#activeRun && !session.isCompacting;
    const workspace = this.workspaceService.requireCurrent();
    const sessions = await this.listSessions();
    const forkPoints = this.listForkPoints();
    const lastAssistantText = session.getLastAssistantText();
    const hasLeaf = Boolean(session.sessionManager.getLeafId());
    const base: HarnessCommand[] = [
      command("session.new", "new", "开始新的开发会话", "product", "none", idle, idle ? undefined : "当前任务仍在执行。"),
      command("session.resume", "resume", "恢复当前工作区中的其他会话", "product", "select", idle && sessions.some((entry) => entry.id !== session.sessionId && entry.recoverable), idle ? "没有其他可恢复会话。" : "当前任务仍在执行。", sessions.filter((entry) => entry.id !== session.sessionId && entry.recoverable).map((entry) => ({ value: entry.id, label: entry.name, description: entry.modelId }))),
      command("session.rename", "name", "修改当前会话名称", "product", "text", idle, idle ? undefined : "当前任务仍在执行。", undefined, "<会话名称>", false, true),
      command("session.fork", "fork", "从一条用户消息创建新会话", "product", "select", idle && forkPoints.length > 0, idle ? "当前会话还没有可分叉的用户消息。" : "当前任务仍在执行。", forkPoints.map((point) => ({ value: point.entryId, label: point.text || "空消息" }))),
      command("session.clone", "clone", "复制当前会话分支", "harness", "none", idle && hasLeaf, idle ? "当前会话还没有可复制的内容。" : "当前任务仍在执行。"),
      command("context.compact", "compact", "压缩当前会话上下文，可附加摘要要求", "harness", "text", idle && hasLeaf, idle ? "当前会话还没有可压缩的内容。" : "当前任务仍在执行。", undefined, "[摘要要求，可选]"),
      command("session.details", "session", "查看会话消息、工具、Token 与上下文统计", "harness", "none", true),
      command("resources.reload", "reload", "重新加载已允许的 Skills、Prompts 与 Extensions", "harness", "none", idle, idle ? undefined : "当前任务仍在执行。"),
      command("message.copy-last", "copy", "复制最后一条 Assistant 回复", "product", "none", Boolean(lastAssistantText), lastAssistantText ? undefined : "当前会话还没有 Assistant 回复。"),
      command("session.export", "export", "导出当前会话为 HTML 或 JSONL", "harness", "select", idle && hasLeaf, idle ? "当前会话还没有可导出的内容。" : "当前任务仍在执行。", [
        { value: "html", label: "HTML", description: "带样式的只读会话页面" },
        { value: "jsonl", label: "JSONL", description: "Pi 兼容会话数据" }
      ]),
      command("session.import", "import", "从本机选择 JSONL 会话并恢复", "harness", "file", idle, idle ? undefined : "当前任务仍在执行。", undefined, ".jsonl"),
      command("settings.model", "model", "打开 DeepSeek 模型设置", "product", "none", idle, idle ? undefined : "当前任务仍在执行。"),
      command("settings.open", "settings", "打开环境配置", "product", "none", idle, idle ? undefined : "当前任务仍在执行。"),
      command("settings.trust", "trust", "打开项目资源信任设置", "product", "none", idle, idle ? undefined : "当前任务仍在执行。"),
      command("session.tree", "tree", "在同一 Session 中切换对话树分支", "harness", "none", false, "统一时间线尚未支持分支投影，当前不会执行。")
    ];
    const prompts = session.promptTemplates.map((template) => command(
      `prompt:${template.name}`,
      template.name,
      template.description || "Pi Prompt Template",
      "prompt",
      "text",
      idle && workspace.info.projectTrusted,
      workspace.info.projectTrusted ? (idle ? undefined : "当前任务仍在执行。") : "当前工作区未信任，Prompt Templates 未加载。",
      undefined,
      template.argumentHint ?? "[参数，可选]",
      true
    ));
    const skills = session.resourceLoader.getSkills().skills.map((skill) => command(
      `skill:${skill.name}`,
      `skill:${skill.name}`,
      skill.description || "Pi Skill",
      "skill",
      "text",
      idle && workspace.info.projectTrusted,
      workspace.info.projectTrusted ? (idle ? undefined : "当前任务仍在执行。") : "当前工作区未信任，Skills 未加载。",
      undefined,
      "[任务说明，可选]",
      true
    ));
    const extensions = session.extensionRunner.getRegisteredCommands().map((extension) => command(
      `extension:${extension.invocationName}`,
      extension.invocationName,
      extension.description || "Pi Extension 命令",
      "extension",
      "text",
      false,
      "该 Extension 命令可能依赖 Pi TUI 交互，当前 Web 不会冒险执行。",
      undefined,
      "[参数]"
    ));
    return dedupeCommands([...base, ...extensions, ...prompts, ...skills]);
  }

  async executeCommand(input: ExecuteHarnessCommandInput): Promise<CommandExecutionResult> {
    const previous = this.eventStore.getRequest<CommandExecutionResult>(input.requestId);
    if (previous) return previous;
    const pending = this.#pendingCommandRequests.get(input.requestId);
    if (pending) return await pending;
    const current = this.executeCommandOnce(input).then((result) => {
      this.eventStore.saveRequest(input.requestId, result);
      return result;
    }).finally(() => {
      if (this.#pendingCommandRequests.get(input.requestId) === current) this.#pendingCommandRequests.delete(input.requestId);
    });
    this.#pendingCommandRequests.set(input.requestId, current);
    return await current;
  }

  private async executeCommandOnce(input: ExecuteHarnessCommandInput): Promise<CommandExecutionResult> {
    const available = (await this.listCommands()).find((entry) => entry.id === input.commandId);
    if (!available) return commandRejected(input, this.activeSessionId ?? undefined, "该命令不在当前 Harness 命令目录中。");
    if (!available.available) return commandRejected(input, this.activeSessionId ?? undefined, available.unavailableReason ?? "该命令当前不可用。");
    const argument = input.argument?.trim();
    if (available.input === "text" && input.commandId === "session.rename" && !argument) {
      return commandRejected(input, this.activeSessionId ?? undefined, "请输入新的会话名称。");
    }
    if (available.input === "select" && !argument) {
      return commandRejected(input, this.activeSessionId ?? undefined, "请选择命令选项。");
    }
    if (available.input === "file" && !input.file) {
      return commandRejected(input, this.activeSessionId ?? undefined, "请选择 JSONL 会话文件。");
    }
    switch (input.commandId) {
      case "session.new": {
        const session = await this.createSession("新的开发任务");
        return commandAccepted(input, session.id, { type: "session", session });
      }
      case "session.resume": {
        const session = await this.openSession(argument!);
        return commandAccepted(input, session.id, { type: "session", session });
      }
      case "session.rename": {
        const session = this.renameSession(argument!);
        return commandAccepted(input, session.id, { type: "session", session });
      }
      case "session.fork": {
        const session = await this.forkSession(argument!);
        return commandAccepted(input, session.id, { type: "session", session });
      }
      case "session.clone": {
        this.ensureIdle();
        const runtime = this.requireRuntime();
        const leafId = runtime.session.sessionManager.getLeafId();
        if (!leafId) return commandRejected(input, runtime.session.sessionId, "当前会话还没有可复制的内容。");
        const result = await runtime.fork(leafId, { position: "at" });
        if (result.cancelled) return commandRejected(input, runtime.session.sessionId, "Pi 取消了会话复制。");
        const session = this.requireSession();
        session.setSessionName(`复制 · ${new Date().toLocaleString("zh-CN", { hour12: false })}`);
        this.persistCurrentSession("idle");
        return commandAccepted(input, session.sessionId, { type: "session", session: this.currentSummary() });
      }
      case "context.compact": {
        this.ensureIdle();
        const session = this.requireSession();
        try {
          const result = await session.compact(argument);
          this.persistCurrentSession("idle");
          return commandAccepted(input, session.sessionId, {
            type: "details",
            title: "上下文压缩完成",
            data: { tokensBefore: result.tokensBefore, estimatedTokensAfter: result.estimatedTokensAfter }
          });
        } catch (error) {
          return commandRejected(input, session.sessionId, safeErrorMessage(error));
        }
      }
      case "session.details": {
        const session = this.requireSession();
        const stats = session.getSessionStats();
        return commandAccepted(input, session.sessionId, {
          type: "details",
          title: "当前会话详情",
          data: safeSessionStats(stats)
        });
      }
      case "resources.reload": {
        this.ensureIdle();
        const session = this.requireSession();
        await session.reload();
        return commandAccepted(input, session.sessionId, {
          type: "details",
          title: "资源已重新加载",
          data: resourceSummary(session)
        });
      }
      case "message.copy-last": {
        const session = this.requireSession();
        const text = session.getLastAssistantText();
        return text
          ? commandAccepted(input, session.sessionId, { type: "clipboard", text })
          : commandRejected(input, session.sessionId, "当前会话还没有 Assistant 回复。");
      }
      case "session.export":
        return await this.exportSession(input, argument!);
      case "session.import":
        return await this.importSession(input);
      case "settings.model":
        return commandAccepted(input, this.requireSession().sessionId, { type: "navigate", path: "/setup?step=model" });
      case "settings.open":
        return commandAccepted(input, this.requireSession().sessionId, { type: "navigate", path: "/setup" });
      case "settings.trust":
        return commandAccepted(input, this.requireSession().sessionId, { type: "navigate", path: "/setup?step=trust" });
      default:
        if (input.commandId.startsWith("skill:") || input.commandId.startsWith("prompt:")) {
          return await this.executeResourceCommand(input, available);
        }
        return commandRejected(input, this.activeSessionId ?? undefined, "该命令当前没有可执行映射。");
    }
  }

  private async executeResourceCommand(input: ExecuteHarnessCommandInput, commandInfo: HarnessCommand): Promise<CommandExecutionResult> {
    const commandText = `/${commandInfo.name}${input.argument?.trim() ? ` ${input.argument.trim()}` : ""}`;
    const receipt = await this.submitTaskOnce(
      { requestId: input.requestId, text: commandText },
      true,
      false,
      input.commandId,
      commandText
    );
    return { ...receipt, commandId: input.commandId };
  }

  private async exportSession(input: ExecuteHarnessCommandInput, format: string): Promise<CommandExecutionResult> {
    this.ensureIdle();
    const session = this.requireSession();
    const exportDir = join(this.dataDir, "command-export-staging");
    await mkdir(exportDir, { recursive: true, mode: 0o700 });
    const target = join(exportDir, `${randomUUID()}.${format === "jsonl" ? "jsonl" : "html"}`);
    const path = format === "jsonl" ? session.exportToJsonl(target) : await session.exportToHtml(target);
    const exported = await this.commandExportStore.capture(path);
    return commandAccepted(input, session.sessionId, {
      type: "download",
      url: `/api/command-exports/${exported.id}`,
      fileName: exported.fileName
    });
  }

  private async importSession(input: ExecuteHarnessCommandInput): Promise<CommandExecutionResult> {
    this.ensureIdle();
    const currentSessionId = this.requireSession().sessionId;
    const file = input.file!;
    if (!file.name.toLowerCase().endsWith(".jsonl")) return commandRejected(input, currentSessionId, "只能导入 .jsonl 会话文件。");
    if (file.content.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.content)) {
      return commandRejected(input, currentSessionId, "JSONL 会话文件内容无效。");
    }
    const decoded = Buffer.from(file.content, "base64");
    if (decoded.length <= 0 || decoded.length > 10_000_000) return commandRejected(input, currentSessionId, "JSONL 会话文件必须小于 10 MB。");
    const normalized = normalizeImportedSessionJsonl(decoded, this.workspaceService.requireCurrent().path);
    if (!normalized) return commandRejected(input, currentSessionId, "JSONL 会话文件不是有效的 Pi 会话。");
    const staging = join(this.dataDir, "command-imports");
    const target = join(staging, `${normalized.sessionId}.jsonl`);
    await mkdir(staging, { recursive: true, mode: 0o700 });
    await writeFile(target, normalized.content, { encoding: "utf8", mode: 0o600 });
    try {
      const runtime = this.requireRuntime();
      const result = await runtime.importFromJsonl(target, this.workspaceService.requireCurrent().path);
      if (result.cancelled) return commandRejected(input, runtime.session.sessionId, "Pi 取消了会话导入。");
      this.persistCurrentSession("idle");
      return commandAccepted(input, this.requireSession().sessionId, { type: "session", session: this.currentSummary() });
    } catch {
      return commandRejected(input, this.activeSessionId ?? currentSessionId, "无法导入该 JSONL 会话，请确认文件来自兼容的 Pi 版本。");
    } finally {
      await rm(target, { force: true });
    }
  }

  async submitTask(input: SubmitTaskInput): Promise<CommandReceipt> {
    return await this.runIdempotent(input.requestId, async () => await this.submitTaskOnce(input));
  }

  private async submitTaskOnce(
    input: SubmitTaskInput,
    expandPromptTemplates = false,
    persistReceipt = true,
    commandId?: string,
    displayInput?: string
  ): Promise<CommandReceipt> {
    const text = input.text.trim();
    if (!text) return this.rejectReceipt(input.requestId, "任务内容不能为空。");
    const session = this.requireSession();
    if (session.isStreaming || this.#activeRun) {
      return this.rejectReceipt(input.requestId, "当前会话正在执行，请选择引导、跟进或停止。", session.sessionId);
    }

    const runId = randomUUID();
    this.#activeRun = {
      id: runId,
      status: "submitting",
      ...(commandId ? { commandId } : {}),
      ...(displayInput ? { displayInput } : {}),
      interruptRequested: false,
      lastToolCompletionFailed: false,
      settled: false
    };
    this.eventStore.updateSessionStatus(session.sessionId, "submitting");
    try {
      await this.workspaceService.captureRunBaseline(runId);
    } catch (error) {
      this.#activeRun = undefined;
      this.eventStore.updateSessionStatus(session.sessionId, "idle");
      throw error;
    }

    let receiptResolved = false;
    const receiptPromise = new Promise<CommandReceipt>((resolveReceipt) => {
      const finish = (receipt: CommandReceipt) => {
        if (receiptResolved) return;
        receiptResolved = true;
        if (persistReceipt) this.eventStore.saveRequest(input.requestId, receipt);
        resolveReceipt(receipt);
      };

      void session.prompt(text, {
        expandPromptTemplates,
        source: "rpc",
        preflightResult: (accepted) => {
          if (!accepted) {
            this.#activeRun = undefined;
            this.eventStore.updateSessionStatus(session.sessionId, "idle");
            void this.workspaceService.removeRunBaselines([runId]);
            finish({ requestId: input.requestId, accepted: false, sessionId: session.sessionId, reason: "Pi 拒绝了本次任务。" });
            return;
          }
          if (this.#activeRun) this.#activeRun.status = "acknowledged";
          this.eventStore.updateSessionStatus(session.sessionId, "acknowledged");
          this.emit("run.acknowledged", "bridge", {
            requestId: input.requestId,
            status: "acknowledged",
            ...(commandId ? { commandId } : {})
          }, "final", runId);
          finish({ requestId: input.requestId, accepted: true, sessionId: session.sessionId, runId });
        }
      }).catch((error: unknown) => {
        const message = safeErrorMessage(error);
        if (!receiptResolved) {
          this.#activeRun = undefined;
          this.eventStore.updateSessionStatus(session.sessionId, "idle");
          void this.workspaceService.removeRunBaselines([runId]);
          finish({ requestId: input.requestId, accepted: false, sessionId: session.sessionId, reason: message });
          return;
        }
        if (this.#activeRun && !this.#activeRun.settled) {
          this.emit("error", "harness", { code: "run_rejected", message, retryable: true }, "final", runId);
          void this.finalizeRun("failed");
        }
      });
    });

    return await receiptPromise;
  }

  assertCurrentSession(sessionId: string): void {
    const session = this.requireSession();
    if (session.sessionId !== sessionId) {
      throw new BridgeError(409, "session_not_active", "该会话当前未激活，请先打开会话。", false);
    }
  }

  async steer(requestId: string, text: string): Promise<CommandReceipt> {
    return await this.queueControl("steer", requestId, text);
  }

  async followUp(requestId: string, text: string): Promise<CommandReceipt> {
    return await this.queueControl("followUp", requestId, text);
  }

  async interrupt(requestId: string): Promise<CommandReceipt> {
    return await this.runIdempotent(requestId, async () => await this.interruptOnce(requestId));
  }

  private async interruptOnce(requestId: string): Promise<CommandReceipt> {
    const session = this.requireSession();
    const activeRun = this.#activeRun;
    if (!activeRun || !session.isStreaming || activeRun.status === "interrupting") {
      return this.rejectReceipt(requestId, "当前没有可停止的执行。", session.sessionId);
    }
    activeRun.status = "interrupting";
    activeRun.interruptRequested = true;
    this.eventStore.updateSessionStatus(session.sessionId, "interrupting");
    const cleared = session.clearQueue();
    this.emit("queue.updated", "bridge", {
      steeringCount: 0,
      followUpCount: 0,
      clearedSteeringCount: cleared.steering.length,
      clearedFollowUpCount: cleared.followUp.length
    }, "snapshot", activeRun.id);
    try {
      await session.abort();
    } catch (error) {
      if (this.#activeRun === activeRun && !activeRun.settled) {
        activeRun.status = "running";
        activeRun.interruptRequested = false;
        this.eventStore.updateSessionStatus(session.sessionId, "running");
      }
      this.emit("error", "harness", {
        code: "interrupt_failed",
        message: safeErrorMessage(error),
        retryable: true
      }, "final", activeRun.id);
      return this.rejectReceipt(requestId, "停止执行失败；已排队的引导与跟进消息已清空。", session.sessionId);
    }
    const receipt: CommandReceipt = {
      requestId,
      accepted: true,
      sessionId: session.sessionId,
      runId: activeRun.id
    };
    this.eventStore.saveRequest(requestId, receipt);
    return receipt;
  }

  async dispose(): Promise<void> {
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    await this.#runtime?.dispose();
    await this.#eventQueue;
    this.#runtime = undefined;
  }

  private get agentDir(): string {
    return join(this.dataDir, "pi-agent");
  }

  private get sessionDir(): string {
    return join(this.dataDir, "pi-sessions");
  }

  private createRuntimeFactory(): CreateAgentSessionRuntimeFactory {
    return async (options) => {
      const workspace = this.workspaceService.requireCurrent();
      const settingsManager = SettingsManager.inMemory({
        compaction: { enabled: true },
        retry: { enabled: true },
        enableAnalytics: false,
        enableInstallTelemetry: false
      });
      settingsManager.setProjectTrusted(workspace.info.projectTrusted);
      const locked = !workspace.info.projectTrusted;
      const services = await createAgentSessionServices({
        cwd: options.cwd,
        agentDir: options.agentDir,
        settingsManager,
        modelRuntime: this.modelService.requireRuntime(),
        resourceLoaderOptions: locked ? {
          noExtensions: true,
          noSkills: true,
          noPromptTemplates: true,
          noThemes: true,
          noContextFiles: true,
          systemPrompt: lockedSystemPrompt(workspace.acceptance)
        } : {}
      });
      const created = await createAgentSessionFromServices({
        services,
        sessionManager: options.sessionManager,
        ...(options.sessionStartEvent ? { sessionStartEvent: options.sessionStartEvent } : {}),
        model: this.modelService.requireModel(),
        thinkingLevel: this.modelService.info.thinkingLevel,
        tools: ["read", "edit", "write", "bash"]
      });
      created.session.agent.state.tools = [
        createReadTool(workspace.path),
        createEditTool(workspace.path),
        createWriteTool(workspace.path),
        createBashTool(workspace.path, {
          exposeSessionEnvironment: false,
          spawnHook: createSafeBashSpawnHook()
        })
      ];
      return { ...created, services, diagnostics: services.diagnostics };
    };
  }

  private bindSession(session: AgentSession): void {
    this.#unsubscribe?.();
    this.#runtimeGeneration = this.eventStore.nextRuntimeGeneration(session.sessionId);
    const boundGeneration = this.#runtimeGeneration;
    installToolBoundary(session, this.workspaceService);
    this.#unsubscribe = session.subscribe((event) => {
      this.#eventQueue = this.#eventQueue.then(async () => {
        if (boundGeneration !== this.#runtimeGeneration) return;
        await this.handlePiEvent(event);
      }).catch((error: unknown) => {
        if (boundGeneration !== this.#runtimeGeneration || !this.#runtime) return;
        this.emit("error", "bridge", { code: "event_mapping_failed", message: safeErrorMessage(error), retryable: true }, "final", this.#activeRun?.id);
      });
    });
    this.#activeRun = undefined;
    this.persistCurrentSession("idle", session);
  }

  private async handlePiEvent(event: AgentSessionEvent): Promise<void> {
    const activeRun = this.#activeRun;
    if (event.type === "agent_settled") {
      if (activeRun && !activeRun.settled) await this.finalizeRun(deriveSettledStatus(this.requireSession(), activeRun));
      return;
    }
    if (event.type === "agent_start" && activeRun) {
      activeRun.status = "running";
      this.eventStore.updateSessionStatus(this.requireSession().sessionId, "running");
    }
    if (event.type === "agent_end" && activeRun) {
      activeRun.status = "settling";
      this.eventStore.updateSessionStatus(this.requireSession().sessionId, "settling");
    }
    if (event.type === "tool_execution_end" && activeRun) {
      activeRun.lastToolCompletionFailed = event.isError;
    }
    const managedOutput = event.type === "tool_execution_end"
      ? await this.captureFullToolOutput(event)
      : undefined;
    const contextUsage = event.type === "message_end"
      ? this.requireSession().getContextUsage()
      : undefined;
    for (const mapped of mapPiEvent(event)) {
      let payload = mapped.payload;
      if (
        activeRun?.displayInput
        && mapped.kind === "message.completed"
        && payload.role === "user"
      ) {
        payload = { ...payload, text: activeRun.displayInput, thinking: "" };
      }
      if (managedOutput && mapped.kind === "tool.completed") {
        payload = { ...payload, details: { ...asRecord(payload.details), ...managedOutput } };
      }
      if (contextUsage && mapped.kind === "usage.updated") {
        payload = { ...payload, context: contextUsage };
      }
      this.emit(mapped.kind, mapped.source, payload, mapped.updateMode, activeRun?.id, mapped.raw);
    }
  }

  private async captureFullToolOutput(event: Extract<AgentSessionEvent, { type: "tool_execution_end" }>): Promise<{ fullOutputId: string; fullOutputSize: number } | undefined> {
    const details = asRecord(asRecord(event.result).details);
    const sourcePath = details.fullOutputPath;
    if (details.truncation === undefined || typeof sourcePath !== "string") return undefined;
    const captured = await this.toolOutputStore.capturePiTempFile(sourcePath);
    return captured ? { fullOutputId: captured.outputId, fullOutputSize: captured.size } : undefined;
  }

  private async finalizeRun(finalStatus: RunStatus): Promise<void> {
    const activeRun = this.#activeRun;
    if (!activeRun || activeRun.settled) return;
    activeRun.settled = true;
    activeRun.status = finalStatus;
    const session = this.requireSession();
    try {
      const snapshot = await this.workspaceService.snapshot(activeRun.id);
      let acceptanceRecord: AcceptanceRecord | undefined;
      this.emit("workspace.changed", "workspace", {
        changes: snapshot.changes,
        fileCount: snapshot.workspace.fileCount
      }, "snapshot", activeRun.id);
      if (this.workspaceService.requireCurrent().acceptance) {
        try {
          acceptanceRecord = await this.buildAcceptanceRecord(activeRun.id, finalStatus);
        } catch (error) {
          this.emit("error", "bridge", {
            code: "acceptance_record_failed",
            message: safeErrorMessage(error),
            retryable: true
          }, "final", activeRun.id);
        }
      }
      this.persistCurrentSession(finalStatus, session);
      this.#activeRun = undefined;
      this.emit("run.settled", "harness", { status: finalStatus }, "final", activeRun.id, undefined, session);
      if (acceptanceRecord) {
        const events = this.eventStore.listEvents(session.sessionId).filter((event) => event.runId === activeRun.id);
        const completeRecord: AcceptanceRecord = {
          ...acceptanceRecord,
          eventCount: events.length,
          eventKinds: unique(events.map((event) => event.kind)),
          eventSequence: {
            first: events.at(0)?.sequence ?? 0,
            last: events.at(-1)?.sequence ?? 0
          }
        };
        try {
          this.eventStore.saveAcceptanceRecord(completeRecord);
          this.acceptanceRecordStore.save(completeRecord);
        } catch (error) {
          this.emit("error", "bridge", {
            code: "acceptance_record_failed",
            message: safeErrorMessage(error),
            retryable: true
          }, "final", activeRun.id, undefined, session);
        }
      }
    } catch (error) {
      this.#activeRun = undefined;
      this.emit("error", "bridge", {
        code: "run_finalization_failed",
        message: safeErrorMessage(error),
        retryable: true
      }, "final", activeRun.id, undefined, session);
      this.emit("run.settled", "bridge", { status: "unknown" }, "final", activeRun.id, undefined, session);
      this.eventStore.updateSessionStatus(session.sessionId, "unknown");
    }
  }

  private async buildAcceptanceRecord(runId: string, finalStatus: RunStatus): Promise<AcceptanceRecord> {
    const current = this.workspaceService.requireCurrent();
    const session = this.requireSession();
    const events = this.eventStore.listEvents(session.sessionId).filter((event) => event.runId === runId);
    const changes = (await this.workspaceService.snapshot(runId)).changes;
    const verificationFile = current.templateVersion === "counter-v1" ? "test.mjs" : "verify.mjs";
    const verification = await runProcess(process.execPath, [verificationFile], current.path, 30_000);
    const toolNames = unique(events.flatMap((event) => {
      const name = event.payload.toolName;
      return typeof name === "string" ? [name] : [];
    }));
    const features = inferFeatures(events, changes.length > 0);
    if (events.some((event) => typeof event.payload.commandId === "string")) features.push("FM-12");
    const expectedFinalStatus: RunStatus = current.templateVersion === "control-v1" ? "cancelled" : "completed";
    const verificationPassed = verification.exitCode === 0;
    return {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      adapterId: "pi",
      adapterVersion: "0.1.0",
      harnessId: "pi",
      harnessVersion: PI_VERSION,
      modelId: this.modelService.info.modelId,
      workspaceTemplateVersion: current.templateVersion,
      workspaceId: current.info.id,
      workspaceDisplayPath: current.info.displayPath,
      sessionId: session.sessionId,
      runId,
      finalStatus,
      expectedFinalStatus,
      passed: verificationPassed && finalStatus === expectedFinalStatus,
      features,
      eventCount: events.length,
      eventKinds: unique(events.map((event) => event.kind)),
      eventSequence: {
        first: events.at(0)?.sequence ?? 0,
        last: events.at(-1)?.sequence ?? 0
      },
      toolNames,
      changedFiles: changes.map((change) => change.path),
      verification: {
        command: `node ${verificationFile}`,
        exitCode: verification.exitCode,
        passed: verificationPassed,
        output: sanitizeEvidenceText(`${verification.stdout}${verification.stderr}`.trim())
      },
      evidenceSource: "real-runtime"
    };
  }

  private emit(
    kind: HarnessEvent["kind"],
    source: HarnessEvent["source"],
    payload: Record<string, unknown>,
    updateMode?: HarnessEvent["updateMode"],
    runId?: string,
    raw?: Record<string, unknown>,
    targetSession?: AgentSession
  ): void {
    const session = targetSession ?? this.requireSession();
    const event: HarnessEvent = {
      id: randomUUID(),
      sequence: this.eventStore.nextSessionSequence(session.sessionId),
      sessionId: session.sessionId,
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

  private async queueControl(mode: "steer" | "followUp", requestId: string, text: string): Promise<CommandReceipt> {
    return await this.runIdempotent(requestId, async () => await this.queueControlOnce(mode, requestId, text));
  }

  private async queueControlOnce(mode: "steer" | "followUp", requestId: string, text: string): Promise<CommandReceipt> {
    const session = this.requireSession();
    const activeRun = this.#activeRun;
    if (!activeRun || !session.isStreaming) return this.rejectReceipt(requestId, "当前没有正在执行的任务。", session.sessionId);
    const message = text.trim();
    if (!message) return this.rejectReceipt(requestId, "消息内容不能为空。", session.sessionId);
    if (mode === "steer") await session.steer(message);
    else await session.followUp(message);
    const receipt: CommandReceipt = {
      requestId,
      accepted: true,
      sessionId: session.sessionId,
      runId: activeRun.id
    };
    this.eventStore.saveRequest(requestId, receipt);
    return receipt;
  }

  private async runIdempotent(requestId: string, operation: () => Promise<CommandReceipt>): Promise<CommandReceipt> {
    const previous = this.eventStore.getRequest<CommandReceipt>(requestId);
    if (previous) return previous;
    const pending = this.#pendingRequests.get(requestId);
    if (pending) return await pending;
    const current = Promise.resolve().then(operation).finally(() => {
      if (this.#pendingRequests.get(requestId) === current) this.#pendingRequests.delete(requestId);
    });
    this.#pendingRequests.set(requestId, current);
    return await current;
  }

  private rejectReceipt(requestId: string, reason: string, sessionId?: string): CommandReceipt {
    const receipt: CommandReceipt = {
      requestId,
      accepted: false,
      ...(sessionId ? { sessionId } : {}),
      reason
    };
    this.eventStore.saveRequest(requestId, receipt);
    return receipt;
  }

  private persistCurrentSession(status: RunStatus, session = this.requireSession()): void {
    const workspace = this.workspaceService.requireCurrent();
    const sessionFile = session.sessionFile ?? join(this.sessionDir, `${session.sessionId}.jsonl`);
    this.eventStore.upsertSession({
      id: session.sessionId,
      adapterId: this.id,
      runtimeSessionRef: sessionFile,
      name: session.sessionName ?? `会话 ${new Date().toLocaleString("zh-CN", { hour12: false })}`,
      workspacePath: workspace.path,
      modelId: this.modelService.info.modelId,
      runStatus: status,
      recoverable: existsSync(sessionFile)
    });
  }

  private currentSummary(): SessionSummary {
    const session = this.requireSession();
    const summary = this.eventStore.listSessions(this.workspaceService.requireCurrent().path, this.id).find((entry) => entry.id === session.sessionId);
    if (summary) return { ...summary, recoverable: this.runtimeSessionExists(session.sessionId) };
    return {
      id: session.sessionId,
      name: session.sessionName ?? "未命名会话",
      updatedAt: new Date().toISOString(),
      modelId: this.modelService.info.modelId,
      runStatus: "idle",
      recoverable: Boolean(session.sessionFile && existsSync(session.sessionFile))
    };
  }

  private runtimeSessionExists(sessionId: string): boolean {
    const sessionFile = this.eventStore.getRuntimeSessionRef(sessionId);
    return Boolean(sessionFile && existsSync(sessionFile));
  }

  private ensureReadyForSession(): void {
    this.workspaceService.requireCurrent();
    this.modelService.requireModel();
  }

  private ensureIdle(): void {
    if (this.#runtime?.session.isStreaming || this.#activeRun) {
      throw new BridgeError(409, "run_in_progress", "当前任务仍在执行，请先停止或等待完成。", false);
    }
  }

  private requireRuntime(): AgentSessionRuntime {
    if (!this.#runtime) throw new BridgeError(409, "session_unselected", "请先创建或打开一个会话。", false);
    return this.#runtime;
  }

  private requireSession(): AgentSession {
    return this.requireRuntime().session;
  }
}

function normalizeSessionName(name?: string): string {
  const value = name?.trim();
  return value ? value.slice(0, 80) : `会话 ${new Date().toLocaleString("zh-CN", { hour12: false })}`;
}

function normalizeImportedSessionJsonl(
  content: Buffer,
  workspacePath: string
): { sessionId: string; content: string } | undefined {
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch {
    return undefined;
  }
  const lines = source.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return undefined;
  const entries: Record<string, unknown>[] = [];
  try {
    for (const line of lines) {
      const parsed = JSON.parse(line) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
      entries.push(parsed as Record<string, unknown>);
    }
  } catch {
    return undefined;
  }
  const header = entries[0];
  if (header?.type !== "session" || typeof header.version !== "number" || !Number.isInteger(header.version) || header.version < 1) {
    return undefined;
  }
  const sessionId = randomUUID();
  const { parentSession: _parentSession, ...portableHeader } = header;
  entries[0] = {
    ...portableHeader,
    type: "session",
    id: sessionId,
    timestamp: new Date().toISOString(),
    cwd: workspacePath
  };
  return { sessionId, content: `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n` };
}

function command(
  id: string,
  name: string,
  description: string,
  source: HarnessCommand["source"],
  input: HarnessCommand["input"],
  available: boolean,
  unavailableReason?: string,
  options?: HarnessCommand["options"],
  argumentHint?: string,
  startsRun = false,
  argumentRequired = false
): HarnessCommand {
  return {
    id,
    name,
    description,
    source,
    input,
    argumentRequired: argumentRequired || input === "select" || input === "file",
    available,
    startsRun,
    ...(unavailableReason ? { unavailableReason } : {}),
    ...(options ? { options } : {}),
    ...(argumentHint ? { argumentHint } : {})
  };
}

function dedupeCommands(commands: HarnessCommand[]): HarnessCommand[] {
  const byName = new Set<string>();
  const result: HarnessCommand[] = [];
  for (const item of commands) {
    if (byName.has(item.name)) continue;
    byName.add(item.name);
    result.push(item);
  }
  return result;
}

function commandAccepted(
  input: ExecuteHarnessCommandInput,
  sessionId: string,
  effect?: CommandExecutionResult["effect"]
): CommandExecutionResult {
  return {
    requestId: input.requestId,
    commandId: input.commandId,
    accepted: true,
    sessionId,
    ...(effect ? { effect } : {})
  };
}

function commandRejected(
  input: ExecuteHarnessCommandInput,
  sessionId: string | undefined,
  reason: string
): CommandExecutionResult {
  return {
    requestId: input.requestId,
    commandId: input.commandId,
    accepted: false,
    ...(sessionId ? { sessionId } : {}),
    reason
  };
}

function safeSessionStats(stats: ReturnType<AgentSession["getSessionStats"]>): Record<string, unknown> {
  return {
    sessionId: stats.sessionId,
    userMessages: stats.userMessages,
    assistantMessages: stats.assistantMessages,
    toolCalls: stats.toolCalls,
    toolResults: stats.toolResults,
    totalMessages: stats.totalMessages,
    tokens: stats.tokens,
    cost: stats.cost,
    ...(stats.contextUsage ? { contextUsage: stats.contextUsage } : {})
  };
}

function resourceSummary(session: AgentSession): Record<string, unknown> {
  return {
    skills: session.resourceLoader.getSkills().skills.map((skill) => skill.name),
    promptTemplates: session.promptTemplates.map((template) => template.name),
    extensionCommands: session.extensionRunner.getRegisteredCommands().map((item) => item.invocationName)
  };
}

async function removeOwnedSessionFile(sessionDir: string, sessionFile: string): Promise<void> {
  const root = resolve(sessionDir);
  const target = resolve(sessionFile);
  const relativePath = relative(root, target);
  if (!relativePath || relativePath === ".." || relativePath.startsWith(`..${sep}`) || relativePath.startsWith(sep)) return;
  try {
    await unlink(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw new BridgeError(500, "session_file_delete_failed", "无法删除会话运行记录，请重试。", true);
  }
}

export function deriveSettledStatus(
  session: Pick<AgentSession, "messages">,
  run: Pick<ActiveRun, "interruptRequested" | "lastToolCompletionFailed">
): RunStatus {
  if (run.interruptRequested) return "cancelled";
  const lastAssistant = [...session.messages].reverse().find((message) => message.role === "assistant");
  if (!lastAssistant || lastAssistant.role !== "assistant") return "unknown";
  if (lastAssistant.stopReason === "aborted") return "cancelled";
  if (lastAssistant.stopReason === "error") return "failed";
  if (run.lastToolCompletionFailed && lastAssistant.stopReason === "toolUse") return "failed";
  return "completed";
}

function lockedSystemPrompt(acceptance: boolean): string {
  const base = [
    "你是 FF - DeepSeek Harness Web 中运行的编程 Agent。",
    "只能处理当前工作目录内的文件，不得读取环境变量、上级目录、用户主目录、绝对路径或任何凭据。",
    "必须根据用户任务使用必要工具，并在验证后简洁汇报真实结果。"
  ];
  if (acceptance) {
    base.push("这是内置验收工作区，只能访问系统为当前模板允许的文件并运行其精确验证命令。");
  }
  return base.join("\n");
}

function installToolBoundary(session: AgentSession, workspaceService: WorkspaceService): void {
  const original = session.agent.beforeToolCall;
  session.agent.beforeToolCall = async (context, signal) => {
    const workspace = workspaceService.requireCurrent();
    const name = context.toolCall.name;
    const args = asRecord(context.args);
    if (["read", "edit", "write"].includes(name)) {
      const requested = typeof args.path === "string" ? args.path : "";
      let normalized: string;
      try {
        normalized = await normalizeToolPath(workspace.path, requested);
      } catch (error) {
        return block(safeErrorMessage(error));
      }
      if (workspace.acceptance) {
        const policy = acceptancePolicy(workspace.templateVersion);
        if (name === "read" && !policy.read.includes(normalized)) {
          return block("验收工作区只允许读取指定源码和测试文件。");
        }
        if ((name === "edit" || name === "write") && !policy.write.includes(normalized)) {
          return block("验收工作区不允许修改该文件。");
        }
      }
    } else if (name === "bash") {
      const command = typeof args.command === "string" ? args.command.trim() : "";
      if (workspace.acceptance && !acceptancePolicy(workspace.templateVersion).commands.includes(command)) {
        return block("验收工作区只允许运行当前模板的精确命令。");
      }
      if (!workspace.acceptance && !workspace.info.projectTrusted) {
        return block("当前工作区尚未授予命令执行信任。");
      }
    } else {
      return block("当前产品未开放该工具。");
    }
    return await original?.(context, signal);
  };
}

export async function normalizeToolPath(root: string, input: string): Promise<string> {
  if (!input || input.includes("\0")) throw new Error("工具文件路径无效。");
  const lexicalRoot = resolve(root);
  const canonicalRoot = await realpath(lexicalRoot);
  const target = resolve(lexicalRoot, input);
  const relativePath = relative(lexicalRoot, target);
  if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || relativePath.startsWith(sep)) {
    throw new Error("工具文件路径超出工作区。");
  }
  const existing = await realpath(target).catch(() => undefined);
  if (existing) {
    const resolvedRelative = relative(canonicalRoot, existing);
    if (resolvedRelative === ".." || resolvedRelative.startsWith(`..${sep}`) || resolvedRelative.startsWith(sep)) {
      throw new Error("符号链接目标超出工作区。");
    }
  } else {
    let parent = dirname(target);
    while (parent !== dirname(parent)) {
      const resolvedParent = await realpath(parent).catch(() => undefined);
      if (resolvedParent) {
        const resolvedRelative = relative(canonicalRoot, resolvedParent);
        if (resolvedRelative === ".." || resolvedRelative.startsWith(`..${sep}`) || resolvedRelative.startsWith(sep)) {
          throw new Error("符号链接父目录超出工作区。");
        }
        break;
      }
      parent = dirname(parent);
    }
  }
  return relativePath.split(sep).join("/");
}

function block(reason: string): { block: true; reason: string; terminate: true } {
  return { block: true, reason, terminate: true };
}

function inferFeatures(events: HarnessEvent[], hasChanges: boolean): string[] {
  const features = new Set(["FM-01", "FM-02", "FM-03", "FM-04", "FM-05", "FM-06", "FM-10", "FM-11"]);
  if (events.some((event) => event.kind.startsWith("tool."))) features.add("FM-07");
  if (hasChanges) features.add("FM-08");
  if (events.some((event) => event.kind === "usage.updated" || event.kind.startsWith("retry.") || event.kind.startsWith("compaction."))) {
    features.add("FM-09");
  }
  return [...features].sort();
}

function sanitizeEvidenceText(value: string): string {
  return value.slice(0, 20_000).replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]");
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "未知错误";
  return sanitizeEvidenceText(message).replaceAll(process.cwd(), "[PROJECT]");
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function acceptancePolicy(templateVersion: string): { read: string[]; write: string[]; commands: string[] } {
  if (templateVersion === "command-center-v1") {
    return {
      read: ["README.md", "verify.mjs", ".pi/prompts/command-check.md", ".pi/skills/command-check/SKILL.md", ".pi/extensions/command-check.ts"],
      write: [],
      commands: []
    };
  }
  if (templateVersion === "control-v1") {
    return { read: ["README.md", "wait.mjs", "verify.mjs"], write: [], commands: ["node wait.mjs"] };
  }
  if (templateVersion === "long-output-v1") {
    return { read: ["README.md", "long-output.mjs", "verify.mjs"], write: [], commands: ["node long-output.mjs"] };
  }
  return { read: ["src/counter.js", "test.mjs"], write: ["src/counter.js"], commands: ["node test.mjs"] };
}

function safeToolEnvironment(): NodeJS.ProcessEnv {
  const allowed = ["PATH", "LANG", "LC_ALL", "TMPDIR", "SystemRoot", "ComSpec", "PATHEXT"] as const;
  return Object.fromEntries(
    allowed.flatMap((name) => process.env[name] === undefined ? [] : [[name, process.env[name]]])
  );
}

export function createSafeBashSpawnHook() {
  return ({ command, cwd }: { command: string; cwd: string }) => ({ command, cwd, env: safeToolEnvironment() });
}
