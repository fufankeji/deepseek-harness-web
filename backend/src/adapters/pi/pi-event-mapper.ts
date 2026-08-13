import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { HarnessEvent, RunStatus } from "../../contracts.js";

export type MappedHarnessEvent = Omit<HarnessEvent, "id" | "sequence" | "sessionId" | "runId" | "runtimeGeneration" | "timestamp">;

export function mapPiEvent(event: AgentSessionEvent, settledStatus?: RunStatus): MappedHarnessEvent[] {
  switch (event.type) {
    case "agent_start":
      return [mapped("run.started", "harness", { status: "running" })];
    case "agent_end":
      return [mapped("run.settling", "harness", { status: "settling", willRetry: event.willRetry })];
    case "agent_settled":
      return [mapped("run.settled", "harness", { status: settledStatus ?? "unknown" }, "final")];
    case "turn_start":
      return [mapped("turn.started", "harness", {})];
    case "turn_end":
      return [mapped("turn.completed", "harness", {
        role: messageRole(event.message),
        stopReason: assistantStopReason(event.message),
        toolResultCount: event.toolResults.length
      }, "final")];
    case "message_start":
      return [mapped("message.started", messageSource(event.message), {
        role: messageRole(event.message)
      })];
    case "message_update":
      return mapMessageUpdate(event.assistantMessageEvent);
    case "message_end": {
      const events = [mapped("message.completed", messageSource(event.message), messagePayload(event.message), "final")];
      const usage = messageUsage(event.message);
      if (usage) events.push(mapped("usage.updated", "model", usage, "snapshot"));
      if (assistantStopReason(event.message) === "error") {
        events.push(mapped("error", "model", {
          code: "model_turn_failed",
          message: assistantError(event.message) ?? "模型执行失败。",
          retryable: true
        }, "final"));
      }
      return events;
    }
    case "tool_execution_start":
      return [mapped("tool.started", "harness", {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: sanitizeValue(event.args)
      })];
    case "tool_execution_update":
      return [mapped("tool.output", "harness", {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        output: extractToolText(event.partialResult),
        details: safeToolDetails(asRecord(event.partialResult).details)
      }, "snapshot")];
    case "tool_execution_end":
      return [mapped("tool.completed", "harness", {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        output: extractToolText(event.result),
        details: safeToolDetails(asRecord(event.result).details),
        isError: event.isError,
        ...(event.toolName === "bash" ? bashCompletion(event) : {})
      }, "final")];
    case "queue_update":
      return [mapped("queue.updated", "harness", {
        steeringCount: event.steering.length,
        followUpCount: event.followUp.length
      }, "snapshot")];
    case "compaction_start":
      return [mapped("compaction.started", "harness", { reason: event.reason })];
    case "compaction_end":
      return [mapped("compaction.completed", "harness", {
        reason: event.reason,
        aborted: event.aborted,
        willRetry: event.willRetry,
        errorMessage: event.errorMessage,
        result: sanitizeValue(event.result)
      }, "final")];
    case "auto_retry_start":
      return [mapped("retry.started", "harness", {
        attempt: event.attempt,
        maxAttempts: event.maxAttempts,
        delayMs: event.delayMs,
        errorMessage: event.errorMessage
      })];
    case "auto_retry_end":
      return [mapped("retry.completed", "harness", {
        success: event.success,
        attempt: event.attempt,
        finalError: event.finalError
      }, "final")];
    case "bash_execution_update":
      return [mapped("tool.output", "harness", {
        toolCallId: event.id ?? "direct-bash",
        toolName: "bash",
        output: redactText(event.delta)
      }, "delta")];
    case "summarization_retry_scheduled":
    case "summarization_retry_attempt_start":
    case "summarization_retry_finished":
    case "entry_appended":
    case "session_info_changed":
    case "thinking_level_changed":
      return [mapped("raw", "harness", { type: event.type }, undefined, sanitizeRawRecord(event))];
    default:
      return [mapped("raw", "harness", { type: "unknown" }, undefined, sanitizeRawRecord(event))];
  }
}

function mapMessageUpdate(update: AgentSessionEvent & never): MappedHarnessEvent[];
function mapMessageUpdate(update: Extract<AgentSessionEvent, { type: "message_update" }>["assistantMessageEvent"]): MappedHarnessEvent[];
function mapMessageUpdate(update: Extract<AgentSessionEvent, { type: "message_update" }>["assistantMessageEvent"]): MappedHarnessEvent[] {
  if (update.type === "text_delta") {
    return [mapped("message.delta", "model", {
      contentIndex: update.contentIndex,
      delta: redactText(update.delta)
    }, "delta")];
  }
  if (update.type === "thinking_delta") {
    return [mapped("thinking.delta", "model", {
      contentIndex: update.contentIndex,
      delta: redactText(update.delta)
    }, "delta")];
  }
  return [mapped("raw", "model", { type: `message_update.${update.type}` }, undefined, sanitizeRawRecord(update))];
}

function mapped(
  kind: HarnessEvent["kind"],
  source: HarnessEvent["source"],
  payload: Record<string, unknown>,
  updateMode?: HarnessEvent["updateMode"],
  raw?: Record<string, unknown>
): MappedHarnessEvent {
  return {
    kind,
    source,
    ...(updateMode ? { updateMode } : {}),
    payload: removeUndefined(payload),
    ...(raw ? { raw } : {})
  };
}

function messagePayload(message: unknown): Record<string, unknown> {
  const record = asRecord(message);
  return removeUndefined({
    role: typeof record.role === "string" ? record.role : "unknown",
    text: extractContent(record.content, "text"),
    thinking: extractContent(record.content, "thinking"),
    stopReason: typeof record.stopReason === "string" ? record.stopReason : undefined,
    errorMessage: typeof record.errorMessage === "string" ? redactText(record.errorMessage) : undefined,
    provider: typeof record.provider === "string" ? record.provider : undefined,
    model: typeof record.model === "string" ? record.model : undefined
  });
}

function messageUsage(message: unknown): Record<string, unknown> | undefined {
  const usage = asRecord(asRecord(message).usage);
  if (Object.keys(usage).length === 0) return undefined;
  const sanitized = sanitizeRecord(usage);
  return "cost" in sanitized ? { ...sanitized, costSource: "pi-model-config-estimate" } : sanitized;
}

function extractContent(value: unknown, type: "text" | "thinking"): string {
  if (typeof value === "string") return type === "text" ? redactText(value) : "";
  if (!Array.isArray(value)) return "";
  return value.flatMap((entry) => {
    const block = asRecord(entry);
    if (block.type !== type) return [];
    const content = type === "text" ? block.text : block.thinking;
    return typeof content === "string" ? [redactText(content)] : [];
  }).join("");
}

function extractToolText(result: unknown): string {
  const content = asRecord(result).content;
  if (!Array.isArray(content)) return "";
  return content.flatMap((entry) => {
    const block = asRecord(entry);
    return block.type === "text" && typeof block.text === "string" ? [redactText(block.text)] : [];
  }).join("\n");
}

function assistantStopReason(message: unknown): string | undefined {
  const value = asRecord(message).stopReason;
  return typeof value === "string" ? value : undefined;
}

function assistantError(message: unknown): string | undefined {
  const value = asRecord(message).errorMessage;
  return typeof value === "string" ? redactText(value) : undefined;
}

function messageRole(message: unknown): string {
  const role = asRecord(message).role;
  return typeof role === "string" ? role : "unknown";
}

function messageSource(message: unknown): HarnessEvent["source"] {
  return messageRole(message) === "assistant" ? "model" : "harness";
}

function sanitizeRecord(value: unknown): Record<string, unknown> {
  return asRecord(sanitizeValue(value));
}

function sanitizeRawRecord(value: unknown): Record<string, unknown> {
  const input = asRecord(value);
  const safeKeys = new Set([
    "type", "id", "contentIndex", "reason", "attempt", "maxAttempts", "delayMs",
    "success", "aborted", "willRetry", "toolCallId", "toolName", "isError", "level",
    "source", "stopReason", "provider", "model", "responseId", "timestamp"
  ]);
  return Object.fromEntries(
    Object.entries(input)
      .filter(([key]) => safeKeys.has(key))
      .map(([key, entry]) => [key, sanitizeValue(entry, key, 1)])
  );
}

function sanitizeValue(value: unknown, key = "", depth = 0): unknown {
  if (isSensitiveKey(key)) return "[REDACTED]";
  if (depth > 5) return "[TRUNCATED]";
  if (typeof value === "string") return redactText(value);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((entry) => sanitizeValue(entry, key, depth + 1));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).slice(0, 100).map(([entryKey, entryValue]) => [
      entryKey,
      sanitizeValue(entryValue, entryKey, depth + 1)
    ]));
  }
  return undefined;
}

function isSensitiveKey(key: string): boolean {
  return /api.?key|authorization|credential|secret|access.?token|refresh.?token|bearer/i.test(key) || key.toLowerCase() === "token";
}

function safeToolDetails(value: unknown): Record<string, unknown> {
  const details = asRecord(value);
  const truncation = asRecord(details.truncation);
  return removeUndefined({
    truncated: Object.keys(truncation).length > 0,
    truncatedBy: typeof truncation.truncatedBy === "string" ? truncation.truncatedBy : undefined,
    outputLines: typeof truncation.outputLines === "number" ? truncation.outputLines : undefined,
    totalLines: typeof truncation.totalLines === "number" ? truncation.totalLines : undefined
  });
}

function bashCompletion(event: Extract<AgentSessionEvent, { type: "tool_execution_end" }>): Record<string, unknown> {
  const output = extractToolText(event.result);
  if (!event.isError) return { exitCode: 0, cancelled: false };
  const exitCode = output.match(/Command exited with code (\d+)/)?.[1];
  return {
    exitCode: exitCode ? Number.parseInt(exitCode, 10) : null,
    cancelled: /Command aborted/i.test(output)
  };
}

function redactText(value: string): string {
  return value
    .slice(0, 100_000)
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
    .replace(/(authorization\s*[:=]\s*)([^\s,;]+)/gi, "$1[REDACTED]")
    .replace(/(Full output:\s*)[^\]\n]+/gi, "$1[managed by Bridge]");
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function removeUndefined(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}
