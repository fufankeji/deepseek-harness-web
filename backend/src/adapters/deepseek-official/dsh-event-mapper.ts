import type { HarnessEvent, RunStatus } from "../../contracts.js";
import type { DshSessionEvent } from "./dsh-web-runtime.js";

export type MappedDshEvent = Omit<HarnessEvent, "id" | "sequence" | "sessionId" | "runId" | "runtimeGeneration" | "timestamp">;

export function mapDshEvent(event: DshSessionEvent): MappedDshEvent[] {
  const data = asRecord(event.data);
  switch (event.type) {
    case "turn/start":
      return [mapped("run.started", "harness", { status: "running" }), mapped("turn.started", "harness", { turn: data.turn })];
    case "turn/end": {
      const reason = asRecord(data.reason);
      return [mapped("turn.completed", "harness", { turn: data.turn, stopReason: reason.kind ?? "unknown" }, "final")];
    }
    case "user/message":
      return [mapped("message.completed", "harness", { role: "user", text: contentText(data.content, "text"), thinking: "" }, "final")];
    case "assistant/chunk":
      return mapChunk(asRecord(data.chunk));
    case "assistant/message": {
      const message = asRecord(data.message);
      const result = [mapped("message.completed", "model", {
        role: "assistant",
        text: contentText(message.content, "text"),
        thinking: contentText(message.content, "thinking"),
        provider: asRecord(message.source).provider,
        model: asRecord(message.source).model
      }, "final")];
      const usage = asRecord(data.usage);
      if (Object.keys(usage).length > 0) result.push(mapped("usage.updated", "model", sanitizeRecord(usage), "snapshot"));
      return result;
    }
    case "tool/call":
      return [mapped("tool.started", "harness", {
        toolCallId: stringValue(data.callId),
        toolName: stringValue(data.name) || "tool",
        args: parseArguments(data.arguments)
      })];
    case "tool/result": {
      const message = asRecord(data.message);
      const result = firstToolResult(message.content);
      return [mapped("tool.completed", "harness", {
        toolCallId: stringValue(asRecord(message.source).callId),
        toolName: toolNameFromMeta(data.meta),
        output: contentText(result.content, "text"),
        details: safeToolDetails(data.meta),
        isError: result.isError === true || Object.keys(asRecord(data.error)).length > 0,
        ...bashCompletion(data, result)
      }, "final")];
    }
    case "llm/retry":
      return [mapped("retry.started", "harness", sanitizeRecord(data))];
    case "compaction/start":
    case "compaction/started":
      return [mapped("compaction.started", "harness", sanitizeRecord(data))];
    case "compaction/end":
    case "compaction/completed":
      return [mapped("compaction.completed", "harness", sanitizeRecord(data), "final")];
    case "command/run":
    case "command/done":
    case "goal/change":
    case "todo/write":
    case "approval/asked":
    case "approval/decided":
    case "approval/policy":
    case "step/start":
    case "step/end":
      return [mapped("raw", "harness", { type: event.type }, undefined, sanitizeRaw(event))];
    case "request/header":
      return [mapped("raw", "harness", { type: event.type }, undefined, {
        type: event.type,
        seq: event.seq,
        time: event.time,
        data: {
          reason: typeof data.reason === "string" ? redactText(data.reason) : undefined,
          headerBlockCount: Array.isArray(data.header) ? data.header.length : undefined
        }
      })];
    case "request/context":
      return [mapped("raw", "harness", { type: event.type }, undefined, sanitizeRaw(event))];
    default:
      return [mapped("raw", "harness", { type: event.type || "unknown" }, undefined, sanitizeRaw(event))];
  }
}

export function dshTurnStatus(event: DshSessionEvent): RunStatus | undefined {
  if (event.type !== "turn/end") return undefined;
  const reason = asRecord(asRecord(event.data).reason);
  if (reason.kind === "completed" || reason.kind === "max-tokens") return "completed";
  if (reason.kind === "aborted" || reason.kind === "cancelled") return "cancelled";
  return "failed";
}

function mapChunk(chunk: Record<string, unknown>): MappedDshEvent[] {
  if (chunk.type === "text-delta") return [mapped("message.delta", "model", { contentIndex: chunk.index, delta: redactText(stringValue(chunk.text)) }, "delta")];
  if (chunk.type === "reasoning-delta" || chunk.type === "thinking-delta") {
    return [mapped("thinking.delta", "model", { contentIndex: chunk.index, delta: redactText(stringValue(chunk.text ?? chunk.thinking)) }, "delta")];
  }
  if (chunk.type === "usage") return [mapped("usage.updated", "model", sanitizeRecord(chunk.usage), "snapshot")];
  // These are official, fully understood stream-construction fragments. The
  // durable tool/call, tool/result and assistant/message events that follow
  // carry their complete product facts, so persisting every token fragment as
  // raw would only flood the timeline and diagnostics.
  if (chunk.type === "block-start" || chunk.type === "block-end" || chunk.type === "tool-call-delta") return [];
  return [mapped("raw", "model", { type: `assistant/chunk.${stringValue(chunk.type) || "unknown"}` }, undefined, sanitizeRecord(chunk))];
}

function mapped(kind: HarnessEvent["kind"], source: HarnessEvent["source"], payload: Record<string, unknown>, updateMode?: HarnessEvent["updateMode"], raw?: Record<string, unknown>): MappedDshEvent {
  return { kind, source, ...(updateMode ? { updateMode } : {}), payload: removeUndefined(payload), ...(raw ? { raw } : {}) };
}

function firstToolResult(value: unknown): Record<string, unknown> {
  if (!Array.isArray(value)) return {};
  return asRecord(value.find((entry) => asRecord(entry).type === "tool-result") ?? value[0]);
}

function toolNameFromMeta(value: unknown): string | undefined {
  const record = asRecord(value);
  return typeof record.toolName === "string" ? record.toolName : undefined;
}

function safeToolDetails(value: unknown): Record<string, unknown> {
  const record = asRecord(value);
  const diffs = Array.isArray(record.diffs) ? record.diffs.slice(0, 100).map((entry) => sanitizeValue(entry)) : undefined;
  return removeUndefined({ ...(diffs ? { diffs } : {}), card: typeof record.card === "string" ? record.card : undefined });
}

function bashCompletion(data: Record<string, unknown>, result: Record<string, unknown>): Record<string, unknown> {
  const meta = asRecord(data.meta);
  const exitCode = typeof meta.exitCode === "number" ? meta.exitCode : undefined;
  const cancelled = meta.cancelled === true;
  return removeUndefined({ ...(exitCode !== undefined ? { exitCode } : {}), ...(cancelled ? { cancelled: true } : {}), ...(result.isError !== undefined ? {} : {}) });
}

function parseArguments(value: unknown): unknown {
  if (typeof value !== "string") return sanitizeValue(value);
  try {
    return sanitizeValue(JSON.parse(value));
  } catch {
    return { raw: redactText(value) };
  }
}

function contentText(value: unknown, type: "text" | "thinking"): string {
  if (!Array.isArray(value)) return "";
  return value.flatMap((entry) => {
    const block = asRecord(entry);
    if (block.type !== type && !(type === "thinking" && block.type === "reasoning")) return [];
    const text = block.text ?? block.thinking;
    return typeof text === "string" ? [redactText(text)] : [];
  }).join("");
}

function sanitizeRaw(event: DshSessionEvent): Record<string, unknown> {
  return { type: event.type, seq: event.seq, time: event.time, data: safeRawMetadata(event.data) };
}

const SAFE_RAW_SCALARS = new Set([
  "id", "commandId", "callId", "approvalId", "turn", "step", "seq", "sourceEventSeq",
  "status", "state", "kind", "mode", "policy", "preset", "provider", "model",
  "contextWindow", "target", "start", "removedCount", "name", "code"
]);

function safeRawMetadata(value: unknown): Record<string, unknown> {
  const record = asRecord(value);
  const result: Record<string, unknown> = { dataKeys: Object.keys(record).slice(0, 100) };
  for (const [key, entry] of Object.entries(record).slice(0, 100)) {
    if (/api.?key|authorization|credential|secret|access.?token|refresh.?token|bearer/i.test(key) || key.toLowerCase() === "token") {
      result[key] = "[REDACTED]";
      continue;
    }
    if (SAFE_RAW_SCALARS.has(key) && (typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean" || entry === null)) {
      result[key] = sanitizeValue(entry, key);
      continue;
    }
    if ((key === "reason" || key === "source") && typeof entry === "object" && entry !== null) {
      result[key] = Object.fromEntries(Object.entries(asRecord(entry)).filter(([nestedKey, nested]) => SAFE_RAW_SCALARS.has(nestedKey) && (typeof nested === "string" || typeof nested === "number" || typeof nested === "boolean" || nested === null)).map(([nestedKey, nested]) => [nestedKey, sanitizeValue(nested, nestedKey)]));
      continue;
    }
    if (Array.isArray(entry)) result[`${key}Count`] = entry.length;
  }
  return result;
}

function sanitizeRecord(value: unknown): Record<string, unknown> {
  const sanitized = sanitizeValue(value);
  return asRecord(sanitized);
}

function sanitizeValue(value: unknown, key = "", depth = 0): unknown {
  if (/api.?key|authorization|credential|secret|access.?token|refresh.?token|bearer/i.test(key) || key.toLowerCase() === "token") return "[REDACTED]";
  if (depth > 5) return "[TRUNCATED]";
  if (typeof value === "string") return redactText(value);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((entry) => sanitizeValue(entry, key, depth + 1));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).slice(0, 100).map(([entryKey, entryValue]) => [entryKey, sanitizeValue(entryValue, entryKey, depth + 1)]));
  }
  return undefined;
}

function redactText(value: string): string {
  return value.slice(0, 100_000).replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]").replace(/(authorization\s*[:=]\s*)([^\s,;]+)/gi, "$1[REDACTED]");
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function removeUndefined(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}
