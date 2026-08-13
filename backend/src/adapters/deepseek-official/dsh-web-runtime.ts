import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { spawn, type ChildProcess } from "node:child_process";
import { BridgeError } from "../../errors.js";

export const DSH_VERSION = "0.1.0-rc.6";
export const DSH_RESTRICTED_PRESET = "ff-restricted";

export interface DshSessionEvent {
  type: string;
  seq: number;
  time: number;
  data: unknown;
  sourceEventSeqs?: number[];
  surfaceOp?: unknown;
  ignorable?: true;
}

export interface DshFrame {
  type: string;
  sessionId?: string;
  event?: DshSessionEvent;
  [key: string]: unknown;
}

interface DshWebRuntimeOptions {
  cwd: string;
  dshHome: string;
  apiKey: string;
  baseUrl: string;
  permissionMode: "read-only" | "workspace-write";
  onMuxFrame: (frame: DshFrame, rpcId: string) => void | Promise<void>;
  onHostFrame: (frame: DshFrame, rpcId: string) => void | Promise<void>;
}

interface RpcErrorBody {
  code?: unknown;
  message?: unknown;
}

interface RpcEnvelope<T> {
  type?: unknown;
  rpcId?: unknown;
  result?: { ok?: unknown; value?: T; error?: RpcErrorBody };
}

export class DshWebRuntime {
  readonly #abort = new AbortController();
  readonly #streamTasks: Promise<void>[] = [];
  readonly #process: ChildProcess;
  readonly #credentialDir: string;
  readonly #baseUrl: string;
  readonly #cleanupCredentials: () => void;
  #disposed = false;

  private constructor(process: ChildProcess, baseUrl: string, credentialDir: string) {
    this.#process = process;
    this.#baseUrl = baseUrl;
    this.#credentialDir = credentialDir;
    this.#cleanupCredentials = () => {
      try {
        rmSync(this.#credentialDir, { recursive: true, force: true });
      } finally {
        this.#process.off("exit", this.#cleanupCredentials);
        globalThis.process.off("exit", this.#cleanupCredentials);
      }
    };
    this.#process.once("exit", this.#cleanupCredentials);
    globalThis.process.once("exit", this.#cleanupCredentials);
  }

  static async start(options: DshWebRuntimeOptions): Promise<DshWebRuntime> {
    await mkdir(options.dshHome, { recursive: true, mode: 0o700 });
    const require = createRequire(import.meta.url);
    const packagePath = require.resolve("@deepseek-ai/dsh/package.json");
    await installRestrictedPreset(options.dshHome, dirname(packagePath));
    const credentialDir = await mkdtemp(join(tmpdir(), "ff-dsh-runtime-"));
    const credentialPath = join(credentialDir, ".credentials.yaml");
    const patchPath = join(credentialDir, "bridge.cordis.yml");
    await writeFile(patchPath, renderRuntimePatch(options.dshHome, credentialPath), { mode: 0o600 });

    const binPath = resolve(dirname(packagePath), "lib", "bin.js");
    let child: ChildProcess;
    try {
      child = spawn(process.execPath, [binPath, "--profile", "web", "--patch", patchPath, "--host", "127.0.0.1", "--port", "0"], {
        cwd: options.cwd,
        env: runtimeEnvironment(options.dshHome, options.baseUrl, options.permissionMode),
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch (error) {
      await rm(credentialDir, { recursive: true, force: true });
      throw error;
    }

    try {
      const baseUrl = await waitForAddress(child);
      child.stdout?.resume();
      child.stderr?.resume();
      const runtime = new DshWebRuntime(child, baseUrl, credentialDir);
      await runtime.call("host.describe", {});
      await runtime.call("credentials.set", { ref: "DEEPSEEK_API_KEY", value: options.apiKey });
      runtime.#streamTasks.push(
        runtime.pump("events.mux", options.onMuxFrame),
        runtime.pump("events.host", options.onHostFrame)
      );
      return runtime;
    } catch (error) {
      child.kill("SIGTERM");
      await Promise.race([waitForExit(child), delay(5_000)]);
      if (child.exitCode === null) child.kill("SIGKILL");
      await rm(credentialDir, { recursive: true, force: true });
      throw error;
    }
  }

  get alive(): boolean {
    return !this.#disposed && this.#process.exitCode === null && !this.#process.killed;
  }

  async call<T>(method: string, payload: Record<string, unknown>, timeoutMs = 30_000): Promise<T> {
    if (!this.alive) throw new BridgeError(503, "dsh_runtime_unavailable", "DeepSeek Harness 官方运行时未启动。", true);
    const rpcId = randomUUID();
    const response = await fetch(`${this.#baseUrl}/api/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "client-request", rpcId, method, payload }),
      signal: AbortSignal.timeout(timeoutMs)
    }).catch((error: unknown) => {
      throw new BridgeError(503, "dsh_transport_failed", `DeepSeek Harness 通信失败：${safeMessage(error)}`, true);
    });
    if (!response.ok) throw new BridgeError(502, "dsh_transport_failed", `DeepSeek Harness 返回 HTTP ${response.status}。`, true);
    const envelope = await response.json() as RpcEnvelope<T>;
    if (envelope.type !== "server-response" || envelope.rpcId !== rpcId || !envelope.result) {
      throw new BridgeError(502, "dsh_protocol_invalid", "DeepSeek Harness 返回了无法识别的协议消息。", true);
    }
    if (envelope.result.ok !== true) {
      const code = typeof envelope.result.error?.code === "string" ? envelope.result.error.code : "dsh_rpc_failed";
      const message = typeof envelope.result.error?.message === "string" ? envelope.result.error.message : "DeepSeek Harness 请求失败。";
      throw new BridgeError(502, code, sanitizeText(message), true);
    }
    return envelope.result.value as T;
  }

  async remote<T>(endpoint: string, args: Record<string, unknown>, timeoutMs = 30_000): Promise<T> {
    return await this.call<T>(endpoint, { args }, timeoutMs);
  }

  async respond(rpcId: string, value: Record<string, unknown>): Promise<void> {
    await this.postResponse(rpcId, { ok: true, value });
  }

  async respondCancelled(rpcId: string, message: string, details: Record<string, unknown>): Promise<void> {
    await this.postResponse(rpcId, { ok: false, error: { code: "cancelled", message, details } });
  }

  private async postResponse(rpcId: string, result: Record<string, unknown>): Promise<void> {
    const response = await fetch(`${this.#baseUrl}/api/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "client-response", rpcId, result }),
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) throw new Error(`DeepSeek Harness respond HTTP ${response.status}`);
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#abort.abort();
    if (this.#process.exitCode === null) this.#process.kill("SIGTERM");
    await Promise.race([waitForExit(this.#process), delay(5_000)]);
    if (this.#process.exitCode === null) this.#process.kill("SIGKILL");
    await Promise.allSettled(this.#streamTasks);
    await rm(this.#credentialDir, { recursive: true, force: true });
    this.#process.off("exit", this.#cleanupCredentials);
    globalThis.process.off("exit", this.#cleanupCredentials);
  }

  private async pump(path: "events.mux" | "events.host", handler: (frame: DshFrame, rpcId: string) => void | Promise<void>): Promise<void> {
    const url = new URL(`/api/${path}`, this.#baseUrl);
    url.protocol = "ws:";
    while (!this.#abort.signal.aborted && this.alive) {
      try {
        await pumpSocket(url, this.#abort.signal, handler);
      } catch {
        if (this.#abort.signal.aborted || !this.alive) return;
        await delay(300);
      }
    }
  }
}

function runtimeEnvironment(dshHome: string, baseUrl: string, permissionMode: "read-only" | "workspace-write"): NodeJS.ProcessEnv {
  const keys = ["PATH", "HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "TMPDIR", "TMP", "TEMP", "SHELL", "TERM"];
  const env: NodeJS.ProcessEnv = {};
  for (const key of keys) if (process.env[key] !== undefined) env[key] = process.env[key];
  env.DSH_HOME = dshHome;
  env.DSH_TELEMETRY_DISABLED = "1";
  env.DSH_PERMISSION_MODE = permissionMode;
  env.DEEPSEEK_BASE_URL = baseUrl;
  return env;
}

async function installRestrictedPreset(dshHome: string, packageRoot: string): Promise<void> {
  const sourcePath = join(packageRoot, "config", "agent-presets", "standard", "agent.cordis.yml");
  const source = await readFile(sourcePath, "utf8");
  const instructionConfig = "  config:\n    maxBytes: 65536";
  const skillConfig = "- id: skill-filesystem\n  name: '@deepseek-ai/dsh-skill-filesystem'\n";
  if (!source.includes(instructionConfig) || !source.includes(skillConfig)) {
    throw new BridgeError(503, "dsh_preset_incompatible", "DeepSeek Harness 受限模式与当前官方版本不兼容。", false);
  }
  const restricted = source
    .replace(instructionConfig, "  config:\n    maxBytes: 0")
    .replace(skillConfig, `${skillConfig}  config:\n    includeDefaultRoots: false\n    watch: false\n`);
  const presetDir = join(dshHome, ".agent-presets", DSH_RESTRICTED_PRESET);
  await mkdir(presetDir, { recursive: true, mode: 0o700 });
  await writeFile(join(presetDir, "agent.cordis.yml"), restricted, { mode: 0o600 });
  await writeFile(join(presetDir, "preset.yml"), [
    "name: FF 受限模式",
    "description: 保留标准编程能力，但不加载工作区指令和本地 Skills。",
    "order: 1000",
    ""
  ].join("\n"), { mode: 0o600 });
}

function renderRuntimePatch(dshHome: string, credentialPath: string): string {
  return [
    "- id: credentials",
    "  config:",
    `    path: ${JSON.stringify(credentialPath)}`,
    `    dshHome: ${JSON.stringify(dshHome)}`,
    "    watch: true",
    "    debounceMs: 100",
    "- id: agent-presets",
    "  config:",
    "    default: standard",
    "    includeUserRoot: true",
    "- id: permission",
    "  config:",
    "    presets:",
    "      read-only:",
    "        sandbox: read-only",
    "        approval: ask",
    "      workspace-write:",
    "        sandbox: workspace-write",
    "        approval: ask",
    "      danger-full-access:",
    "        sandbox: danger-full-access",
    "        approval: never",
    "    defaultPreset: !!js process.env.DSH_PERMISSION_MODE ?? 'workspace-write'",
    ""
  ].join("\n");
}

async function waitForAddress(child: ChildProcess): Promise<string> {
  let stdout = "";
  let stderr = "";
  return await new Promise<string>((resolveAddress, rejectAddress) => {
    const timeout = setTimeout(() => fail("DeepSeek Harness 启动超时。"), 30_000);
    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout?.off("data", onStdout);
      child.stderr?.off("data", onStderr);
      child.off("exit", onExit);
      child.off("error", onError);
    };
    const fail = (message: string) => {
      cleanup();
      rejectAddress(new BridgeError(503, "dsh_start_failed", sanitizeText(message), true));
    };
    const inspect = () => {
      const match = stdout.match(/https?:\/\/127\.0\.0\.1:\d+/);
      if (!match) return;
      cleanup();
      resolveAddress(match[0]);
    };
    const onStdout = (chunk: Buffer) => { stdout = `${stdout}${chunk.toString("utf8")}`.slice(-16_000); inspect(); };
    const onStderr = (chunk: Buffer) => { stderr = `${stderr}${chunk.toString("utf8")}`.slice(-16_000); };
    const onExit = (code: number | null) => fail(`DeepSeek Harness 启动失败（exit ${code ?? "unknown"}）：${stderr || stdout}`);
    const onError = (error: Error) => fail(`DeepSeek Harness 无法启动：${error.message}`);
    child.stdout?.on("data", onStdout);
    child.stderr?.on("data", onStderr);
    child.once("exit", onExit);
    child.once("error", onError);
  });
}

async function pumpSocket(url: URL, signal: AbortSignal, handler: (frame: DshFrame, rpcId: string) => void | Promise<void>): Promise<void> {
  const socket = new WebSocket(url);
  await new Promise<void>((resolveOpen, rejectOpen) => {
    const onOpen = () => { cleanup(); resolveOpen(); };
    const onError = () => { cleanup(); rejectOpen(new Error("WebSocket open failed")); };
    const onAbort = () => { cleanup(); socket.close(); rejectOpen(new Error("aborted")); };
    const cleanup = () => {
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("error", onError);
      signal.removeEventListener("abort", onAbort);
    };
    socket.addEventListener("open", onOpen, { once: true });
    socket.addEventListener("error", onError, { once: true });
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
  await new Promise<void>((resolveClosed) => {
    let chain = Promise.resolve();
    const onMessage = (event: MessageEvent) => {
      if (typeof event.data !== "string") return;
      chain = chain.then(async () => {
        const envelope = JSON.parse(event.data) as { type?: unknown; rpcId?: unknown; payload?: unknown };
        if (envelope.type !== "server-request" || typeof envelope.rpcId !== "string" || !isRecord(envelope.payload)) return;
        await handler(envelope.payload as DshFrame, envelope.rpcId);
      }).catch(() => undefined);
    };
    const close = () => { cleanup(); void chain.finally(resolveClosed); };
    const cleanup = () => {
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("close", close);
      socket.removeEventListener("error", close);
      signal.removeEventListener("abort", close);
    };
    socket.addEventListener("message", onMessage);
    socket.addEventListener("close", close, { once: true });
    socket.addEventListener("error", close, { once: true });
    signal.addEventListener("abort", () => { socket.close(); close(); }, { once: true });
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeText(value: string): string {
  return value.slice(0, 4_000).replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]");
}

function safeMessage(error: unknown): string {
  return sanitizeText(error instanceof Error ? error.message : "未知错误");
}

async function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  await new Promise<void>((resolveExit) => child.once("exit", () => resolveExit()));
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
