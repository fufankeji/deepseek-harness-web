import { describe, expect, it } from "vitest";
import type { HarnessCommand } from "../api/contracts";
import { filterCommandOptions, filterSlashCommands, parseSlashDraft, resolveSlashDraft } from "./slash-commands";

const commands: HarnessCommand[] = [
  { id: "session.new", name: "new", description: "开始新的开发会话", source: "product", input: "none", argumentRequired: false, available: true, startsRun: false },
  { id: "session.rename", name: "name", description: "修改会话名称", source: "product", input: "text", argumentRequired: true, available: true, startsRun: false },
  { id: "session.resume", name: "resume", description: "恢复会话", source: "product", input: "select", argumentRequired: true, available: true, startsRun: false, options: [
    { value: "session-1", label: "修复登录页", description: "deepseek-v4-pro" },
    { value: "session-2", label: "更新文档" }
  ] },
  { id: "session.tree", name: "tree", description: "对话树", source: "harness", input: "none", argumentRequired: false, available: false, unavailableReason: "尚未支持", startsRun: false }
];

describe("slash command parser", () => {
  it("separates a command name and its argument", () => {
    expect(parseSlashDraft("  /name  新会话 ")).toEqual({ name: "name", argument: "新会话", hasArgumentSeparator: true });
    expect(parseSlashDraft("普通任务")).toBeNull();
  });

  it("finds commands without treating unknown slash text as a task", () => {
    expect(resolveSlashDraft(commands, "/new")).toMatchObject({ kind: "known", command: { id: "session.new" } });
    expect(resolveSlashDraft(commands, "/does-not-exist")).toEqual({ kind: "unknown", name: "does-not-exist" });
  });

  it("filters commands and select options from the active catalog", () => {
    expect(filterSlashCommands(commands, "/na").map((item) => item.name)).toEqual(["name"]);
    expect(filterCommandOptions(commands[2], "/resume 登录").map((item) => item.value)).toEqual(["session-1"]);
  });
});
