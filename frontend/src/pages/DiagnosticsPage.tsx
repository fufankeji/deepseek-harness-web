import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { motion } from "motion/react";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Clipboard,
  ClipboardCheck,
  Code2,
  Database,
  FileClock,
  FileJson,
  GitBranch,
  Network,
  RefreshCw,
  ShieldAlert,
  TerminalSquare,
  Wrench
} from "lucide-react";
import { AppShell } from "../components/AppShell";
import { ThemeSelect } from "../components/ThemeSelect";
import { useAppSelector } from "../app/hooks";
import {
  useGetAcceptanceRecordsQuery,
  useGetDiagnosticsQuery,
  useGetEventsQuery,
  useGetSessionsQuery
} from "../api/bridge-api";
import type { AcceptanceRecord, CapabilitySet, DiagnosticSnapshot, HarnessEvent } from "../api/contracts";
import type { DiagnosticItem } from "../contracts/view-model";
import styles from "./DiagnosticsPage.module.css";

type DiagnosticView = "layers" | "capabilities" | "events" | "acceptance";

export function DiagnosticsPage() {
  const harness = useAppSelector((state) => state.harness);
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedView = searchParams.get("view");
  const initialView: DiagnosticView = requestedView === "acceptance" || requestedView === "events" || requestedView === "capabilities" ? requestedView : "layers";
  const [view, setViewState] = useState<DiagnosticView>(initialView);
  const [selected, setSelected] = useState("bridge");
  const [copyState, setCopyState] = useState<"idle" | "done" | "error">("idle");
  const diagnosticsQuery = useGetDiagnosticsQuery(undefined, { pollingInterval: 10_000 });
  const recordsQuery = useGetAcceptanceRecordsQuery();
  const hasWorkspace = diagnosticsQuery.data?.workspace.status === "ready";
  const sessionsQuery = useGetSessionsQuery(undefined, { skip: diagnosticsQuery.isSuccess && !hasWorkspace });
  const eventSessionId = searchParams.get("session") || harness.selectedSessionId || sessionsQuery.data?.sessions[0]?.id || "";
  const eventRunId = searchParams.get("run") || undefined;
  const eventsQuery = useGetEventsQuery(eventSessionId, { skip: !eventSessionId });
  const layers = useMemo(() => diagnosticLayers(diagnosticsQuery.data, diagnosticsQuery.isError), [diagnosticsQuery.data, diagnosticsQuery.isError]);
  const selectedItem = layers.find((item) => item.id === selected) ?? layers[0]!;

  useEffect(() => {
    const next = searchParams.get("view");
    if (next === "acceptance" || next === "events" || next === "capabilities" || next === "layers") setViewState(next);
  }, [searchParams]);

  const setView = (next: DiagnosticView) => {
    setViewState(next);
    if (next === "acceptance") setSearchParams({ view: "acceptance" });
    else setSearchParams({});
  };

  const copyDiagnostics = async () => {
    const snapshot = JSON.stringify(sanitizedDiagnosticSnapshot(diagnosticsQuery.data, layers), null, 2);
    try {
      await navigator.clipboard.writeText(snapshot);
      setCopyState("done");
    } catch {
      setCopyState("error");
    }
  };

  return (
    <AppShell connection={harness.connection} compactHeader>
      <div className={styles.page}>
        <header className={styles.pageHeader}>
          <div>
            <Link to="/workbench"><ArrowLeft size={16} /> 返回工作台</Link>
            <h1>运行诊断</h1>
            <p>区分 Browser、Bridge、Adapter、Harness、DeepSeek 与 Git 的真实状态来源。</p>
          </div>
          <div className={styles.headerActions}>
            <button onClick={() => void Promise.all([diagnosticsQuery.refetch(), recordsQuery.refetch(), eventsQuery.refetch()])} disabled={diagnosticsQuery.isFetching}><RefreshCw className={diagnosticsQuery.isFetching ? styles.spinning : ""} size={16} />{diagnosticsQuery.isFetching ? "正在探测" : "重新探测"}</button>
            <button onClick={() => void copyDiagnostics()}><Clipboard size={16} />{copyState === "done" ? "已复制" : copyState === "error" ? "复制失败" : "复制脱敏诊断"}</button>
          </div>
        </header>

        <section className={styles.summaryGrid}>
          <SummaryCard icon={<Activity />} label="浏览器应用" value="正常" tone="success" detail="React 19.2 · Vite 8.2" />
          <SummaryCard icon={<TerminalSquare />} label="Local Bridge" value={diagnosticsQuery.data ? "已连接" : diagnosticsQuery.isFetching ? "探测中" : "不可用"} tone={diagnosticsQuery.data ? "success" : diagnosticsQuery.isFetching ? "warning" : "unknown"} detail={bridgeDetail(diagnosticsQuery.data)} />
          <SummaryCard icon={<Code2 />} label="Harness Runtime" value={runtimeLabel(diagnosticsQuery.data?.adapter.status)} tone={diagnosticsQuery.data?.adapter.status === "ready" ? "success" : "unknown"} detail={diagnosticsQuery.data ? `${diagnosticsQuery.data.adapter.harnessId} ${diagnosticsQuery.data.adapter.harnessVersion} · Adapter 接入` : "等待运行时探测"} />
          <SummaryCard icon={<GitBranch />} label="Git 事实源" value={gitStatus(diagnosticsQuery.data)} tone={diagnosticsQuery.data?.git.status === "ready" ? "success" : "unknown"} detail={gitDetail(diagnosticsQuery.data)} />
        </section>

        <nav className={styles.viewTabs} aria-label="诊断视图">
          <button className={view === "layers" ? styles.activeView : ""} onClick={() => setView("layers")}><Network size={16} />诊断层级</button>
          <button className={view === "capabilities" ? styles.activeView : ""} onClick={() => setView("capabilities")}><Wrench size={16} />能力矩阵</button>
          <button className={view === "events" ? styles.activeView : ""} onClick={() => setView("events")}><FileClock size={16} />原始事件</button>
          <button className={view === "acceptance" ? styles.activeView : ""} onClick={() => setView("acceptance")}><ClipboardCheck size={16} />验收记录 <span>{recordsQuery.data?.records.length ?? 0}</span></button>
        </nav>

        {view === "layers" && <div className={styles.contentGrid}>
          <section className={styles.layerList}>
            <header><h2>诊断层级</h2><button onClick={() => void diagnosticsQuery.refetch()} disabled={diagnosticsQuery.isFetching}><RefreshCw className={diagnosticsQuery.isFetching ? styles.spinning : ""} size={15} />{diagnosticsQuery.isFetching ? "正在探测" : "重新探测"}</button></header>
            {layers.map((item) => (
              <button key={item.id} className={selected === item.id ? styles.selectedItem : ""} onClick={() => setSelected(item.id)}>
                <span className={`${styles.statusDot} ${styles[item.status]}`} />
                <span><strong>{item.layer}</strong><small>{item.label}</small></span>
                <em>{statusLabel(item.status)}</em><ChevronRight size={15} />
              </button>
            ))}
          </section>

          <motion.section key={selectedItem.id} className={styles.detailPanel} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }}>
            <div className={styles.detailHeader}>
              <span className={`${styles.detailIcon} ${styles[selectedItem.status]}`}>{layerIcon(selectedItem.layer)}</span>
              <div><small>{selectedItem.layer}</small><h2>{selectedItem.label}</h2></div>
              <em>{statusLabel(selectedItem.status)}</em>
            </div>
            <div className={styles.messageBox}>
              {selectedItem.status === "ready" ? <CheckCircle2 size={20} /> : <AlertTriangle size={20} />}
              <div><strong>{selectedItem.detail}</strong><p>{detailCopy(selectedItem.id)}</p></div>
            </div>
            <div className={styles.factGrid}>
              <Fact label="状态来源" value={sourceLabel(selectedItem.id)} />
              <Fact label="最后确认" value={lastChecked(selectedItem.id, diagnosticsQuery.data)} />
              <Fact label="可自动重试" value={selectedItem.id === "model" ? "按 Provider 错误决定" : "是"} />
              <Fact label="敏感信息" value="已排除" />
            </div>
            <div className={styles.eventPreview}>
              <header><FileJson size={15} />脱敏状态快照<span>只读</span></header>
              <pre>{JSON.stringify(safeLayerSnapshot(selectedItem, diagnosticsQuery.data), null, 2)}</pre>
            </div>
            <div className={styles.securityNote}><ShieldAlert size={17} /><div><strong>诊断包不包含 API Key、完整 Prompt、私有源码或绝对用户路径</strong><p>复制时只保留版本、状态、能力和计数。</p></div></div>
          </motion.section>
        </div>}

        {view === "capabilities" && <CapabilityMatrix decisions={diagnosticsQuery.data?.capabilityDecisions} runtimeName={diagnosticsQuery.data?.adapter.displayName} />}
        {view === "events" && <RawEvents events={eventsQuery.data?.events ?? harness.events} sessionId={eventSessionId} runId={eventRunId} />}
        {view === "acceptance" && <AcceptanceRecords records={recordsQuery.data?.records ?? []} loading={recordsQuery.isFetching} onInspectEvents={(record) => { setViewState("events"); setSearchParams({ view: "events", session: record.sessionId, run: record.runId }); }} />}
      </div>
    </AppShell>
  );
}

function SummaryCard({ icon, label, value, tone, detail }: { icon: ReactNode; label: string; value: string; tone: string; detail: string }) {
  return <motion.div className={styles.summaryCard} whileHover={{ y: -2 }}><span className={styles[tone]}>{icon}</span><div><small>{label}</small><strong>{value}</strong><p>{detail}</p></div></motion.div>;
}

const capabilityRows: Array<{ key: keyof CapabilitySet; name: string; evidence: string }> = [
  { key: "structuredEvents", name: "结构化事件", evidence: "统一事件归约" },
  { key: "resumableSessions", name: "可恢复会话", evidence: "Harness Session + SQLite" },
  { key: "sessionFork", name: "会话分叉", evidence: "用户消息分叉点" },
  { key: "steering", name: "运行中引导", evidence: "steer 控制回执" },
  { key: "followUp", name: "后续任务队列", evidence: "follow-up 控制回执" },
  { key: "interrupt", name: "中断", evidence: "clearQueue + abort + settled" },
  { key: "tools", name: "工具调用", evidence: "Read / Edit / Write / Bash" },
  { key: "compaction", name: "上下文压缩", evidence: "只在真实事件出现时观察" },
  { key: "retry", name: "自动重试", evidence: "只在真实事件出现时观察" },
  { key: "approvals", name: "逐命令审批", evidence: "按运行时探测；当前 Web 尚未开放交互" },
  { key: "sandbox", name: "内置沙箱", evidence: "按运行时探测；与 Project Trust 分开呈现" }
];

function CapabilityMatrix({ decisions, runtimeName }: { decisions: DiagnosticSnapshot["capabilityDecisions"] | undefined; runtimeName: string | undefined }) {
  return (
    <motion.section className={styles.capabilityPanel} initial={{ y: 5 }} animate={{ y: 0 }}>
      <header><div><h2>当前能力矩阵</h2><p>运行时能力、产品开放状态与证据来源分别呈现。</p></div><span>{runtimeName ?? "Harness 尚未探测"}</span></header>
      <div className={styles.capabilityHead}><span>能力</span><span>运行时</span><span>产品</span><span>当前权限</span><span>证据</span></div>
      {capabilityRows.map((row) => {
        const decision = decisions?.[row.key];
        const runtime = decision?.runtimeCapability ?? "unknown";
        return <div className={styles.capabilityRow} key={row.key}><strong>{row.name}</strong><span className={runtime === true ? styles.supported : runtime === false ? styles.unsupported : styles.uncertain}>{capabilityLabel(runtime)}</span><span>{decision?.productAvailability === true ? "已开放" : decision?.productAvailability === false ? "未开放" : "待确认"}</span><span>{decision ? capabilityLabel(decision.userPermission) : "待确认"}</span><small>{row.evidence}</small></div>;
      })}
      <footer><ShieldAlert size={16} />“待确认”不会自动提升为支持；Harness 版本升级后按同一能力合同重新探测。</footer>
    </motion.section>
  );
}

function RawEvents({ events, sessionId, runId }: { events: HarnessEvent[]; sessionId: string; runId: string | undefined }) {
  const [kindFilter, setKindFilter] = useState("all");
  const kinds = [...new Set(events.map((item) => item.kind))].sort();
  const ordered = [...events]
    .filter((item) => !runId || item.runId === runId)
    .filter((item) => kindFilter === "all" || item.kind === kindFilter)
    .sort((left, right) => right.sequence - left.sequence);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const event = ordered.find((item) => item.id === selectedId) ?? ordered[0];
  return (
    <motion.section className={styles.eventsPanel} initial={{ y: 5 }} animate={{ y: 0 }}>
      <div className={styles.eventList}>
        <header><div><h2>原始事件</h2><p>{sessionId ? `Session ${sessionId.slice(0, 8)}${runId ? ` · Run ${runId.slice(0, 8)}` : ""} · 已脱敏` : "尚未选择会话"}</p></div><span>{ordered.length}</span></header>
        <div className={styles.eventFilter}><label htmlFor="event-kind-filter">事件类型</label><ThemeSelect id="event-kind-filter" value={kindFilter} onValueChange={(value) => { setKindFilter(value); setSelectedId(null); }} options={[{ value: "all", label: "全部事件" }, ...kinds.map((kind) => ({ value: kind, label: kind }))]} /></div>
        {ordered.map((item) => <button className={item.id === event?.id ? styles.selectedEvent : ""} key={item.id} onClick={() => setSelectedId(item.id)}><em>#{item.sequence}</em><span><strong>{item.kind}</strong><small>{item.source}</small></span><ChevronRight size={15} /></button>)}
        {ordered.length === 0 && <div className={styles.eventsEmpty}>当前会话还没有统一事件。</div>}
      </div>
      <div className={styles.eventDetail}>
        <header><FileJson size={16} /><strong>{event ? `事件 #${event.sequence}` : "事件详情"}</strong><span>只读 · 脱敏</span></header>
        {event ? <><div className={styles.eventMeta}><Fact label="统一类型" value={event.kind} /><Fact label="事实来源" value={event.source} /><Fact label="运行代次" value={String(event.runtimeGeneration)} /><Fact label="更新语义" value={event.updateMode ?? "不可变事件"} /></div><pre>{JSON.stringify(sanitizeEventForDisplay(event), null, 2)}</pre></> : <div className={styles.eventsEmpty}>运行任务后，这里会显示 Bridge 持久化的真实事件。</div>}
        <p><ShieldAlert size={15} />诊断视图只显示结构元数据；完整 Prompt、源码、工具输出和绝对路径不在这里展开。</p>
      </div>
    </motion.section>
  );
}

function AcceptanceRecords({ records, loading, onInspectEvents }: { records: AcceptanceRecord[]; loading: boolean; onInspectEvents: (record: AcceptanceRecord) => void }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const record = records.find((item) => item.id === selectedId) ?? records[0];
  return (
    <motion.section className={styles.acceptancePanel} initial={{ y: 5 }} animate={{ y: 0 }}>
      <div className={styles.acceptanceList}>
        <header><div><h2>内置验收记录</h2><p>真实 Harness + DeepSeek 运行产生，工作区与证据持续保留</p></div><span>{records.length}</span></header>
        {records.map((item) => <button key={item.id} className={record?.id === item.id ? styles.selectedAcceptance : ""} onClick={() => setSelectedId(item.id)}><span className={`${styles.acceptanceState} ${item.passed ? styles.acceptancePassed : ""}`}>{item.passed ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}</span><span><strong>{item.workspaceTemplateVersion}</strong><small>{formatTime(item.createdAt)} · {item.modelId}</small><em>{item.features.length} 项功能 · {item.eventCount} 个事件</em></span><ChevronRight size={15} /></button>)}
        {!loading && records.length === 0 && <div className={styles.acceptanceEmpty}>尚无验收记录。请在首次设置中创建“内置验收工作区”，完成一次真实任务。</div>}
        {loading && records.length === 0 && <div className={styles.acceptanceEmpty}>正在读取验收记录…</div>}
      </div>
      <div className={styles.acceptanceDetail}>
        {record ? <>
          <header><div><ClipboardCheck size={19} /><span><small>真实运行证据</small><strong>{record.workspaceTemplateVersion}</strong></span></div><em className={!record.passed ? styles.acceptanceFailed : ""}>{record.passed ? "验收通过" : "验收未通过"} · {record.finalStatus}</em></header>
          <div className={styles.acceptanceFacts}><Fact label="Adapter" value={`${record.adapterId} ${record.adapterVersion}`} /><Fact label="Harness" value={`${record.harnessId} ${record.harnessVersion}`} /><Fact label="模型" value={record.modelId} /><Fact label="期望 / 实际" value={`${record.expectedFinalStatus} / ${record.finalStatus}`} /><Fact label="Session" value={record.sessionId.slice(0, 12)} /><Fact label="Run" value={record.runId.slice(0, 12)} /></div>
          <section><h3>已触发功能</h3><div className={styles.chipList}>{record.features.map((item) => <span key={item}>{item}</span>)}</div></section>
          <section><h3>统一事件索引</h3><p><strong>范围：</strong>#{record.eventSequence.first} – #{record.eventSequence.last} · {record.eventCount} 个事件</p><div className={styles.chipList}>{record.eventKinds.map((item) => <span key={item}>{item}</span>)}</div><button className={styles.evidenceLink} onClick={() => onInspectEvents(record)}>查看该 Run 的脱敏事件 <ChevronRight size={14} /></button></section>
          <section><h3>工具与文件变化</h3><p><strong>工具：</strong>{record.toolNames.join("、") || "无"}</p><p><strong>文件：</strong>{record.changedFiles.join("、") || "未观察到变化"}</p></section>
          <section className={styles.acceptanceOutput}><h3>{record.verification.command ?? "独立验证"}</h3><pre>{record.verification.output || "没有文本输出。"}</pre></section>
          <footer><Database size={15} />验收工作区、Session、统一事件、Diff 与本记录均保留在本地数据目录。</footer>
        </> : <div className={styles.acceptanceEmpty}>选择一条记录查看完整证据。</div>}
      </div>
    </motion.section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function diagnosticLayers(snapshot: DiagnosticSnapshot | undefined, failed: boolean): DiagnosticItem[] {
  const adapter = snapshot?.adapter;
  const model = snapshot?.model;
  const workspace = snapshot?.workspace;
  return [
    { id: "browser", layer: "Browser", label: "浏览器应用", status: "ready", detail: "前端路由、状态与渲染正在运行。" },
    { id: "bridge", layer: "Bridge", label: "Local Bridge", status: snapshot ? "ready" : failed ? "error" : "unknown", detail: snapshot ? "HTTP + SSE 本地服务已响应。" : failed ? "无法访问 Local Bridge。" : "正在等待 Bridge 响应。" },
    { id: "adapter", layer: "Adapter", label: adapter ? `${adapter.adapterId} Adapter` : "Harness Adapter", status: runtimeTone(adapter?.status), detail: adapter ? `${adapter.adapterVersion} · Bridge ${adapter.bridgeVersion} · 能力合同已返回。` : "尚未取得 Adapter 探针结果。" },
    { id: "harness", layer: "Harness", label: adapter?.displayName ?? "Harness Runtime", status: runtimeTone(adapter?.status), detail: adapter ? `${adapter.harnessId} ${adapter.harnessVersion} · Node ${adapter.nodeVersion}` : "尚未取得 Harness 运行时事实。" },
    { id: "model", layer: "DeepSeek", label: "DeepSeek 模型连接", status: modelTone(model?.status), detail: model ? `${model.modelId} · ${model.thinkingLevel} · ${model.errorMessage ?? model.status}` : "尚未取得模型连接状态。" },
    { id: "git", layer: "Git", label: "工作区事实", status: snapshot?.git.status === "ready" ? "ready" : workspace?.status === "ready" ? "warning" : "unknown", detail: snapshot?.git.status === "ready" ? `${numberField(snapshot.git, "changeCount")} 个当前变化。` : workspace?.status === "ready" ? "工作区可用，但当前不是 Git 仓库。" : "尚未选择工作区。" }
  ];
}

function sanitizedDiagnosticSnapshot(snapshot: DiagnosticSnapshot | undefined, layers: DiagnosticItem[]) {
  return {
    generatedAt: new Date().toISOString(),
    layers: layers.map(({ id, layer, label, status, detail }) => ({ id, layer, label, status, detail })),
    runtime: snapshot ? { adapterId: snapshot.adapter.adapterId, adapterVersion: snapshot.adapter.adapterVersion, harnessId: snapshot.adapter.harnessId, harnessVersion: snapshot.adapter.harnessVersion, bridgeVersion: snapshot.adapter.bridgeVersion, nodeVersion: snapshot.adapter.nodeVersion, status: snapshot.adapter.status, capabilities: snapshot.adapter.capabilities } : null,
    model: snapshot ? { provider: snapshot.model.provider, modelId: snapshot.model.modelId, thinkingLevel: snapshot.model.thinkingLevel, status: snapshot.model.status, errorCode: snapshot.model.errorCode, errorMessage: snapshot.model.errorMessage, credentialStorage: snapshot.model.credentialStorage } : null,
    workspace: snapshot?.workspace.status === "ready" ? { status: snapshot.workspace.status, git: snapshot.workspace.git, branch: snapshot.workspace.branch, projectTrusted: snapshot.workspace.projectTrusted, fileCount: snapshot.workspace.fileCount, fileScanLimited: snapshot.workspace.fileScanLimited } : { status: "unselected" },
    git: snapshot ? { status: snapshot.git.status, changeCount: numberField(snapshot.git, "changeCount") } : null,
    secrets: "excluded"
  };
}

function safeLayerSnapshot(item: DiagnosticItem, snapshot: DiagnosticSnapshot | undefined) {
  const all = sanitizedDiagnosticSnapshot(snapshot, [item]);
  if (item.id === "adapter" || item.id === "harness") return all.runtime;
  if (item.id === "model") return all.model;
  if (item.id === "git") return all.git;
  if (item.id === "bridge") return { status: item.status, transport: "http+sse", uptimeSeconds: numberField(snapshot?.bridge, "uptimeSeconds"), eventSubscribers: numberField(snapshot?.bridge, "eventSubscribers") };
  return { status: "ready", source: "browser" };
}

function sanitizeEventForDisplay(event: HarnessEvent) {
  const payload = event.payload;
  const safePayload = Object.fromEntries(Object.entries(payload).filter(([key]) => !/(text|output|args|details|path|command|prompt|content|message)/i.test(key)));
  return { id: event.id, sequence: event.sequence, kind: event.kind, sessionId: event.sessionId, runId: event.runId, runtimeGeneration: event.runtimeGeneration, source: event.source, timestamp: event.timestamp, updateMode: event.updateMode, payload: safePayload, raw: event.raw ? sanitizeDiagnosticValue(event.raw) : null };
}

function sanitizeDiagnosticValue(value: unknown, key = "", depth = 0): unknown {
  if (/(api.?key|authorization|credential|secret|access.?token|refresh.?token|bearer|prompt|content|message|output|args|path|command)/i.test(key)) return "[已排除]";
  if (depth > 4) return "[已截断]";
  if (typeof value === "string") return value.slice(0, 500).replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[已脱敏]");
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((entry) => sanitizeDiagnosticValue(entry, key, depth + 1));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).slice(0, 50).map(([entryKey, entry]) => [entryKey, sanitizeDiagnosticValue(entry, entryKey, depth + 1)]));
  }
  return undefined;
}

function statusLabel(status: string): string {
  return { ready: "正常", warning: "警告", error: "错误", unknown: "未连接" }[status] ?? status;
}

function layerIcon(layer: string) {
  if (layer === "Browser") return <Activity size={20} />;
  if (layer === "Bridge") return <TerminalSquare size={20} />;
  if (layer === "Adapter") return <Database size={20} />;
  if (layer === "Git") return <GitBranch size={20} />;
  return <Code2 size={20} />;
}

function detailCopy(id: string): string {
  if (id === "browser") return "该状态只证明当前 Web 应用可运行。";
  if (id === "bridge") return "该状态来自本次浏览器对 Bridge 的真实请求，不代表模型已经连接。";
  if (id === "adapter" || id === "harness") return "该状态来自当前进程的运行时探针和精确版本检查。";
  if (id === "model") return "模型状态与运行时状态独立；ready 来自真实最小推理验证。";
  return "文件变化由 Bridge 调用 Git 独立读取，不依赖 Assistant 自述。";
}

function sourceLabel(id: string): string {
  return { browser: "浏览器进程", bridge: "Bridge /diagnostics", adapter: "Adapter 探针", harness: "Harness SDK 运行时探针", model: "ModelRuntime", git: "Bridge / Git" }[id] ?? "未知";
}

function lastChecked(id: string, snapshot: DiagnosticSnapshot | undefined): string {
  if (!snapshot) return "尚未确认";
  const value = id === "model" ? snapshot.model.checkedAt : id === "git" && snapshot.workspace.status === "ready" ? snapshot.workspace.checkedAt : snapshot.adapter.checkedAt;
  return value ? formatTime(value) : "本次请求";
}

function runtimeTone(status: string | undefined): DiagnosticItem["status"] {
  return status === "ready" ? "ready" : status === "error" || status === "incompatible" ? "error" : "unknown";
}

function modelTone(status: string | undefined): DiagnosticItem["status"] {
  return status === "ready" ? "ready" : status && status !== "unconfigured" && status !== "probing" ? "error" : "unknown";
}

function capabilityLabel(value: true | false | "unknown"): string {
  return value === true ? "支持" : value === false ? "不支持" : "待确认";
}

function runtimeLabel(status: string | undefined): string {
  return status === "ready" ? "已就绪" : status === "probing" ? "探测中" : status === "incompatible" ? "不兼容" : status === "error" ? "错误" : "未连接";
}

function bridgeDetail(snapshot: DiagnosticSnapshot | undefined): string {
  return snapshot ? `HTTP + SSE · 已运行 ${numberField(snapshot.bridge, "uptimeSeconds")} 秒` : "等待本地服务响应";
}

function gitStatus(snapshot: DiagnosticSnapshot | undefined): string {
  return snapshot?.git.status === "ready" ? "已连接" : snapshot?.workspace.status === "ready" ? "非 Git" : "未选择";
}

function gitDetail(snapshot: DiagnosticSnapshot | undefined): string {
  return snapshot?.git.status === "ready" ? `${numberField(snapshot.git, "changeCount")} 个当前变化` : "选择工作区后读取";
}

function numberField(value: Record<string, unknown> | undefined, key: string): number {
  return typeof value?.[key] === "number" ? value[key] : 0;
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}
