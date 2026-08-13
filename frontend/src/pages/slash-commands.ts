import type { HarnessCommand, HarnessCommandOption } from "../api/contracts";

export interface ParsedSlashDraft {
  name: string;
  argument: string;
  hasArgumentSeparator: boolean;
}

export type SlashResolution =
  | { kind: "not-command" }
  | { kind: "unknown"; name: string }
  | { kind: "known"; command: HarnessCommand; argument: string };

export function parseSlashDraft(draft: string): ParsedSlashDraft | null {
  const value = draft.trimStart();
  if (!value.startsWith("/")) return null;
  const withoutSlash = value.slice(1);
  const separator = withoutSlash.search(/\s/);
  if (separator < 0) return { name: withoutSlash.toLowerCase(), argument: "", hasArgumentSeparator: false };
  return {
    name: withoutSlash.slice(0, separator).toLowerCase(),
    argument: withoutSlash.slice(separator).trim(),
    hasArgumentSeparator: true
  };
}

export function filterSlashCommands(commands: HarnessCommand[], draft: string): HarnessCommand[] {
  const parsed = parseSlashDraft(draft);
  if (!parsed || parsed.hasArgumentSeparator) return parsed ? commands.filter((item) => item.name.toLowerCase() === parsed.name) : [];
  const query = parsed.name;
  return commands
    .filter((item) => !query || item.name.toLowerCase().includes(query) || item.description.toLowerCase().includes(query))
    .sort((left, right) => commandRank(left, query) - commandRank(right, query) || left.name.localeCompare(right.name));
}

export function filterCommandOptions(command: HarnessCommand | undefined, draft: string): HarnessCommandOption[] {
  if (!command || command.input !== "select") return [];
  const query = parseSlashDraft(draft)?.argument.toLowerCase() ?? "";
  return (command.options ?? []).filter((option) => !query
    || option.value.toLowerCase().includes(query)
    || option.label.toLowerCase().includes(query)
    || option.description?.toLowerCase().includes(query));
}

export function resolveSlashDraft(commands: HarnessCommand[], draft: string): SlashResolution {
  const parsed = parseSlashDraft(draft);
  if (!parsed) return { kind: "not-command" };
  const command = commands.find((item) => item.name.toLowerCase() === parsed.name);
  if (!command) return { kind: "unknown", name: parsed.name };
  return { kind: "known", command, argument: parsed.argument };
}

function commandRank(command: HarnessCommand, query: string): number {
  if (!query) return command.available ? 0 : 3;
  if (command.name.toLowerCase() === query) return command.available ? 0 : 1;
  if (command.name.toLowerCase().startsWith(query)) return command.available ? 1 : 2;
  return command.available ? 2 : 3;
}
