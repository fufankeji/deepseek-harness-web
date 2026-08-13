import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  createExtensionRuntime,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSessionEvent,
  type ResourceLoader
} from "@earendil-works/pi-coding-agent";
import { loadDeepSeekCredential } from "./credentials.js";
import {
  DEEPSEEK_MODEL_ID,
  DEEPSEEK_PROVIDER_ID,
  writeDeepSeekModelsConfig
} from "./model-config.js";

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface ToolRecord {
  phase: "start" | "end";
  name: string;
  target?: string;
  isError?: boolean;
}

interface SequenceRecord {
  label: string;
  count: number;
}

const root = await mkdtemp(join(tmpdir(), "ff-pi-deepseek-"));
const workspace = join(root, "workspace");
const agentDir = join(root, "agent");
const sessionDir = join(root, "sessions");
const startedAt = performance.now();

let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;

try {
  await seedWorkspace(workspace);

  const credential = await loadDeepSeekCredential();
  delete process.env.FF_CREDENTIAL_FILE;

  const modelsPath = await writeDeepSeekModelsConfig(agentDir, credential.baseUrl);
  const credentials = new InMemoryCredentialStore();
  const modelRuntime = await ModelRuntime.create({
    credentials,
    modelsPath,
    signal: AbortSignal.timeout(15_000)
  });
  await modelRuntime.setRuntimeApiKey(DEEPSEEK_PROVIDER_ID, credential.apiKey, {
    signal: AbortSignal.timeout(15_000)
  });

  const model = modelRuntime.getModel(DEEPSEEK_PROVIDER_ID, DEEPSEEK_MODEL_ID);
  if (!model) {
    throw new Error(`Model not found: ${DEEPSEEK_PROVIDER_ID}/${DEEPSEEK_MODEL_ID}`);
  }

  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false },
    retry: { enabled: false },
    enableAnalytics: false,
    enableInstallTelemetry: false
  });
  settingsManager.setProjectTrusted(false);

  const resourceLoader = createLockedResourceLoader();
  const created = await createAgentSession({
    cwd: workspace,
    agentDir,
    model,
    thinkingLevel: "off",
    modelRuntime,
    resourceLoader,
    tools: ["read", "edit", "bash"],
    sessionManager: SessionManager.create(workspace, sessionDir),
    settingsManager
  });
  session = created.session;

  installToolBoundary(session, workspace);

  const eventCounts = new Map<string, number>();
  const messageUpdateCounts = new Map<string, number>();
  const sequence: SequenceRecord[] = [];
  const tools: ToolRecord[] = [];
  let settledAt: number | undefined;

  session.subscribe((event) => {
    recordEvent(event, eventCounts, messageUpdateCounts, sequence, tools, workspace);
    if (event.type === "agent_settled") {
      settledAt = performance.now();
    }
  });

  let preflightAccepted = false;
  let preflightAt: number | undefined;
  const promptStartedAt = performance.now();
  const timeout = setTimeout(() => {
    void session?.abort();
  }, 180_000);

  try {
    await session.prompt(
      [
        "在当前工作区完成一个最小修复任务。",
        "必须先分别使用 read 工具读取 src/counter.js 与 test.mjs，",
        "然后使用 edit 工具修复 src/counter.js 中的 increment，",
        "最后必须使用 bash 工具运行精确命令 node test.mjs。",
        "不要读取或修改其他文件，不要运行其他命令。测试通过后用一句中文说明结果。"
      ].join("\n"),
      {
        expandPromptTemplates: false,
        source: "rpc",
        preflightResult: (accepted) => {
          preflightAccepted = accepted;
          preflightAt = performance.now();
        }
      }
    );
  } finally {
    clearTimeout(timeout);
  }

  const promptResolvedAt = performance.now();
  const verification = await runCommand(process.execPath, ["test.mjs"], workspace);
  const status = await runGit(["status", "--porcelain=v1"], workspace);
  const diff = await runGit(["diff", "--", "src/counter.js"], workspace);
  const counterSource = await readFile(join(workspace, "src/counter.js"), "utf8");
  const stats = session.getSessionStats();

  const requiredToolStarts = tools
    .filter((entry) => entry.phase === "start")
    .map((entry) => entry.name);
  const changedFiles = status.stdout
    .trimEnd()
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3));

  assert(preflightAccepted, "Prompt preflight was not accepted");
  assert(settledAt !== undefined, "agent_settled was not observed");
  assert(promptResolvedAt >= settledAt, "prompt resolved before agent_settled");
  assert(requiredToolStarts.includes("read"), "DeepSeek did not call read");
  assert(requiredToolStarts.includes("edit"), "DeepSeek did not call edit");
  assert(requiredToolStarts.includes("bash"), "DeepSeek did not call bash");
  assert(verification.exitCode === 0, `Independent test failed: ${verification.stderr}`);
  assert(changedFiles.length === 1 && changedFiles[0] === "src/counter.js", "Unexpected files changed");
  assert(counterSource.includes("value + 1"), "Expected increment implementation was not written");
  assert(diff.stdout.length > 0, "Git diff was empty");
  assert(Boolean(session.sessionFile), "Persistent session file was not created");

  const result = {
    success: true,
    runtime: {
      node: process.version,
      piVersion: "0.84.1",
      provider: DEEPSEEK_PROVIDER_ID,
      model: DEEPSEEK_MODEL_ID,
      credentialStorage: "memory-only",
      projectTrusted: settingsManager.isProjectTrusted(),
      enabledTools: session.getActiveToolNames()
    },
    protocol: {
      preflightAccepted,
      preflightLatencyMs: roundDuration(preflightAt, promptStartedAt),
      settledLatencyMs: roundDuration(settledAt, promptStartedAt),
      promptResolvedAfterSettled: promptResolvedAt >= settledAt,
      eventCounts: Object.fromEntries([...eventCounts].sort()),
      messageUpdateCounts: Object.fromEntries([...messageUpdateCounts].sort()),
      sequence
    },
    tools,
    result: {
      independentTestExitCode: verification.exitCode,
      independentTestStdout: verification.stdout.trim(),
      changedFiles,
      gitDiffObserved: diff.stdout.length > 0
    },
    session: {
      persisted: Boolean(session.sessionFile),
      sessionFile: session.sessionFile ? basename(session.sessionFile) : null,
      userMessages: stats.userMessages,
      assistantMessages: stats.assistantMessages,
      toolCalls: stats.toolCalls,
      toolResults: stats.toolResults,
      tokens: stats.tokens,
      cost: stats.cost
    },
    elapsedMs: Math.round(performance.now() - startedAt)
  };

  console.log(JSON.stringify(result, null, 2));
} finally {
  session?.dispose();
  await rm(root, { recursive: true, force: true });
}

function createLockedResourceLoader(): ResourceLoader {
  return {
    getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => [
      "你是一个运行在一次性隔离测试工作区中的编程 Agent。",
      "只能处理当前工作目录内用户明确指定的文件。",
      "不得读取环境变量、上级目录、用户主目录、绝对路径或任何凭据。",
      "严格使用用户指定的工具和命令，完成后简洁汇报。"
    ].join("\n"),
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => {},
    reload: async () => {}
  };
}

function installToolBoundary(
  currentSession: NonNullable<typeof session>,
  cwd: string
): void {
  const originalBeforeToolCall = currentSession.agent.beforeToolCall;

  currentSession.agent.beforeToolCall = async (context, signal) => {
    const name = context.toolCall.name;
    const args = asRecord(context.args);

    if (name === "read") {
      const path = typeof args.path === "string" ? args.path : "";
      if (!["src/counter.js", "test.mjs"].includes(normalizeRelativePath(path, cwd))) {
        return { block: true, reason: "Spike boundary: read target is not allowlisted", terminate: true };
      }
    } else if (name === "edit") {
      const path = typeof args.path === "string" ? args.path : "";
      if (normalizeRelativePath(path, cwd) !== "src/counter.js") {
        return { block: true, reason: "Spike boundary: edit target is not allowlisted", terminate: true };
      }
    } else if (name === "bash") {
      const command = typeof args.command === "string" ? args.command.trim() : "";
      if (command !== "node test.mjs") {
        return { block: true, reason: "Spike boundary: bash command is not allowlisted", terminate: true };
      }
    } else {
      return { block: true, reason: "Spike boundary: tool is not allowlisted", terminate: true };
    }

    return originalBeforeToolCall?.(context, signal);
  };
}

function normalizeRelativePath(input: string, cwd: string): string {
  if (!input || input.includes("\0")) {
    return "";
  }
  const target = isAbsolute(input) ? resolve(input) : resolve(cwd, input);
  const relativePath = relative(cwd, target);
  if (relativePath === "" || relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    return "";
  }
  return relativePath.split(sep).join("/");
}

function recordEvent(
  event: AgentSessionEvent,
  eventCounts: Map<string, number>,
  messageUpdateCounts: Map<string, number>,
  sequence: SequenceRecord[],
  tools: ToolRecord[],
  cwd: string
): void {
  eventCounts.set(event.type, (eventCounts.get(event.type) ?? 0) + 1);
  let label: string = event.type;

  if (event.type === "message_update") {
    const updateType = event.assistantMessageEvent.type;
    messageUpdateCounts.set(updateType, (messageUpdateCounts.get(updateType) ?? 0) + 1);
    label = `${event.type}:${updateType}`;
  } else if (event.type === "tool_execution_start") {
    const target = summarizeToolTarget(event.toolName, event.args, cwd);
    tools.push({
      phase: "start",
      name: event.toolName,
      ...(target === undefined ? {} : { target })
    });
    label = `${event.type}:${event.toolName}`;
  } else if (event.type === "tool_execution_end") {
    tools.push({ phase: "end", name: event.toolName, isError: event.isError });
    label = `${event.type}:${event.toolName}:${event.isError ? "error" : "ok"}`;
  }

  const previous = sequence.at(-1);
  if (previous?.label === label) {
    previous.count += 1;
  } else {
    sequence.push({ label, count: 1 });
  }
}

function summarizeToolTarget(name: string, input: unknown, cwd: string): string | undefined {
  const args = asRecord(input);
  if (name === "read" || name === "edit") {
    return typeof args.path === "string" ? normalizeRelativePath(args.path, cwd) || "<blocked>" : undefined;
  }
  if (name === "bash") {
    return typeof args.command === "string" && args.command.trim() === "node test.mjs"
      ? "node test.mjs"
      : "<blocked>";
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

async function seedWorkspace(cwd: string): Promise<void> {
  await mkdir(join(cwd, "src"), { recursive: true });
  await writeFile(
    join(cwd, "src/counter.js"),
    "export function increment(value) {\n  return value;\n}\n"
  );
  await writeFile(
    join(cwd, "test.mjs"),
    [
      "import assert from \"node:assert/strict\";",
      "import { increment } from \"./src/counter.js\";",
      "assert.equal(increment(2), 3);",
      "console.log(\"counter test passed\");",
      ""
    ].join("\n")
  );
  await writeFile(join(cwd, "package.json"), "{\"type\":\"module\"}\n");

  await runGit(["init", "-b", "main"], cwd, true);
  await runGit(["config", "user.name", "FF Spike"], cwd, true);
  await runGit(["config", "user.email", "spike@example.invalid"], cwd, true);
  await runGit(["add", "--", "src/counter.js", "test.mjs", "package.json"], cwd, true);
  await runGit(["commit", "--no-gpg-sign", "-m", "seed"], cwd, true);
}

async function runGit(args: string[], cwd: string, requireSuccess = false): Promise<CommandResult> {
  return runCommand("git", args, cwd, requireSuccess, {
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    PATH: process.env.PATH ?? "/usr/bin:/bin"
  });
}

async function runCommand(
  command: string,
  args: string[],
  cwd: string,
  requireSuccess = false,
  env: NodeJS.ProcessEnv = process.env
): Promise<CommandResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      const result = { exitCode: code ?? -1, stdout, stderr };
      if (requireSuccess && result.exitCode !== 0) {
        rejectPromise(new Error(`${command} ${args.join(" ")} failed: ${stderr || stdout}`));
      } else {
        resolvePromise(result);
      }
    });
  });
}

function roundDuration(value: number | undefined, origin: number): number | null {
  return value === undefined ? null : Math.round(value - origin);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
