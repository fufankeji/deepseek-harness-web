import type { RunStatus } from "../contracts/view-model";

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
  status: "disconnected" | "probing" | "ready" | "incompatible" | "error";
  capabilities: CapabilitySet;
  checkedAt: string;
}

export interface ModelInfo {
  provider: "deepseek";
  modelId: string;
  thinkingLevel: "high" | "max";
  availableThinkingLevels: Array<"high" | "max">;
  status: "unconfigured" | "probing" | "ready" | "auth_error" | "quota_error" | "rate_limited" | "unavailable" | "error";
  credentialStorage: "memory-only" | "ephemeral-runtime";
  checkedAt?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface WorkspaceInfo {
  id: string;
  name: string;
  status: "unselected" | "probing" | "ready" | "unavailable" | "error";
  displayPath: string;
  branch: string | null;
  git: boolean;
  projectTrusted: boolean;
  fileCount: number;
  fileScanLimited: boolean;
  checkedAt: string;
}

export interface WorkspaceFile {
  path: string;
  name: string;
  kind: "file" | "directory" | "symlink";
  depth: number;
  size?: number;
}

export interface ChangedFile {
  path: string;
  previousPath?: string;
  status: "added" | "modified" | "deleted" | "renamed" | "untracked";
  staged: boolean;
  unstaged: boolean;
}

export interface WorkspaceSnapshot {
  workspace: WorkspaceInfo;
  files: WorkspaceFile[];
  changes: ChangedFile[];
  changeScope: "run" | "git" | "workspace" | "unavailable";
  comparisonRunId?: string;
}

export type WorkspacePickerResult =
  | { cancelled: true }
  | { cancelled: false; selectedPath: string; workspace: WorkspaceInfo };

export interface BridgeSessionSummary {
  id: string;
  name: string;
  updatedAt: string;
  modelId: string;
  runStatus: RunStatus;
  recoverable: boolean;
}

export interface HarnessEvent {
  id: string;
  sequence: number;
  sessionId: string;
  runId?: string;
  runtimeGeneration: number;
  kind: string;
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

export type CommandEffect =
  | { type: "session"; session: BridgeSessionSummary }
  | { type: "details"; title: string; data: Record<string, unknown> }
  | { type: "clipboard"; text: string }
  | { type: "download"; url: string; fileName: string }
  | { type: "navigate"; path: string };

export interface CommandExecutionResult extends CommandReceipt {
  commandId: string;
  effect?: CommandEffect;
}

export interface ExecuteHarnessCommandInput {
  requestId: string;
  commandId: string;
  argument?: string;
  file?: { name: string; content: string };
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

export interface DiagnosticSnapshot {
  browser: Record<string, unknown>;
  bridge: Record<string, unknown>;
  adapter: RuntimeInfo;
  capabilityDecisions: CapabilityDecisionSet;
  model: ModelInfo;
  workspace: WorkspaceInfo | { status: "unselected" };
  git: Record<string, unknown>;
}

export interface FileView {
  path: string;
  current: string;
  baseline: string;
  diff: string;
  baselineSource: "run" | "git" | "workspace" | "unavailable";
  baselineAvailable: boolean;
  comparisonRunId?: string;
}

export interface FilePreview {
  path: string;
  kind: "text" | "image" | "html" | "unsupported";
  mime: string;
  size: number;
  content?: string;
  dataUrl?: string;
  reason?: string;
}

export interface ForkPoint {
  entryId: string;
  text: string;
}
