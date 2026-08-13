import { configureStore, createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type {
  BridgeSessionSummary,
  CommandReceipt,
  HarnessEvent,
  ModelInfo,
  RuntimeInfo,
  WorkspaceInfo,
  WorkspaceSnapshot
} from "../api/contracts";
import { bridgeApi } from "../api/bridge-api";
import type {
  ComposerMode,
  ConnectionStatus,
  HarnessState,
  InspectorKind,
  RunStatus,
  SetupStep
} from "../contracts/view-model";

const setupInitial: HarnessState["setup"] = {
  currentStep: "environment",
  runtimeChoice: "pi-deepseek",
  environment: "idle",
  model: "idle",
  workspace: "idle",
  trust: "undecided",
  modelId: "deepseek-v4-flash",
  thinkingLevel: "high",
  errorMessage: null
};

const initialState: HarnessState = {
  setup: { ...setupInitial },
  runtime: null,
  capabilityDecisions: null,
  model: null,
  workspace: null,
  connection: "connected",
  runStatus: "idle",
  currentRunId: null,
  pendingRequestId: null,
  currentPrompt: "",
  assistantText: "",
  thinkingText: "",
  usage: null,
  activity: [],
  activeDock: "sessions",
  selectedFileId: null,
  selectedSessionId: "",
  sessionDetached: false,
  inspector: "process",
  selectedToolId: null,
  artifactPaths: [],
  composerMode: "prompt",
  composerDraft: "",
  queuedSteering: 0,
  queuedFollowUp: 0,
  sequenceGap: null,
  files: [],
  sessions: [],
  tools: [],
  events: [],
  lastSequence: 0,
  notice: null
};

const harnessSlice = createSlice({
  name: "harness",
  initialState,
  reducers: {
    setSetupStep(state, action: PayloadAction<SetupStep>) {
      state.setup.currentStep = action.payload;
    },
    setModelId(state, action: PayloadAction<string>) {
      if (state.setup.modelId === action.payload) return;
      state.setup.modelId = action.payload;
      state.setup.model = "idle";
      state.setup.errorMessage = null;
    },
    setThinkingLevel(state, action: PayloadAction<"high" | "max">) {
      if (state.setup.thinkingLevel === action.payload) return;
      state.setup.thinkingLevel = action.payload;
      state.setup.model = "idle";
      state.setup.errorMessage = null;
    },
    setRuntimeChoice(state, action: PayloadAction<import("../contracts/view-model").RuntimeChoice>) {
      if (state.setup.runtimeChoice === action.payload) return;
      state.setup.runtimeChoice = action.payload;
      state.setup.environment = "idle";
      state.setup.model = "idle";
      state.setup.errorMessage = null;
    },
    setSetupStatus(state, action: PayloadAction<{ key: "environment" | "model" | "workspace"; value: HarnessState["setup"]["environment"]; errorMessage?: string }>) {
      state.setup[action.payload.key] = action.payload.value;
      state.setup.errorMessage = action.payload.errorMessage ?? null;
    },
    setTrust(state, action: PayloadAction<"restricted" | "trusted">) {
      state.setup.trust = action.payload;
      state.setup.errorMessage = null;
    },
    resetSetup(state) {
      state.setup = { ...setupInitial };
    },
    setRuntime(state, action: PayloadAction<RuntimeInfo>) {
      const adapterChanged = state.runtime !== null && state.runtime.adapterId !== action.payload.adapterId;
      state.runtime = action.payload;
      state.setup.runtimeChoice = action.payload.adapterId === "deepseek-official" ? "deepseek-harness" : "pi-deepseek";
      state.setup.environment = action.payload.status === "ready" ? "complete" : "error";
      if (adapterChanged) {
        state.model = null;
        state.setup.model = "idle";
        resetWorkspaceContext(state);
      }
    },
    setCapabilityDecisions(state, action: PayloadAction<import("../api/contracts").CapabilityDecisionSet>) {
      state.capabilityDecisions = action.payload;
    },
    setModel(state, action: PayloadAction<ModelInfo>) {
      state.model = action.payload;
      state.setup.modelId = action.payload.modelId;
      state.setup.thinkingLevel = action.payload.thinkingLevel;
      state.setup.model = action.payload.status === "ready" ? "complete" : action.payload.status === "unconfigured" ? "idle" : "error";
      state.setup.errorMessage = action.payload.status === "ready" || action.payload.status === "unconfigured"
        ? null
        : action.payload.errorMessage ?? modelErrorMessage(action.payload.errorCode);
    },
    setWorkspace(state, action: PayloadAction<WorkspaceInfo>) {
      if (state.workspace && state.workspace.id !== action.payload.id) resetWorkspaceContext(state);
      state.workspace = action.payload;
      state.setup.workspace = action.payload.status === "ready" ? "complete" : "error";
      state.setup.trust = action.payload.projectTrusted ? "trusted" : "restricted";
    },
    hydrateWorkspace(state, action: PayloadAction<WorkspaceSnapshot>) {
      if (state.workspace && state.workspace.id !== action.payload.workspace.id) resetWorkspaceContext(state);
      state.workspace = action.payload.workspace;
      state.setup.workspace = action.payload.workspace.status === "ready" ? "complete" : "error";
      state.setup.trust = action.payload.workspace.projectTrusted ? "trusted" : "restricted";
      const expanded = new Map(state.files.filter((entry) => entry.kind === "folder").map((entry) => [entry.path, entry.expanded]));
      const changes = new Map(action.payload.changes.map((entry) => [entry.path, entry]));
      const mappedFiles = action.payload.files
        .filter((entry) => entry.kind !== "symlink")
        .map((entry) => {
          const change = changes.get(entry.path);
          return {
            id: entry.path,
            name: entry.name,
            path: entry.path,
            kind: entry.kind === "directory" ? "folder" as const : "file" as const,
            depth: entry.depth + 1,
            ...(entry.kind === "directory" ? { expanded: expanded.get(entry.path) ?? true } : {}),
            ...(change ? { changed: true, changeKind: normalizeChangeKind(change.status), staged: change.staged, unstaged: change.unstaged, ...(change.previousPath ? { previousPath: change.previousPath } : {}) } : {}),
            ...(entry.kind === "file" ? { language: languageFor(entry.path) } : {})
          };
        });
      const missingChangedFiles = action.payload.changes
        .filter((change) => !mappedFiles.some((entry) => entry.path === change.path))
        .map((change) => ({
          id: change.path,
          name: change.path,
          path: change.path,
          kind: "file" as const,
          depth: 1,
          changed: true,
          changeKind: normalizeChangeKind(change.status),
          staged: change.staged,
          unstaged: change.unstaged,
          ...(change.previousPath ? { previousPath: change.previousPath } : {}),
          language: languageFor(change.path)
        }));
      state.files = [
        {
          id: "__workspace__",
          name: action.payload.workspace.name,
          path: "",
          kind: "folder",
          depth: 0,
          expanded: expanded.get("") ?? true
        },
        ...mappedFiles,
        ...missingChangedFiles
      ];
      if (!state.selectedFileId || !state.files.some((entry) => entry.id === state.selectedFileId)) {
        state.selectedFileId = state.files.find((entry) => entry.kind === "file" && entry.changed)?.id
          ?? state.files.find((entry) => entry.kind === "file")?.id
          ?? null;
      }
      const candidates = new Set(action.payload.changes.filter((entry) => entry.status !== "deleted").map((entry) => entry.path));
      state.artifactPaths = state.artifactPaths.filter((path) => candidates.has(path));
    },
    hydrateSessions(state, action: PayloadAction<BridgeSessionSummary[]>) {
      state.sessions = action.payload.map(toSessionSummary);
    },
    restoreActiveSession(state, action: PayloadAction<{ sessions: BridgeSessionSummary[]; activeSessionId: string | null }>) {
      state.sessions = action.payload.sessions.map(toSessionSummary);
      if (!action.payload.activeSessionId || state.selectedSessionId || state.sessionDetached) return;
      const active = state.sessions.find((entry) => entry.id === action.payload.activeSessionId);
      if (active) {
        state.selectedSessionId = active.id;
        state.runStatus = active.status;
      }
    },
    setCurrentSession(state, action: PayloadAction<BridgeSessionSummary>) {
      const summary = toSessionSummary(action.payload);
      const existing = state.sessions.findIndex((entry) => entry.id === summary.id);
      if (existing >= 0) state.sessions[existing] = summary;
      else state.sessions.unshift(summary);
      state.selectedSessionId = summary.id;
      state.sessionDetached = false;
      state.runStatus = summary.status;
      resetRunView(state);
    },
    selectSession(state, action: PayloadAction<string>) {
      state.selectedSessionId = action.payload;
      state.sessionDetached = false;
      const session = state.sessions.find((entry) => entry.id === action.payload);
      state.runStatus = session?.status ?? "idle";
      resetRunView(state);
    },
    detachSession(state) {
      state.selectedSessionId = "";
      state.sessionDetached = true;
      state.runStatus = "idle";
      resetRunView(state);
    },
    removeSession(state, action: PayloadAction<string>) {
      state.sessions = state.sessions.filter((entry) => entry.id !== action.payload);
      if (state.selectedSessionId !== action.payload) return;
      state.selectedSessionId = "";
      state.sessionDetached = true;
      state.runStatus = "idle";
      resetRunView(state);
    },
    setConnection(state, action: PayloadAction<ConnectionStatus>) {
      state.connection = action.payload;
      if (action.payload !== "connected" && isActive(state.runStatus)) state.runStatus = "unknown";
    },
    setActiveDock(state, action: PayloadAction<"files" | "sessions">) {
      state.activeDock = action.payload;
    },
    toggleFolder(state, action: PayloadAction<string>) {
      const folder = state.files.find((entry) => entry.id === action.payload && entry.kind === "folder");
      if (folder) folder.expanded = !folder.expanded;
    },
    selectFile(state, action: PayloadAction<string>) {
      state.selectedFileId = action.payload;
      state.selectedToolId = null;
      const file = state.files.find((entry) => entry.id === action.payload);
      state.inspector = file?.changed ? "diff" : "source";
    },
    setInspector(state, action: PayloadAction<InspectorKind>) {
      state.inspector = action.payload;
    },
    selectTool(state, action: PayloadAction<string>) {
      state.selectedToolId = action.payload;
      state.inspector = "tool";
    },
    toggleArtifact(state, action: PayloadAction<string>) {
      const index = state.artifactPaths.indexOf(action.payload);
      if (index >= 0) state.artifactPaths.splice(index, 1);
      else state.artifactPaths.push(action.payload);
    },
    setComposerMode(state, action: PayloadAction<ComposerMode>) {
      state.composerMode = action.payload;
    },
    setComposerDraft(state, action: PayloadAction<string>) {
      if (state.pendingRequestId && action.payload !== state.currentPrompt) state.pendingRequestId = null;
      state.composerDraft = action.payload;
    },
    beginRun(state, action: PayloadAction<{ text: string; requestId: string }>) {
      state.currentPrompt = action.payload.text;
      state.pendingRequestId = action.payload.requestId;
      state.assistantText = "";
      state.thinkingText = "";
      state.usage = null;
      state.activity = [];
      state.tools = [];
      state.currentRunId = null;
      state.runStatus = "submitting";
    },
    applyReceipt(state, action: PayloadAction<CommandReceipt>) {
      if (!action.payload.accepted) {
        if (state.runStatus === "submitting") state.runStatus = "idle";
        state.pendingRequestId = null;
        state.notice = action.payload.reason ?? "任务未被接受";
        return;
      }
      state.currentRunId = action.payload.runId ?? null;
      state.pendingRequestId = null;
      if (state.runStatus === "submitting" || state.runStatus === "idle") state.runStatus = "acknowledged";
      state.composerDraft = "";
    },
    commandFailed(state, action: PayloadAction<string>) {
      state.runStatus = "idle";
      state.notice = action.payload;
    },
    markInterrupting(state) {
      state.runStatus = "interrupting";
    },
    interruptFailed(state) {
      if (state.runStatus === "interrupting") state.runStatus = "running";
    },
    setEvents(state, action: PayloadAction<HarnessEvent[]>) {
      const merged = new Map(
        [...state.events, ...action.payload]
          .filter((event) => event.sessionId === state.selectedSessionId)
          .map((event) => [event.id, event])
      );
      const events = [...merged.values()].sort((left, right) => left.sequence - right.sequence);
      state.events = events;
      state.lastSequence = events.at(-1)?.sequence ?? 0;
      state.sequenceGap = findSequenceGap(events);
      state.currentRunId = [...events].reverse().find((event) => event.runId)?.runId ?? null;
      rebuildCurrentRunProjection(state);
    },
    receiveEvent(state, action: PayloadAction<HarnessEvent>) {
      applyEvent(state, action.payload);
    },
    showNotice(state, action: PayloadAction<string>) {
      state.notice = action.payload;
    },
    clearNotice(state) {
      state.notice = null;
    }
  }
});

export const harnessReducer = harnessSlice.reducer;

function applyEvent(state: HarnessState, event: HarnessEvent): void {
  if (event.sessionId !== state.selectedSessionId || state.events.some((entry) => entry.id === event.id)) return;
  const previousEvent = state.events.at(-1);
  state.events.push(event);
  state.events.sort((left, right) => left.sequence - right.sequence);
  state.lastSequence = Math.max(state.lastSequence, event.sequence);
  state.sequenceGap = findSequenceGap(state.events);
  const outOfOrder = previousEvent !== undefined && event.sequence <= previousEvent.sequence;
  const currentRunGeneration = Math.max(0, ...state.events.filter((entry) => entry.runId === (event.runId ?? state.currentRunId)).map((entry) => entry.runtimeGeneration));
  if (outOfOrder || event.runtimeGeneration < currentRunGeneration) {
    state.currentRunId = [...state.events].reverse().find((entry) => entry.runId)?.runId ?? null;
    rebuildCurrentRunProjection(state);
    return;
  }
  if (typeof event.runId === "string" && event.runId !== state.currentRunId) {
    const submittedPrompt = event.kind === "run.acknowledged" && event.payload.requestId === state.pendingRequestId
      ? state.currentPrompt
      : "";
    state.currentRunId = event.runId;
    state.runStatus = isRuntimeActivity(event.kind) ? "acknowledged" : "idle";
    resetRunProjection(state);
    if (submittedPrompt) state.currentPrompt = submittedPrompt;
  }
  applyEventView(state, event);
}

function rebuildCurrentRunProjection(state: HarnessState): void {
  resetRunProjection(state);
  state.runStatus = "idle";
  let newestGeneration = 0;
  for (const event of state.events) {
    if (event.runId !== state.currentRunId) continue;
    if (event.runtimeGeneration < newestGeneration) continue;
    newestGeneration = Math.max(newestGeneration, event.runtimeGeneration);
    applyEventView(state, event);
  }
  if (!state.currentRunId) {
    state.runStatus = state.sessions.find((entry) => entry.id === state.selectedSessionId)?.status ?? "idle";
  }
}

function applyEventView(state: HarnessState, event: HarnessEvent): void {
  if (["turn.started", "message.started", "message.delta", "thinking.delta", "tool.started", "tool.output"].includes(event.kind)
    && ["acknowledged", "unknown"].includes(state.runStatus)) {
    state.runStatus = "running";
  }
  switch (event.kind) {
    case "run.acknowledged": {
      state.runStatus = "acknowledged";
      if (state.pendingRequestId && event.payload.requestId === state.pendingRequestId) {
        state.pendingRequestId = null;
        state.composerDraft = "";
      }
      break;
    }
    case "run.started": state.runStatus = "running"; break;
    case "run.settling": state.runStatus = "settling"; break;
    case "run.settled": {
      state.runStatus = asRunStatus(event.payload.status);
      if (state.runStatus === "cancelled") {
        for (const tool of state.tools) if (tool.status === "running") tool.status = "cancelled";
      }
      break;
    }
    case "message.delta": {
      const delta = stringValue(event.payload.delta);
      state.assistantText += delta;
      break;
    }
    case "thinking.delta": state.thinkingText += stringValue(event.payload.delta); break;
    case "turn.started": {
      state.activity.push({
        id: `turn-${event.sequence}`,
        kind: "turn",
        label: "模型 Turn",
        detail: "DeepSeek 已开始本轮推理与工具决策",
        status: "running",
        sequence: event.sequence,
        startedAt: event.timestamp
      });
      break;
    }
    case "turn.completed": {
      const turn = [...state.activity].reverse().find((entry) => entry.kind === "turn" && entry.status === "running");
      if (turn) {
        turn.status = "completed";
        turn.detail = "本轮已完成，等待 Harness 收尾或进入下一轮";
        turn.endedAt = event.timestamp;
      }
      break;
    }
    case "message.completed": {
      const text = stringValue(event.payload.text);
      if (event.payload.role === "assistant" && text) state.assistantText = text;
      if (event.payload.role === "user" && text && isDisplayableUserPrompt(text)) state.currentPrompt = text;
      break;
    }
    case "tool.started": {
      const id = stringValue(event.payload.toolCallId);
      const name = stringValue(event.payload.toolName) || "tool";
      if (!state.tools.some((entry) => entry.id === id)) {
        state.tools.push({
          id,
          name: displayToolName(name),
          summary: toolSummary(name),
          detail: toolDetail(name, event.payload.args),
          status: "running",
          output: "",
          args: objectValue(event.payload.args),
          startedAt: event.timestamp
        });
      }
      break;
    }
    case "tool.output": {
      const tool = state.tools.find((entry) => entry.id === event.payload.toolCallId);
      if (tool) {
        const output = stringValue(event.payload.output);
        tool.output = event.updateMode === "delta" ? `${tool.output ?? ""}${output}` : output;
      }
      break;
    }
    case "tool.completed": {
      const tool = state.tools.find((entry) => entry.id === event.payload.toolCallId);
      if (tool) {
        tool.status = event.payload.cancelled === true ? "cancelled" : event.payload.isError === true ? "failed" : "completed";
        const output = stringValue(event.payload.output);
        if (output) tool.output = output;
        if (typeof event.payload.exitCode === "number" || event.payload.exitCode === null) tool.exitCode = event.payload.exitCode;
        const details = objectValue(event.payload.details);
        tool.truncated = details.truncated === true;
        if (typeof details.fullOutputId === "string") tool.fullOutputId = details.fullOutputId;
        if (typeof details.fullOutputSize === "number") tool.fullOutputSize = details.fullOutputSize;
        tool.endedAt = event.timestamp;
      }
      break;
    }
    case "queue.updated": {
      state.queuedSteering = numberValue(event.payload.steeringCount);
      state.queuedFollowUp = numberValue(event.payload.followUpCount);
      break;
    }
    case "workspace.changed": {
      const changedPaths = Array.isArray(event.payload.changes)
        ? event.payload.changes.flatMap((change) => {
          const path = objectValue(change).path;
          return typeof path === "string" ? [path] : [];
        })
        : [];
      if (event.runId === state.currentRunId && changedPaths.length > 0) {
        for (const tool of state.tools) tool.observedChangedPaths = [...changedPaths];
      }
      break;
    }
    case "usage.updated": state.usage = { ...event.payload }; break;
    case "retry.started": upsertActivity(state, event, "retry", "自动重试", "running"); break;
    case "retry.completed": upsertActivity(state, event, "retry", "自动重试", event.payload.success === true ? "completed" : "failed"); break;
    case "compaction.started": upsertActivity(state, event, "compaction", "上下文压缩", "running"); break;
    case "compaction.completed": upsertActivity(state, event, "compaction", "上下文压缩", event.payload.aborted === true || event.payload.errorMessage ? "failed" : "completed"); break;
    case "error": upsertActivity(state, event, "error", "运行错误", "failed"); break;
    case "raw": upsertActivity(state, event, "raw", "未识别事件", "unknown"); break;
  }
  const session = state.sessions.find((entry) => entry.id === state.selectedSessionId);
  if (session) session.status = state.runStatus;
}

function isDisplayableUserPrompt(text: string): boolean {
  const normalized = text.trimStart();
  return !normalized.startsWith("<system-reminder>")
    && !normalized.startsWith("Current runtime context.");
}

function resetRunView(state: HarnessState): void {
  state.currentRunId = null;
  state.pendingRequestId = null;
  resetRunProjection(state);
  state.events = [];
  state.lastSequence = 0;
  state.sequenceGap = null;
}

function resetWorkspaceContext(state: HarnessState): void {
  state.selectedSessionId = "";
  state.sessionDetached = false;
  state.sessions = [];
  state.files = [];
  state.selectedFileId = null;
  state.artifactPaths = [];
  state.runStatus = "idle";
  resetRunView(state);
}

function resetRunProjection(state: HarnessState): void {
  state.currentPrompt = "";
  state.assistantText = "";
  state.thinkingText = "";
  state.usage = null;
  state.activity = [];
  state.tools = [];
  state.selectedToolId = null;
  state.inspector = "process";
}

function findSequenceGap(events: HarnessEvent[]): { expected: number; received: number } | null {
  for (let index = 1; index < events.length; index += 1) {
    const previous = events[index - 1]!;
    const current = events[index]!;
    if (previous.runtimeGeneration === current.runtimeGeneration && current.sequence > previous.sequence + 1) {
      return { expected: previous.sequence + 1, received: current.sequence };
    }
  }
  return null;
}

function upsertActivity(
  state: HarnessState,
  event: HarnessEvent,
  kind: "retry" | "compaction" | "error" | "raw",
  label: string,
  status: "running" | "completed" | "failed" | "unknown"
): void {
  const correlation = kind === "retry" ? String(event.payload.attempt ?? "") : kind;
  const id = `${kind}-${correlation}`;
  const existing = state.activity.find((entry) => entry.id === id);
  const detail = stringValue(event.payload.errorMessage)
    || stringValue(event.payload.message)
    || stringValue(event.payload.reason)
    || (kind === "raw" ? stringValue(event.payload.type) : "来自真实运行时事件");
  if (existing) {
    existing.status = status;
    existing.detail = detail;
  } else {
    state.activity.push({ id, kind, label, detail, status, sequence: event.sequence });
  }
}

function toSessionSummary(input: BridgeSessionSummary) {
  return {
    id: input.id,
    title: input.name,
    description: `${input.modelId} · ${input.recoverable ? "可恢复" : "仅当前运行"}`,
    updatedAt: relativeTime(input.updatedAt),
    status: input.runStatus,
    recoverable: input.recoverable
  };
}

function normalizeChangeKind(status: string): "modified" | "added" | "deleted" | "renamed" {
  if (status === "added" || status === "untracked") return "added";
  if (status === "deleted") return "deleted";
  if (status === "renamed") return "renamed";
  return "modified";
}

function modelErrorMessage(code?: string): string {
  return {
    deepseek_auth_error: "DeepSeek 凭证验证失败。",
    deepseek_quota_error: "DeepSeek 账户额度不足。",
    deepseek_rate_limited: "DeepSeek 请求过于频繁，请稍后重试。",
    deepseek_unavailable: "暂时无法连接 DeepSeek。",
    deepseek_model_unavailable: "DeepSeek 当前未开放或无法识别所选模型。",
    model_not_found: "Pi 未找到所选 DeepSeek 模型。"
  }[code ?? ""] ?? "DeepSeek 连接检查失败。";
}

function languageFor(path: string): "javascript" | "typescript" | "json" | "markdown" | "text" {
  if (/\.[cm]?tsx?$/.test(path)) return "typescript";
  if (/\.[cm]?jsx?$/.test(path)) return "javascript";
  if (path.endsWith(".json")) return "json";
  if (/\.mdx?$/.test(path)) return "markdown";
  return "text";
}

function displayToolName(name: string): string {
  return { read: "Read", edit: "Edit", write: "Write", bash: "Bash" }[name] ?? name;
}

function toolSummary(name: string): string {
  return { read: "读取工作区文件", edit: "修改工作区文件", write: "写入工作区文件", bash: "运行命令与测试" }[name] ?? `执行 ${name}`;
}

function toolDetail(name: string, args: unknown): string {
  const record = objectValue(args);
  if (name === "bash") return stringValue(record.command) || "执行工作区命令";
  return stringValue(record.path) || stringValue(record.file_path) || stringValue(record.pattern) || "处理工作区内容";
}

function relativeTime(value: string): string {
  const elapsed = Date.now() - Date.parse(value);
  if (!Number.isFinite(elapsed) || elapsed < 60_000) return "刚刚";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} 分钟前`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} 小时前`;
  return new Date(value).toLocaleDateString("zh-CN");
}

function asRunStatus(value: unknown): RunStatus {
  const allowed: RunStatus[] = ["idle", "submitting", "acknowledged", "running", "settling", "interrupting", "completed", "failed", "cancelled", "unknown"];
  return typeof value === "string" && allowed.includes(value as RunStatus) ? value as RunStatus : "unknown";
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

function objectValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function isActive(status: RunStatus): boolean {
  return ["submitting", "acknowledged", "running", "settling", "interrupting"].includes(status);
}

function isRuntimeActivity(kind: string): boolean {
  return ["turn.started", "message.started", "message.delta", "thinking.delta", "tool.started", "tool.output"].includes(kind);
}

export const harnessActions = harnessSlice.actions;

export const store = configureStore({
  reducer: {
    harness: harnessSlice.reducer,
    [bridgeApi.reducerPath]: bridgeApi.reducer
  },
  middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(bridgeApi.middleware)
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
