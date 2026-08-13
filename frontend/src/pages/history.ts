import type { HarnessEvent } from "../api/contracts";
import type { RunStatus } from "../contracts/view-model";

export interface HistoricalRun {
  id: string;
  prompt: string;
  assistant: string;
  status: RunStatus;
  toolCount: number;
  firstSequence: number;
  lastSequence: number;
}

export function summarizeHistoricalRuns(events: HarnessEvent[], currentRunId: string | null): HistoricalRun[] {
  const groups = new Map<string, HarnessEvent[]>();
  for (const event of events) {
    if (!event.runId || event.runId === currentRunId) continue;
    const group = groups.get(event.runId) ?? [];
    group.push(event);
    groups.set(event.runId, group);
  }
  return [...groups.entries()].map(([id, group]) => {
    const ordered = [...group].sort((left, right) => left.sequence - right.sequence);
    const latestUser = [...ordered].reverse().find((event) => event.kind === "message.completed"
      && event.payload.role === "user"
      && isDisplayableUserPrompt(event.payload.text));
    const latestAssistant = [...ordered].reverse().find((event) => event.kind === "message.completed" && event.payload.role === "assistant");
    const settled = [...ordered].reverse().find((event) => event.kind === "run.settled");
    const status = settled && isRunStatus(settled.payload.status) ? settled.payload.status : "unknown";
    return {
      id,
      prompt: compactHistoryText(latestUser?.payload.text, "已恢复的历史任务"),
      assistant: compactHistoryText(latestAssistant?.payload.text, ""),
      status,
      toolCount: new Set(ordered.filter((event) => event.kind === "tool.started").map((event) => event.payload.toolCallId)).size,
      firstSequence: ordered[0]?.sequence ?? 0,
      lastSequence: ordered.at(-1)?.sequence ?? 0
    };
  }).filter((run) => run.prompt !== "已恢复的历史任务")
    .sort((left, right) => left.firstSequence - right.firstSequence)
    .slice(-6);
}

function isRunStatus(value: unknown): value is RunStatus {
  return typeof value === "string" && ["idle", "submitting", "acknowledged", "running", "settling", "interrupting", "completed", "failed", "cancelled", "unknown"].includes(value);
}

function compactHistoryText(value: unknown, fallback: string): string {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 180 ? `${normalized.slice(0, 177)}…` : normalized;
}

function isDisplayableUserPrompt(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.trimStart();
  return !normalized.startsWith("<system-reminder>")
    && !normalized.startsWith("Current runtime context.");
}
