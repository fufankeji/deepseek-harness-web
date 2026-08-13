import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type CreateAgentSessionRuntimeFactory
} from "@earendil-works/pi-coding-agent";
import { loadDeepSeekCredential } from "./credentials.js";
import {
  DEEPSEEK_MODEL_ID,
  DEEPSEEK_PROVIDER_ID,
  writeDeepSeekModelsConfig
} from "./model-config.js";

const root = await mkdtemp(join(tmpdir(), "ff-pi-session-"));
const workspace = join(root, "workspace");
const agentDir = join(root, "agent");
const sessionDir = join(root, "sessions");

let runtime: Awaited<ReturnType<typeof createAgentSessionRuntime>> | undefined;

try {
  await mkdir(workspace, { recursive: true });
  await writeFile(join(workspace, "README.md"), "temporary session runtime spike\n");

  const credential = await loadDeepSeekCredential();
  delete process.env.FF_CREDENTIAL_FILE;
  const modelsPath = await writeDeepSeekModelsConfig(agentDir, credential.baseUrl);
  const credentials = new InMemoryCredentialStore();
  const modelRuntime = await ModelRuntime.create({ credentials, modelsPath });
  await modelRuntime.setRuntimeApiKey(DEEPSEEK_PROVIDER_ID, credential.apiKey);

  const factory: CreateAgentSessionRuntimeFactory = async (options) => {
    const settingsManager = SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: false },
      enableAnalytics: false,
      enableInstallTelemetry: false
    });
    settingsManager.setProjectTrusted(false);

    const services = await createAgentSessionServices({
      cwd: options.cwd,
      agentDir: options.agentDir,
      settingsManager,
      modelRuntime,
      resourceLoaderOptions: {
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
        systemPrompt: "隔离会话生命周期测试。不得读取文件或调用工具。"
      }
    });
    const model = services.modelRuntime.getModel(DEEPSEEK_PROVIDER_ID, DEEPSEEK_MODEL_ID);
    if (!model) throw new Error("DeepSeek model not found");
    const created = await createAgentSessionFromServices({
      services,
      sessionManager: options.sessionManager,
      ...(options.sessionStartEvent === undefined ? {} : { sessionStartEvent: options.sessionStartEvent }),
      model,
      thinkingLevel: "off",
      noTools: "all"
    });
    return { ...created, services, diagnostics: services.diagnostics };
  };

  runtime = await createAgentSessionRuntime(factory, {
    cwd: workspace,
    agentDir,
    sessionManager: SessionManager.create(workspace, sessionDir)
  });

  const generations: Array<{
    generation: number;
    sessionId: string;
    eventCount: number;
  }> = [];
  let generation = 0;
  let activeEventCount = 0;
  let staleEventCount = 0;
  let unsubscribe = () => {};

  const rebind = (nextSession: Awaited<ReturnType<typeof createAgentSession>>["session"]): void => {
    unsubscribe();
    generation += 1;
    const boundGeneration = generation;
    activeEventCount = 0;
    unsubscribe = nextSession.subscribe(() => {
      if (boundGeneration === generation) activeEventCount += 1;
      else staleEventCount += 1;
    });
    generations.push({ generation, sessionId: nextSession.sessionId, eventCount: 0 });
  };

  runtime.setRebindSession(async (nextSession) => { rebind(nextSession); });
  rebind(runtime.session);

  const initialSession = runtime.session;
  const initialSessionId = initialSession.sessionId;
  const initialSessionFile = initialSession.sessionFile;
  if (!initialSessionFile) throw new Error("Initial persistent session path is missing");
  await initialSession.prompt("只回复：会话已保存。", {
    expandPromptTemplates: false,
    source: "rpc"
  });
  const initialEntries = initialSession.sessionManager.getEntries();
  const initialHistoryCount = countMessageEntries(initialEntries);

  const newResult = await runtime.newSession();
  const newSessionId = runtime.session.sessionId;
  const newSessionFile = runtime.session.sessionFile;
  const newEntries = runtime.session.sessionManager.getEntries();
  const newHistoryCount = countMessageEntries(newEntries);
  const oldSessionListenersAfterNew = getListenerCount(initialSession);
  const newSessionObjectReplaced = runtime.session !== initialSession;

  const switchResult = await runtime.switchSession(initialSessionFile);
  const resumedSession = runtime.session;
  const resumedEntries = resumedSession.sessionManager.getEntries();
  const resumedHistoryCount = countMessageEntries(resumedEntries);
  const resumedSessionId = resumedSession.sessionId;

  const leafId = resumedSession.sessionManager.getLeafId();
  if (!leafId) throw new Error("No persisted entry exists for fork validation");
  const forkResult = await runtime.fork(leafId, { position: "at" });
  const forkSessionId = runtime.session.sessionId;
  const forkEntries = runtime.session.sessionManager.getEntries();
  const forkHistoryCount = countMessageEntries(forkEntries);
  const forkParent = runtime.session.sessionManager.getHeader()?.parentSession;

  generations.at(-1)!.eventCount = activeEventCount;

  assert(!newResult.cancelled, "New session was cancelled");
  assert(newSessionObjectReplaced, "Runtime did not replace the session object on newSession");
  assert(newSessionId !== initialSessionId, "newSession reused the previous session ID");
  assert(newHistoryCount === 0, "New session unexpectedly retained history");
  assert(oldSessionListenersAfterNew === 0, "Old session listeners remained after replacement");
  assert(!switchResult.cancelled, "Session switch was cancelled");
  assert(resumedSessionId === initialSessionId, "Resume did not restore the original session ID");
  assert(resumedHistoryCount === initialHistoryCount, "Resume did not restore session history");
  assert(!forkResult.cancelled, "Fork was cancelled");
  assert(forkSessionId !== initialSessionId && forkSessionId !== newSessionId, "Fork reused an existing session ID");
  assert(forkHistoryCount === initialHistoryCount, "Fork did not preserve the selected branch history");
  assert(forkParent === initialSessionFile, "Fork lineage did not reference the source session");
  assert(generation === 4, `Expected four runtime generations, observed ${generation}`);
  assert(staleEventCount === 0, "A stale session event reached the active subscription");

  console.log(JSON.stringify({
    success: true,
    runtime: {
      piVersion: "0.84.1",
      provider: DEEPSEEK_PROVIDER_ID,
      model: DEEPSEEK_MODEL_ID
    },
    lifecycle: {
      generations: generation,
      newSession: {
        objectReplaced: newSessionObjectReplaced,
        idChanged: newSessionId !== initialSessionId,
        historyCount: newHistoryCount,
        metadataEntryCount: newEntries.length - newHistoryCount,
        oldListenerCount: oldSessionListenersAfterNew,
        sessionFile: newSessionFile ? basename(newSessionFile) : null
      },
      resume: {
        idRestored: resumedSessionId === initialSessionId,
        historyCount: resumedHistoryCount,
        metadataEntryCount: resumedEntries.length - resumedHistoryCount,
        sessionFile: runtime.session.sessionFile ? basename(initialSessionFile) : null
      },
      fork: {
        idChanged: forkSessionId !== initialSessionId,
        historyCount: forkHistoryCount,
        metadataEntryCount: forkEntries.length - forkHistoryCount,
        parentLinked: forkParent === initialSessionFile
      },
      staleEventCount
    }
  }, null, 2));
} finally {
  await runtime?.dispose();
  await rm(root, { recursive: true, force: true });
}

function getListenerCount(value: unknown): number {
  const record = value as { _eventListeners?: unknown[] };
  return Array.isArray(record._eventListeners) ? record._eventListeners.length : -1;
}

function countMessageEntries(entries: Array<{ type: string }>): number {
  return entries.filter((entry) => entry.type === "message").length;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
