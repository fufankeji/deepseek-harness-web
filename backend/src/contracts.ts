export type RuntimeStatus = "disconnected" | "probing" | "ready" | "incompatible" | "error";
export type ModelStatus = "unconfigured" | "probing" | "ready" | "auth_error" | "quota_error" | "rate_limited" | "unavailable" | "error";
export type ModelThinkingLevel = "high" | "max";
export type WorkspaceStatus = "unselected" | "probing" | "ready" | "unavailable" | "error";
export type RunStatus = "idle" | "submitting" | "acknowledged" | "running" | "settling" | "interrupting" | "completed" | "failed" | "cancelled" | "unknown";
export type CapabilityState = true | false | "unknown";

export interface CapabilitySet {
  structuredEvents: CapabilityState;
  resumableSessions: CapabilityState;
  sessionFork: CapabilityState;
  steering: CapabilityState;
  followUp: CapabilityState;
  interrupt: CapabilityState;
  tools: CapabilityState;
  compaction: CapabilityState;
  retry: CapabilityState;
  approvals: CapabilityState;
  sandbox: CapabilityState;
}

export interface CapabilityDecision {
  runtimeCapability: CapabilityState;
  productAvailability: boolean;
  userPermission: CapabilityState;
}

export type CapabilityDecisionSet = { [Key in keyof CapabilitySet]: CapabilityDecision };

export interface RuntimeInfo {
  adapterId: string;
  adapterVersion: string;
  harnessId: string;
  harnessVersion: string;
  displayName: string;
  bridgeVersion: string;
  nodeVersion: string;
  status: RuntimeStatus;
  capabilities: CapabilitySet;
  checkedAt: string;
}

export interface ModelInfo {
  provider: "deepseek";
  modelId: string;
  thinkingLevel: ModelThinkingLevel;
  availableThinkingLevels: ModelThinkingLevel[];
  status: ModelStatus;
  credentialStorage: "memory-only" | "ephemeral-runtime";
  checkedAt?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface WorkspaceInfo {
  id: string;
  name: string;
  status: WorkspaceStatus;
  displayPath: string;
  branch: string | null;
  git: boolean;
  projectTrusted: boolean;
  fileCount: number;
  fileScanLimited: boolean;
  checkedAt: string;
}

export interface SessionSummary {
  id: string;
  name: string;
  updatedAt: string;
  modelId: string;
  runStatus: RunStatus;
  recoverable: boolean;
}

export type HarnessEventKind =
  | "run.acknowledged"
  | "run.started"
  | "run.settling"
  | "run.settled"
  | "turn.started"
  | "turn.completed"
  | "message.started"
  | "message.delta"
  | "message.completed"
  | "thinking.delta"
  | "tool.started"
  | "tool.output"
  | "tool.completed"
  | "queue.updated"
  | "usage.updated"
  | "workspace.changed"
  | "retry.started"
  | "retry.completed"
  | "compaction.started"
  | "compaction.completed"
  | "raw"
  | "error";

export interface HarnessEvent {
  id: string;
  sequence: number;
  sessionId: string;
  runId?: string;
  runtimeGeneration: number;
  kind: HarnessEventKind;
  source: "bridge" | "harness" | "model" | "workspace";
  timestamp: string;
  updateMode?: "delta" | "snapshot" | "final";
  payload: Record<string, unknown>;
  raw?: Record<string, unknown>;
}

export interface CommandReceipt {
  requestId: string;
  accepted: boolean;
  sessionId?: string;
  runId?: string;
  reason?: string;
}

export type HarnessCommandSource = "product" | "harness" | "skill" | "prompt" | "extension";
export type HarnessCommandInputKind = "none" | "text" | "select" | "file";

export interface HarnessCommandOption {
  value: string;
  label: string;
  description?: string;
}

export interface HarnessCommand {
  id: string;
  name: string;
  description: string;
  source: HarnessCommandSource;
  input: HarnessCommandInputKind;
  argumentRequired: boolean;
  argumentHint?: string;
  options?: HarnessCommandOption[];
  available: boolean;
  unavailableReason?: string;
  startsRun: boolean;
}

export interface ExecuteHarnessCommandInput {
  requestId: string;
  commandId: string;
  argument?: string;
  file?: {
    name: string;
    content: string;
  };
}

export type CommandEffect =
  | { type: "session"; session: SessionSummary }
  | { type: "details"; title: string; data: Record<string, unknown> }
  | { type: "clipboard"; text: string }
  | { type: "download"; url: string; fileName: string }
  | { type: "navigate"; path: string };

export interface CommandExecutionResult extends CommandReceipt {
  commandId: string;
  effect?: CommandEffect;
}

export interface ChangedFile {
  path: string;
  previousPath?: string;
  status: "added" | "modified" | "deleted" | "renamed" | "untracked";
  staged: boolean;
  unstaged: boolean;
}

export interface FileEntry {
  path: string;
  name: string;
  kind: "file" | "directory" | "symlink";
  depth: number;
  size?: number;
}

export interface WorkspaceSnapshot {
  workspace: WorkspaceInfo;
  files: FileEntry[];
  changes: ChangedFile[];
  changeScope: "run" | "git" | "workspace" | "unavailable";
  comparisonRunId?: string;
}

export interface AcceptanceRecord {
  id: string;
  createdAt: string;
  adapterId: string;
  adapterVersion: string;
  harnessId: string;
  harnessVersion: string;
  modelId: string;
  workspaceTemplateVersion: string;
  workspaceId: string;
  workspaceDisplayPath: string;
  sessionId: string;
  runId: string;
  finalStatus: RunStatus;
  expectedFinalStatus: RunStatus;
  passed: boolean;
  features: string[];
  eventCount: number;
  eventKinds: string[];
  eventSequence: { first: number; last: number };
  toolNames: string[];
  changedFiles: string[];
  verification: {
    command: string | null;
    exitCode: number | null;
    passed: boolean;
    output: string;
  };
  evidenceSource: "real-runtime";
}
