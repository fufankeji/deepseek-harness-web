import type {
  CapabilityDecisionSet,
  HarnessEvent,
  ModelInfo,
  RuntimeInfo,
  WorkspaceInfo
} from "../api/contracts";

export type SetupStep = "environment" | "model" | "workspace" | "trust";
export type SetupStatus = "idle" | "checking" | "complete" | "error";
export type RuntimeChoice = "pi-deepseek" | "deepseek-harness";

export type RunStatus =
  | "idle"
  | "submitting"
  | "acknowledged"
  | "running"
  | "settling"
  | "interrupting"
  | "completed"
  | "failed"
  | "cancelled"
  | "unknown";

export type ConnectionStatus = "connected" | "reconnecting" | "disconnected" | "error";
export type InspectorKind = "process" | "source" | "diff" | "tool" | "artifact" | "raw_event" | "diagnostic";
export type ComposerMode = "prompt" | "steer" | "follow_up";

export interface SetupState {
  currentStep: SetupStep;
  runtimeChoice: RuntimeChoice;
  environment: SetupStatus;
  model: SetupStatus;
  workspace: SetupStatus;
  trust: "undecided" | "restricted" | "trusted";
  modelId: string;
  thinkingLevel: "high" | "max";
  errorMessage: string | null;
}

export interface FileNode {
  id: string;
  name: string;
  path: string;
  kind: "folder" | "file";
  depth: number;
  expanded?: boolean;
  changed?: boolean;
  changeKind?: "modified" | "added" | "deleted" | "renamed";
  staged?: boolean;
  unstaged?: boolean;
  previousPath?: string;
  language?: "javascript" | "typescript" | "json" | "markdown" | "text";
}

export interface SessionSummary {
  id: string;
  title: string;
  description: string;
  updatedAt: string;
  status: RunStatus;
  recoverable: boolean;
}

export interface ToolStep {
  id: string;
  name: string;
  summary: string;
  detail: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  output?: string;
  args?: Record<string, unknown>;
  exitCode?: number | null;
  truncated?: boolean;
  fullOutputId?: string;
  fullOutputSize?: number;
  observedChangedPaths?: string[];
  startedAt?: string;
  endedAt?: string;
}

export interface DiagnosticItem {
  id: string;
  layer: "Browser" | "Bridge" | "Adapter" | "Harness" | "DeepSeek" | "Git";
  label: string;
  status: "ready" | "warning" | "error" | "unknown";
  detail: string;
}

export interface HarnessState {
  setup: SetupState;
  runtime: RuntimeInfo | null;
  capabilityDecisions: CapabilityDecisionSet | null;
  model: ModelInfo | null;
  workspace: WorkspaceInfo | null;
  connection: ConnectionStatus;
  runStatus: RunStatus;
  currentRunId: string | null;
  pendingRequestId: string | null;
  currentPrompt: string;
  assistantText: string;
  thinkingText: string;
  usage: Record<string, unknown> | null;
  activity: Array<{ id: string; kind: "turn" | "retry" | "compaction" | "error" | "raw"; label: string; detail: string; status: "running" | "completed" | "failed" | "unknown"; sequence: number; startedAt?: string; endedAt?: string }>;
  activeDock: "files" | "sessions";
  selectedFileId: string | null;
  selectedSessionId: string;
  sessionDetached: boolean;
  inspector: InspectorKind;
  selectedToolId: string | null;
  artifactPaths: string[];
  composerMode: ComposerMode;
  composerDraft: string;
  queuedSteering: number;
  queuedFollowUp: number;
  sequenceGap: { expected: number; received: number } | null;
  files: FileNode[];
  sessions: SessionSummary[];
  tools: ToolStep[];
  events: HarnessEvent[];
  lastSequence: number;
  notice: string | null;
}
