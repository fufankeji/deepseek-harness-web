import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

const root = await mkdtemp(join(tmpdir(), "ff-pi-control-"));
const workspace = join(root, "workspace");
const agentDir = join(root, "agent");

let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;

try {
  await mkdir(workspace, { recursive: true });
  await writeFile(join(workspace, "README.md"), "temporary control spike\n");

  const credential = await loadDeepSeekCredential();
  delete process.env.FF_CREDENTIAL_FILE;
  const modelsPath = await writeDeepSeekModelsConfig(agentDir, credential.baseUrl);
  const credentials = new InMemoryCredentialStore();
  const modelRuntime = await ModelRuntime.create({ credentials, modelsPath });
  await modelRuntime.setRuntimeApiKey(DEEPSEEK_PROVIDER_ID, credential.apiKey);
  const model = modelRuntime.getModel(DEEPSEEK_PROVIDER_ID, DEEPSEEK_MODEL_ID);
  if (!model) throw new Error("DeepSeek model not found");

  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false },
    retry: { enabled: false },
    enableAnalytics: false,
    enableInstallTelemetry: false
  });
  settingsManager.setProjectTrusted(false);

  ({ session } = await createAgentSession({
    cwd: workspace,
    agentDir,
    model,
    thinkingLevel: "off",
    modelRuntime,
    settingsManager,
    resourceLoader: createNoResourceLoader(),
    tools: ["bash"],
    sessionManager: SessionManager.inMemory(workspace)
  }));

  session.agent.beforeToolCall = async (context) => {
    const args = typeof context.args === "object" && context.args !== null
      ? context.args as Record<string, unknown>
      : {};
    const command = typeof args.command === "string" ? args.command.trim() : "";
    if (context.toolCall.name !== "bash" || command !== "node -e \"setTimeout(() => console.log('wait-finished'), 15000)\"") {
      return { block: true, reason: "Control spike boundary: command is not allowlisted", terminate: true };
    }
    return undefined;
  };

  const events: string[] = [];
  const queueSnapshots: Array<{ steering: number; followUp: number }> = [];
  let abortIssuedAt: number | undefined;
  let settledAt: number | undefined;
  let preflightAccepted = false;
  let controlsQueued = false;
  let clearedDuringControl: { steering: string[]; followUp: string[] } | undefined;

  session.subscribe((event) => {
    events.push(summarizeEvent(event));
    if (event.type === "queue_update") {
      queueSnapshots.push({ steering: event.steering.length, followUp: event.followUp.length });
    }
    if (event.type === "agent_settled") {
      settledAt = performance.now();
    }
    if (!controlsQueued && event.type === "tool_execution_start" && event.toolName === "bash") {
      controlsQueued = true;
      void runControls();
    }
  });

  async function runControls(): Promise<void> {
    if (!session) return;
    await session.steer("停止当前长回答，只回复：已收到引导。不要调用工具。");
    await session.followUp("这是后续队列验证消息，不需要执行；等待停止指令。");
    clearedDuringControl = session.clearQueue();
    abortIssuedAt = performance.now();
    await session.abort();
  }

  const promptStartedAt = performance.now();
  await session.prompt(
    "只使用 bash 工具运行精确命令 `node -e \"setTimeout(() => console.log('wait-finished'), 15000)\"`，然后再说明完成。不要执行其他命令。",
    {
      expandPromptTemplates: false,
      source: "rpc",
      preflightResult: (accepted) => { preflightAccepted = accepted; }
    }
  );
  await session.waitForIdle();
  const clearedAfterSettled = session.clearQueue();

  const assistantMessages = session.messages.filter((message) => message.role === "assistant");
  const stopReasons = assistantMessages.map((message) => message.stopReason);

  assert(preflightAccepted, "Prompt preflight was not accepted");
  assert(controlsQueued, "No streaming message was observed before controls");
  assert(queueSnapshots.some((snapshot) => snapshot.steering === 1), "Steer queue state was not emitted");
  assert(queueSnapshots.some((snapshot) => snapshot.followUp === 1), "Follow-up queue state was not emitted");
  assert(abortIssuedAt !== undefined, "Abort was not issued");
  assert(settledAt !== undefined && settledAt >= abortIssuedAt, "Settled was not observed after abort");
  assert(clearedDuringControl?.steering.length === 1, "Queued steer was not cleared before abort");
  assert(clearedDuringControl.followUp.length === 1, "Queued follow-up was not cleared before abort");
  assert(session.pendingMessageCount === 0, "Queue was not empty after abort");

  console.log(JSON.stringify({
    success: true,
    runtime: {
      piVersion: "0.84.1",
      provider: DEEPSEEK_PROVIDER_ID,
      model: DEEPSEEK_MODEL_ID,
      enabledTools: session.getActiveToolNames(),
      projectTrusted: settingsManager.isProjectTrusted()
    },
    control: {
      preflightAccepted,
      steerAccepted: true,
      followUpAccepted: true,
      abortAccepted: true,
      assistantStopReasons: stopReasons,
      queueSnapshots,
      clearedBeforeAbort: {
        steering: clearedDuringControl.steering.length,
        followUp: clearedDuringControl.followUp.length
      },
      clearedAfterSettled: {
        steering: clearedAfterSettled.steering.length,
        followUp: clearedAfterSettled.followUp.length
      },
      settledAfterAbortMs: Math.round(settledAt - abortIssuedAt)
    },
    protocol: {
      events,
      elapsedMs: Math.round(performance.now() - promptStartedAt)
    }
  }, null, 2));
} finally {
  session?.dispose();
  await rm(root, { recursive: true, force: true });
}

function createNoResourceLoader(): ResourceLoader {
  return {
    getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => [
      "你是隔离控制协议测试中的助手。",
      "不得读取文件、环境变量或调用工具。",
      "响应用户文本并服从后续的引导和停止。"
    ].join("\n"),
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => {},
    reload: async () => {}
  };
}

function summarizeEvent(event: AgentSessionEvent): string {
  if (event.type === "message_update") {
    return `${event.type}:${event.assistantMessageEvent.type}`;
  }
  if (event.type === "queue_update") {
    return `${event.type}:s${event.steering.length}:f${event.followUp.length}`;
  }
  return event.type;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
