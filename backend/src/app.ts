import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { config as defaultConfig } from "./config.js";
import { publicError, BridgeError } from "./errors.js";
import { CredentialStore } from "./secrets/credential-store.js";
import { ModelService } from "./model/model-service.js";
import { EventBus } from "./runtime/event-bus.js";
import { AcceptanceRecordStore, EventStore } from "./sessions/event-store.js";
import { WorkspaceService, type PersistedWorkspace } from "./workspace/workspace-service.js";
import { pickLocalDirectory } from "./workspace/directory-picker.js";
import { WorkspaceMonitor } from "./workspace/workspace-monitor.js";
import { ToolOutputStore } from "./runtime/tool-output-store.js";
import { CommandExportStore } from "./runtime/command-export-store.js";
import { PiHarnessAdapter } from "./adapters/pi/pi-harness-adapter.js";
import { DeepSeekOfficialAdapter } from "./adapters/deepseek-official/deepseek-official-adapter.js";
import type { HarnessAdapter } from "./adapters/harness-adapter.js";
import type { AcceptanceRecord, CapabilityDecisionSet, CapabilitySet, CommandReceipt, HarnessEvent } from "./contracts.js";

export interface BridgeAppOptions {
  host?: string;
  port?: number;
  dataDir?: string;
  acceptanceLedger?: string;
  credentialFile?: string;
  allowedWorkspaceRoot?: string;
  deepSeekModel?: string;
  deepSeekBaseUrl?: string;
  projectRoot?: string;
  directoryPicker?: () => Promise<string | null>;
}

export class BridgeApp {
  readonly #host: string;
  readonly #port: number;
  readonly #credentialFile: string | undefined;
  readonly #deepSeekBaseUrl: string;
  readonly #eventStore: EventStore;
  readonly #acceptanceRecordStore: AcceptanceRecordStore;
  readonly #eventBus = new EventBus();
  readonly #credentialStore = new CredentialStore();
  readonly #workspaceService: WorkspaceService;
  readonly #workspaceMonitor = new WorkspaceMonitor();
  readonly #toolOutputStore: ToolOutputStore;
  readonly #commandExportStore: CommandExportStore;
  readonly #adapters: Map<string, HarnessAdapter>;
  readonly #directoryPicker: () => Promise<string | null>;
  readonly #startedAt = Date.now();
  #server: Server | undefined;
  #activeAdapterId: "pi" | "deepseek-official";
  #activeSockets = new Set<import("node:net").Socket>();

  constructor(options: BridgeAppOptions = {}) {
    this.#host = options.host ?? defaultConfig.host;
    this.#port = options.port ?? defaultConfig.port;
    const dataDir = resolve(options.dataDir ?? defaultConfig.dataDir);
    const projectRoot = resolve(options.projectRoot ?? defaultConfig.projectRoot);
    this.#credentialFile = options.credentialFile ?? defaultConfig.credentialFile;
    delete process.env.FF_CREDENTIAL_FILE;
    this.#deepSeekBaseUrl = options.deepSeekBaseUrl ?? defaultConfig.deepSeekBaseUrl;
    this.#directoryPicker = options.directoryPicker ?? pickLocalDirectory;
    this.#eventStore = new EventStore(join(dataDir, "runtime.sqlite"));
    const acceptanceLedger = options.acceptanceLedger
      ? resolve(options.acceptanceLedger)
      : options.dataDir
        ? join(dataDir, "acceptance-ledger.sqlite")
        : defaultConfig.acceptanceLedger;
    this.#acceptanceRecordStore = new AcceptanceRecordStore(acceptanceLedger);
    this.#workspaceService = new WorkspaceService(
      dataDir,
      join(projectRoot, "backend", "acceptance-templates"),
      options.allowedWorkspaceRoot ?? defaultConfig.allowedWorkspaceRoot
    );
    const modelService = new ModelService(
      join(dataDir, "pi-agent"),
      this.#credentialStore,
      options.deepSeekModel ?? defaultConfig.deepSeekModel
    );
    this.#toolOutputStore = new ToolOutputStore(dataDir);
    this.#commandExportStore = new CommandExportStore(dataDir);
    const piAdapter = new PiHarnessAdapter(
      dataDir,
      modelService,
      this.#workspaceService,
      this.#eventStore,
      this.#eventBus,
      this.#toolOutputStore,
      this.#commandExportStore,
      this.#acceptanceRecordStore
    );
    const officialAdapter = new DeepSeekOfficialAdapter(
      dataDir,
      this.#credentialStore,
      this.#workspaceService,
      this.#eventStore,
      this.#eventBus,
      this.#acceptanceRecordStore,
      options.deepSeekModel ?? defaultConfig.deepSeekModel
    );
    this.#adapters = new Map<string, HarnessAdapter>([[piAdapter.id, piAdapter], [officialAdapter.id, officialAdapter]]);
    this.#activeAdapterId = this.#eventStore.getMetadata<"pi" | "deepseek-official">("active_adapter_id") ?? "pi";
    if (!this.#adapters.has(this.#activeAdapterId)) this.#activeAdapterId = "pi";
  }

  private get adapter(): HarnessAdapter {
    const adapter = this.#adapters.get(this.#activeAdapterId);
    if (!adapter) throw new BridgeError(500, "adapter_unavailable", "当前 Harness Adapter 不可用。", false);
    return adapter;
  }

  get address(): { host: string; port: number; url: string } {
    const address = this.#server?.address();
    const port = typeof address === "object" && address ? address.port : this.#port;
    return { host: this.#host, port, url: `http://${this.#host}:${port}` };
  }

  async start(): Promise<{ host: string; port: number; url: string }> {
    if (this.#server) return this.address;
    this.#eventStore.recoverInterruptedRuns();
    const savedWorkspace = this.#eventStore.getMetadata<PersistedWorkspace>("current_workspace");
    if (savedWorkspace && !this.#workspaceService.current) {
      await this.#workspaceService.restore(savedWorkspace).then(() => this.startWorkspaceMonitor()).catch(() => undefined);
    }
    const server = createServer((request, response) => {
      void this.handle(request, response);
    });
    server.on("connection", (socket) => {
      this.#activeSockets.add(socket);
      socket.once("close", () => this.#activeSockets.delete(socket));
    });
    this.#server = server;
    await new Promise<void>((resolveStart, rejectStart) => {
      server.once("error", rejectStart);
      server.listen(this.#port, this.#host, () => {
        server.off("error", rejectStart);
        resolveStart();
      });
    });
    return this.address;
  }

  async stop(): Promise<void> {
    const server = this.#server;
    if (!server) return;
    this.#server = undefined;
    await Promise.all([...this.#adapters.values()].map(async (adapter) => await adapter.dispose()));
    this.#workspaceMonitor.stop();
    this.#credentialStore.clear();
    for (const socket of this.#activeSockets) socket.destroy();
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    this.#eventStore.close();
    this.#acceptanceRecordStore.close();
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      setSecurityHeaders(response);
      assertLocalAuthority(request);
      if (request.method === "OPTIONS") {
        response.writeHead(204);
        response.end();
        return;
      }
      const url = new URL(request.url ?? "/", "http://127.0.0.1");

      if (request.method === "GET" && url.pathname === "/api/health") {
        return json(response, 200, {
          status: "ready",
          version: "0.1.0",
          uptimeSeconds: Math.floor((Date.now() - this.#startedAt) / 1000),
          transport: "http+sse",
          persistence: "node:sqlite"
        });
      }
      if (request.method === "POST" && url.pathname === "/api/runtime/probe") {
        return json(response, 200, await this.adapter.probe());
      }
      if (request.method === "GET" && url.pathname === "/api/runtime/options") {
        return json(response, 200, { activeAdapterId: this.#activeAdapterId, options: await Promise.all([...this.#adapters.values()].map(async (adapter) => await adapter.probe())) });
      }
      if (request.method === "POST" && url.pathname === "/api/runtime/select") {
        const body = await readJson(request);
        const adapterId = stringField(body, "adapterId", true);
        if (adapterId !== "pi" && adapterId !== "deepseek-official") throw new BridgeError(400, "adapter_unknown", "未知的 Harness 运行方式。", false);
        if (adapterId !== this.#activeAdapterId) {
          this.adapter.assertIdle();
          await this.adapter.dispose();
          this.#activeAdapterId = adapterId;
          this.#eventStore.setMetadata("active_adapter_id", adapterId);
        }
        return json(response, 200, await this.adapter.probe());
      }
      if (request.method === "GET" && url.pathname === "/api/model") {
        return json(response, 200, this.adapter.getModelInfo());
      }
      if (request.method === "GET" && url.pathname === "/api/model/sources") {
        return json(response, 200, { configuredFile: Boolean(this.#credentialFile) });
      }
      if (request.method === "POST" && url.pathname === "/api/model/connect") {
        this.adapter.assertIdle();
        const body = await readJson(request);
        const modelId = stringField(body, "modelId", false);
        const thinkingLevelValue = stringField(body, "thinkingLevel", false) ?? "high";
        if (thinkingLevelValue !== "high" && thinkingLevelValue !== "max") {
          throw new BridgeError(400, "thinking_level_unsupported", "DeepSeek V4 当前只支持高或最大思考强度。", false);
        }
        const thinkingLevel: "high" | "max" = thinkingLevelValue;
        const verify = body.verify !== false;
        if (body.credentialSource === "configured-file") {
          if (!this.#credentialFile) throw new BridgeError(409, "credential_file_unconfigured", "本地凭证文件尚未配置。", false);
          await this.#credentialStore.loadFromFile(this.#credentialFile);
        } else {
          const apiKey = stringField(body, "apiKey", true);
          const baseUrl = stringField(body, "baseUrl", false) ?? this.#deepSeekBaseUrl;
          this.#credentialStore.set(apiKey, baseUrl);
        }
        return json(response, 200, await this.adapter.connectModel(modelId, verify, thinkingLevel));
      }
      if (request.method === "POST" && url.pathname === "/api/model/disconnect") {
        return json(response, 200, await this.adapter.disconnectModel());
      }
      if (request.method === "POST" && url.pathname === "/api/workspaces/acceptance") {
        this.adapter.assertIdle();
        const body = await readJson(request);
        await this.disposeAdapters();
        const workspace = await this.#workspaceService.createAcceptanceWorkspace(stringField(body, "templateVersion", false) ?? "counter-v1");
        this.persistWorkspace();
        this.startWorkspaceMonitor();
        return json(response, 201, workspace);
      }
      if (request.method === "POST" && url.pathname === "/api/workspaces/starter") {
        this.adapter.assertIdle();
        const body = await readJson(request);
        await this.disposeAdapters();
        const workspace = await this.#workspaceService.createStarterWorkspace(stringField(body, "templateVersion", false) ?? "counter-v1");
        this.persistWorkspace();
        this.startWorkspaceMonitor();
        return json(response, 201, workspace);
      }
      if (request.method === "POST" && url.pathname === "/api/workspaces/import") {
        this.adapter.assertIdle();
        const body = await readJson(request);
        await this.disposeAdapters();
        const workspace = await this.#workspaceService.importGit(stringField(body, "url", true));
        this.persistWorkspace();
        this.startWorkspaceMonitor();
        return json(response, 201, workspace);
      }
      if (request.method === "POST" && url.pathname === "/api/workspaces/select") {
        this.adapter.assertIdle();
        const body = await readJson(request);
        await this.disposeAdapters();
        const workspace = await this.#workspaceService.select(
          stringField(body, "path", true),
          body.projectTrusted === true
        );
        this.persistWorkspace();
        this.startWorkspaceMonitor();
        return json(response, 200, workspace);
      }
      if (request.method === "POST" && url.pathname === "/api/workspaces/pick") {
        this.adapter.assertIdle();
        const path = await this.#directoryPicker();
        if (!path) return json(response, 200, { cancelled: true });
        await this.disposeAdapters();
        const workspace = await this.#workspaceService.select(path, false);
        this.persistWorkspace();
        this.startWorkspaceMonitor();
        return json(response, 200, { cancelled: false, selectedPath: this.#workspaceService.requireCurrent().path, workspace });
      }
      if (request.method === "POST" && url.pathname === "/api/workspaces/trust") {
        this.adapter.assertIdle();
        const body = await readJson(request);
        await this.disposeAdapters();
        const workspace = await this.#workspaceService.setTrust(body.projectTrusted === true);
        this.persistWorkspace();
        return json(response, 200, workspace);
      }
      if (request.method === "GET" && url.pathname === "/api/workspaces/current") {
        return json(response, 200, await this.#workspaceService.snapshot(url.searchParams.get("runId") ?? undefined));
      }
      if (request.method === "GET" && url.pathname === "/api/workspaces/files") {
        return json(response, 200, { files: await this.#workspaceService.listFiles() });
      }
      if (request.method === "GET" && url.pathname === "/api/workspaces/file") {
        return json(response, 200, {
          path: requiredQuery(url, "path"),
          content: await this.#workspaceService.readText(requiredQuery(url, "path"))
        });
      }
      if (request.method === "GET" && url.pathname === "/api/workspaces/file-view") {
        return json(response, 200, await this.#workspaceService.fileView(requiredQuery(url, "path"), url.searchParams.get("runId") ?? undefined));
      }
      if (request.method === "GET" && url.pathname === "/api/workspaces/preview") {
        return json(response, 200, await this.#workspaceService.preview(requiredQuery(url, "path")));
      }
      if (request.method === "GET" && url.pathname === "/api/workspaces/download") {
        const download = await this.#workspaceService.download(requiredQuery(url, "path"));
        response.writeHead(200, {
          "Content-Type": download.mime,
          "Content-Length": download.size,
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(download.name)}`
        });
        createReadStream(download.target).pipe(response);
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/workspaces/changes") {
        return json(response, 200, { changes: await this.#workspaceService.listChanges() });
      }
      if (request.method === "GET" && url.pathname === "/api/workspaces/diff") {
        return json(response, 200, await this.#workspaceService.diff(url.searchParams.get("path") ?? undefined));
      }
      if (request.method === "GET" && url.pathname === "/api/sessions") {
        return json(response, 200, { sessions: await this.adapter.listSessions(), activeSessionId: this.adapter.activeSessionId });
      }
      if (request.method === "POST" && url.pathname === "/api/sessions") {
        const body = await readJson(request);
        return json(response, 201, await this.adapter.createSession(stringField(body, "name", false)));
      }
      const sessionDelete = matchPath(url.pathname, /^\/api\/sessions\/([^/]+)$/);
      if (request.method === "DELETE" && sessionDelete) {
        return json(response, 200, await this.adapter.deleteSession(decodeURIComponent(sessionDelete[1] ?? "")));
      }
      const sessionOpen = matchPath(url.pathname, /^\/api\/sessions\/([^/]+)\/open$/);
      if (request.method === "POST" && sessionOpen) {
        return json(response, 200, await this.adapter.openSession(decodeURIComponent(sessionOpen[1] ?? "")));
      }
      const sessionClose = matchPath(url.pathname, /^\/api\/sessions\/([^/]+)\/close$/);
      if (request.method === "POST" && sessionClose) {
        return json(response, 200, await this.adapter.closeSession(decodeURIComponent(sessionClose[1] ?? "")));
      }
      const sessionName = matchPath(url.pathname, /^\/api\/sessions\/([^/]+)\/name$/);
      if (request.method === "POST" && sessionName) {
        this.adapter.assertCurrentSession(decodeURIComponent(sessionName[1] ?? ""));
        const body = await readJson(request);
        return json(response, 200, await this.adapter.renameSession(stringField(body, "name", true)));
      }
      const forkPoints = matchPath(url.pathname, /^\/api\/sessions\/([^/]+)\/fork-points$/);
      if (request.method === "GET" && forkPoints) {
        this.adapter.assertCurrentSession(decodeURIComponent(forkPoints[1] ?? ""));
        return json(response, 200, { points: this.adapter.listForkPoints() });
      }
      const sessionCommands = matchPath(url.pathname, /^\/api\/sessions\/([^/]+)\/commands$/);
      if (request.method === "GET" && sessionCommands) {
        this.adapter.assertCurrentSession(decodeURIComponent(sessionCommands[1] ?? ""));
        return json(response, 200, { commands: await this.adapter.listCommands() });
      }
      if (request.method === "POST" && sessionCommands) {
        this.adapter.assertCurrentSession(decodeURIComponent(sessionCommands[1] ?? ""));
        // Base64 adds roughly one third to the original JSONL size. Keep the
        // larger limit isolated to this upload endpoint; every other JSON API
        // retains the 1 MB guardrail.
        const body = await readJson(request, 15_000_000);
        const fileValue = body.file;
        const file = typeof fileValue === "object" && fileValue !== null && !Array.isArray(fileValue)
          ? {
              name: stringField(fileValue as Record<string, unknown>, "name", true),
              content: stringField(fileValue as Record<string, unknown>, "content", true)
            }
          : undefined;
        const argument = stringField(body, "argument", false);
        return json(response, 202, await this.adapter.executeCommand({
          requestId: stringField(body, "requestId", true),
          commandId: stringField(body, "commandId", true),
          ...(argument ? { argument } : {}),
          ...(file ? { file } : {})
        }));
      }
      const sessionFork = matchPath(url.pathname, /^\/api\/sessions\/([^/]+)\/fork$/);
      if (request.method === "POST" && sessionFork) {
        const body = await readJson(request);
        return json(response, 201, await this.adapter.forkSession(stringField(body, "entryId", true)));
      }
      const sessionEvents = matchPath(url.pathname, /^\/api\/sessions\/([^/]+)\/events$/);
      if (request.method === "GET" && sessionEvents) {
        const sessionId = decodeURIComponent(sessionEvents[1] ?? "");
        const after = Number.parseInt(url.searchParams.get("after") ?? "0", 10);
        return json(response, 200, { events: this.#eventStore.listEvents(sessionId, Number.isFinite(after) ? after : 0) });
      }
      const sessionStream = matchPath(url.pathname, /^\/api\/sessions\/([^/]+)\/stream$/);
      if (request.method === "GET" && sessionStream) {
        return this.streamEvents(response, decodeURIComponent(sessionStream[1] ?? ""), request);
      }
      const taskSubmit = matchPath(url.pathname, /^\/api\/sessions\/([^/]+)\/runs$/);
      if (request.method === "POST" && taskSubmit) {
        const body = await readJson(request);
        this.adapter.assertCurrentSession(decodeURIComponent(taskSubmit[1] ?? ""));
        return json(response, 202, await this.adapter.submitTask({
          requestId: stringField(body, "requestId", true),
          text: stringField(body, "text", true)
        }));
      }
      const control = matchPath(url.pathname, /^\/api\/sessions\/([^/]+)\/controls\/(steer|follow-up|interrupt)$/);
      if (request.method === "POST" && control) {
        const body = await readJson(request);
        this.adapter.assertCurrentSession(decodeURIComponent(control[1] ?? ""));
        const requestId = stringField(body, "requestId", true);
        const action = control[2];
        let receipt: CommandReceipt;
        if (action === "steer") receipt = await this.adapter.steer(requestId, stringField(body, "text", true));
        else if (action === "follow-up") receipt = await this.adapter.followUp(requestId, stringField(body, "text", true));
        else receipt = await this.adapter.interrupt(requestId);
        return json(response, 202, receipt);
      }
      if (request.method === "GET" && url.pathname === "/api/acceptance-records") {
        return json(response, 200, { records: mergedAcceptanceRecords(this.#eventStore.listAcceptanceRecords(), this.#acceptanceRecordStore.list()) });
      }
      const toolOutput = matchPath(url.pathname, /^\/api\/tool-outputs\/([^/]+)$/);
      if (request.method === "GET" && toolOutput) {
        const output = await this.#toolOutputStore.open(decodeURIComponent(toolOutput[1] ?? ""));
        response.writeHead(200, {
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Length": output.size,
          "Content-Disposition": "inline"
        });
        output.stream.pipe(response);
        return;
      }
      const commandExport = matchPath(url.pathname, /^\/api\/command-exports\/([^/]+)$/);
      if (request.method === "GET" && commandExport) {
        const output = await this.#commandExportStore.open(decodeURIComponent(commandExport[1] ?? ""));
        response.writeHead(200, {
          "Content-Type": output.contentType,
          "Content-Length": output.size,
          "Content-Disposition": `attachment; filename="${output.fileName}"`
        });
        output.stream.pipe(response);
        return;
      }
      const acceptanceDetail = matchPath(url.pathname, /^\/api\/acceptance-records\/([^/]+)$/);
      if (request.method === "GET" && acceptanceDetail) {
        const id = decodeURIComponent(acceptanceDetail[1] ?? "");
        const record = this.#eventStore.getAcceptanceRecord(id) ?? this.#acceptanceRecordStore.get(id);
        if (!record) throw new BridgeError(404, "acceptance_record_not_found", "找不到该验收记录。", false);
        return json(response, 200, record);
      }
      if (request.method === "GET" && url.pathname === "/api/diagnostics") {
        const capabilities = this.adapter.getCapabilities();
        return json(response, 200, {
          browser: { status: "ready", source: "request" },
          bridge: {
            status: "ready",
            uptimeSeconds: Math.floor((Date.now() - this.#startedAt) / 1000),
            eventSubscribers: this.#eventBus.subscriberCount,
            testInstance: process.env.FF_TEST_INSTANCE === "true"
          },
          adapter: await this.adapter.probe(),
          capabilityDecisions: buildCapabilityDecisions(
            capabilities,
            Boolean(this.#workspaceService.current),
            Boolean(this.adapter.activeSessionId)
          ),
          model: this.adapter.getModelInfo(),
          workspace: this.#workspaceService.current?.info ?? { status: "unselected" },
          git: this.#workspaceService.current
            ? { status: this.#workspaceService.current.info.git ? "ready" : "unavailable", changeCount: (await this.#workspaceService.listChanges()).length }
            : { status: "unselected" }
        });
      }
      if (request.method === "GET" && !url.pathname.startsWith("/api/")) {
        const served = await serveFrontend(url.pathname, response, defaultConfig.projectRoot);
        if (served) return;
      }
      throw new BridgeError(404, "route_not_found", "接口不存在。", false);
    } catch (error) {
      const result = publicError(error);
      json(response, result.status, result.body);
    }
  }

  private streamEvents(response: ServerResponse, sessionId: string, request: IncomingMessage): void {
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    response.write(": connected\n\n");
    const urlAfter = Number.parseInt(new URL(request.url ?? "/", "http://127.0.0.1").searchParams.get("after") ?? "0", 10);
    const rawHeaderAfter = request.headers["last-event-id"];
    const headerAfter = Number.parseInt((Array.isArray(rawHeaderAfter) ? rawHeaderAfter[0] : rawHeaderAfter) ?? "0", 10);
    const after = Math.max(Number.isFinite(urlAfter) ? urlAfter : 0, Number.isFinite(headerAfter) ? headerAfter : 0);
    for (const event of this.#eventStore.listEvents(sessionId, Number.isFinite(after) ? after : 0)) writeSse(response, event);
    const unsubscribe = this.#eventBus.subscribe((event) => {
      if (event.sessionId === sessionId) writeSse(response, event);
    });
    const keepAlive = setInterval(() => response.write(": keepalive\n\n"), 15_000);
    request.once("close", () => {
      clearInterval(keepAlive);
      unsubscribe();
      response.end();
    });
  }

  private persistWorkspace(): void {
    const workspace = this.#workspaceService.persistedCurrent();
    if (workspace) this.#eventStore.setMetadata("current_workspace", workspace);
  }

  private async disposeAdapters(): Promise<void> {
    await Promise.all([...this.#adapters.values()].map(async (adapter) => await adapter.dispose()));
  }

  private startWorkspaceMonitor(): void {
    const current = this.#workspaceService.current;
    if (!current) return;
    this.#workspaceMonitor.start(current.path, async () => {
      await this.adapter.notifyWorkspaceChanged().catch(() => undefined);
    });
  }
}

function buildCapabilityDecisions(
  capabilities: CapabilitySet,
  workspaceReady: boolean,
  sessionReady: boolean
): CapabilityDecisionSet {
  const unavailable = new Set<keyof CapabilitySet>(["approvals", "sandbox"]);
  return Object.fromEntries((Object.keys(capabilities) as Array<keyof CapabilitySet>).map((key) => {
    const productAvailability = !unavailable.has(key);
    const userPermission = !productAvailability
      ? false
      : key === "structuredEvents" ? true
        : key === "resumableSessions" ? workspaceReady
          : sessionReady;
    return [key, { runtimeCapability: capabilities[key], productAvailability, userPermission }];
  })) as CapabilityDecisionSet;
}

function json(response: ServerResponse, status: number, body: unknown): void {
  if (response.headersSent) return;
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage, maxBytes = 1_000_000): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new BridgeError(413, "request_too_large", `请求体超过 ${Math.ceil(maxBytes / 1_000_000)} MB。`, false);
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("not object");
    return value as Record<string, unknown>;
  } catch {
    throw new BridgeError(400, "invalid_json", "请求内容不是有效 JSON。", false);
  }
}

function stringField(body: Record<string, unknown>, name: string, required: true): string;
function stringField(body: Record<string, unknown>, name: string, required: false): string | undefined;
function stringField(body: Record<string, unknown>, name: string, required: boolean): string | undefined {
  const value = body[name];
  if (typeof value === "string" && value.trim()) return value.trim();
  if (required) throw new BridgeError(400, "missing_field", `缺少字段：${name}。`, false);
  return undefined;
}

function requiredQuery(url: URL, name: string): string {
  const value = url.searchParams.get(name);
  if (!value) throw new BridgeError(400, "missing_query", `缺少查询参数：${name}。`, false);
  return value;
}

function matchPath(pathname: string, pattern: RegExp): RegExpMatchArray | null {
  return pathname.match(pattern);
}

function mergedAcceptanceRecords(...groups: AcceptanceRecord[][]): AcceptanceRecord[] {
  return [...new Map(groups.flat().map((record) => [record.id, record])).values()]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function writeSse(response: ServerResponse, event: HarnessEvent): void {
  response.write(`id: ${event.sequence}\ndata: ${JSON.stringify(event)}\n\n`);
}

function setSecurityHeaders(response: ServerResponse): void {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Content-Security-Policy", "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'");
}

function assertLocalAuthority(request: IncomingMessage): void {
  const host = request.headers.host;
  if (!host || !isLoopbackAuthority(host)) {
    throw new BridgeError(403, "invalid_host", "本地服务拒绝了非本机来源。", false);
  }
  const origin = request.headers.origin;
  if (origin) {
    let originUrl: URL;
    try {
      originUrl = new URL(origin);
    } catch {
      throw new BridgeError(403, "invalid_origin", "本地服务拒绝了无效来源。", false);
    }
    const samePort = normalizedPort(originUrl) === normalizedAuthorityPort(host);
    const developmentOrigin = originUrl.protocol === "http:" && normalizedPort(originUrl) === "4173";
    if (originUrl.protocol !== "http:" || !isLoopbackAuthority(originUrl.host) || (!samePort && !developmentOrigin)) {
      throw new BridgeError(403, "invalid_origin", "本地服务拒绝了非本机来源。", false);
    }
  }
}

function normalizedPort(url: URL): string {
  return url.port || (url.protocol === "https:" ? "443" : "80");
}

function normalizedAuthorityPort(authority: string): string {
  return normalizedPort(new URL(`http://${authority}`));
}

function isLoopbackAuthority(authority: string): boolean {
  try {
    const hostname = new URL(`http://${authority}`).hostname.toLowerCase();
    return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
  } catch {
    return false;
  }
}

async function serveFrontend(pathname: string, response: ServerResponse, projectRoot: string): Promise<boolean> {
  const root = join(projectRoot, "frontend", "dist");
  const candidate = pathname === "/" ? join(root, "index.html") : resolve(root, `.${pathname}`);
  if (!isPathWithin(root, candidate)) return false;
  const selected = await stat(candidate).then((entry) => entry.isFile() ? candidate : join(root, "index.html")).catch(() => join(root, "index.html"));
  const metadata = await stat(selected).catch(() => undefined);
  if (!metadata?.isFile()) return false;
  response.writeHead(200, { "Content-Type": contentType(selected) });
  createReadStream(selected).pipe(response);
  return true;
}

function isPathWithin(root: string, target: string): boolean {
  const path = relative(resolve(root), resolve(target));
  return path === "" || (!path.startsWith("..") && !path.startsWith(sep));
}

function contentType(path: string): string {
  if (path.endsWith(".html")) return "text/html; charset=utf-8";
  if (path.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (path.endsWith(".css")) return "text/css; charset=utf-8";
  if (path.endsWith(".svg")) return "image/svg+xml";
  if (path.endsWith(".png")) return "image/png";
  return "application/octet-stream";
}

export function isDirectExecution(metaUrl: string): boolean {
  return process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(metaUrl));
}
