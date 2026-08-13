import type {
  CapabilitySet,
  CommandExecutionResult,
  CommandReceipt,
  ExecuteHarnessCommandInput,
  HarnessCommand,
  ModelInfo,
  RuntimeInfo,
  SessionSummary
} from "../contracts.js";

export interface SubmitTaskInput {
  requestId: string;
  text: string;
}

export interface HarnessAdapter {
  readonly id: string;
  readonly activeSessionId: string | null;
  probe(): Promise<RuntimeInfo>;
  getCapabilities(): CapabilitySet;
  getModelInfo(): ModelInfo;
  connectModel(modelId?: string, verify?: boolean, thinkingLevel?: "high" | "max"): Promise<ModelInfo>;
  disconnectModel(): Promise<ModelInfo>;
  assertIdle(): void;
  createSession(name?: string): Promise<SessionSummary>;
  listSessions(): Promise<SessionSummary[]>;
  openSession(sessionId: string): Promise<SessionSummary>;
  closeSession(sessionId: string): Promise<SessionSummary>;
  deleteSession(sessionId: string): Promise<{ deletedSessionId: string }>;
  assertCurrentSession(sessionId: string): void;
  renameSession(name: string): SessionSummary | Promise<SessionSummary>;
  listForkPoints(): Array<{ entryId: string; text: string }>;
  forkSession(entryId: string): Promise<SessionSummary>;
  listCommands(): Promise<HarnessCommand[]>;
  executeCommand(input: ExecuteHarnessCommandInput): Promise<CommandExecutionResult>;
  submitTask(input: SubmitTaskInput): Promise<CommandReceipt>;
  steer(requestId: string, text: string): Promise<CommandReceipt>;
  followUp(requestId: string, text: string): Promise<CommandReceipt>;
  interrupt(requestId: string): Promise<CommandReceipt>;
  notifyWorkspaceChanged(): Promise<void>;
  dispose(): Promise<void>;
}
