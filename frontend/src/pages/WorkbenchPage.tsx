import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { AnimatePresence, motion } from "motion/react";
import { Link, useNavigate } from "react-router";
import {
  AlertTriangle,
  ArrowRight,
  AtSign,
  Bot,
  Braces,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleStop,
  Command,
  Copy,
  Download,
  File,
  FileCode2,
  Files,
  FileText,
  FileUp,
  Filter,
  Folder,
  FolderOpen,
  GitBranch,
  LoaderCircle,
  MessageSquareMore,
  Package,
  Plus,
  RefreshCw,
  Search,
  Send,
  TerminalSquare,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  TriangleAlert,
  X
} from "lucide-react";
import { AppShell } from "../components/AppShell";
import { CodeMirrorDiff } from "../components/CodeMirrorDiff";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { FilePreview } from "../components/FilePreview";
import { SafeMarkdown } from "../components/SafeMarkdown";
import { TextInputDialog } from "../components/TextInputDialog";
import { ThemeTooltip } from "../components/ThemeTooltip";
import { useAppDispatch, useAppSelector } from "../app/hooks";
import { harnessActions } from "../app/store";
import {
  useCreateSessionMutation,
  useCloseSessionMutation,
  useDeleteSessionMutation,
  useExecuteCommandMutation,
  useForkSessionMutation,
  useGetEventsQuery,
  useGetCommandsQuery,
  useGetDiagnosticsQuery,
  useGetFileViewQuery,
  useGetSessionsQuery,
  useGetWorkspaceQuery,
  useLazyGetForkPointsQuery,
  useOpenSessionMutation,
  useRenameSessionMutation,
  useSendControlMutation,
  useSubmitRunMutation
} from "../api/bridge-api";
import { connectSessionEvents } from "../api/event-stream";
import { bridgeErrorMessage } from "../api/error-message";
import type { CapabilityDecision, HarnessCommand } from "../api/contracts";
import type { FileNode, RunStatus, SessionSummary, ToolStep } from "../contracts/view-model";
import { summarizeHistoricalRuns } from "./history";
import { filterCommandOptions, filterSlashCommands, parseSlashDraft, resolveSlashDraft } from "./slash-commands";
import styles from "./WorkbenchPage.module.css";

export function WorkbenchPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const harness = useAppSelector((state) => state.harness);
  const [search, setSearch] = useState("");
  const commandPendingRef = useRef(false);
  const controlRetryRef = useRef<{ action: "steer" | "follow-up"; text: string; requestId: string } | null>(null);
  const interruptRetryRef = useRef<string | null>(null);
  const [commandPending, setCommandPending] = useState(false);
  const commandRetryRef = useRef<{ signature: string; requestId: string } | null>(null);
  const [commandFeedback, setCommandFeedback] = useState<CommandFeedback | null>(null);
  const workspaceQuery = useGetWorkspaceQuery(harness.currentRunId ?? undefined, { pollingInterval: 5_000, skipPollingIfUnfocused: true });
  const sessionsQuery = useGetSessionsQuery(undefined, { pollingInterval: 5_000, skipPollingIfUnfocused: true });
  const eventsQuery = useGetEventsQuery(harness.selectedSessionId, { skip: !harness.selectedSessionId });
  const commandsQuery = useGetCommandsQuery(harness.selectedSessionId, { skip: !harness.selectedSessionId });
  const diagnosticsQuery = useGetDiagnosticsQuery();
  const [submitRun] = useSubmitRunMutation();
  const [sendControl] = useSendControlMutation();
  const [executeCommand] = useExecuteCommandMutation();

  useEffect(() => {
    setCommandFeedback(null);
    commandRetryRef.current = null;
  }, [harness.selectedSessionId]);

  useEffect(() => {
    if (workspaceQuery.data) dispatch(harnessActions.hydrateWorkspace(workspaceQuery.data));
  }, [dispatch, workspaceQuery.data]);

  useEffect(() => {
    if (!workspaceQuery.data) return;
    if (sessionsQuery.data) dispatch(harnessActions.restoreActiveSession({
      sessions: sessionsQuery.data.sessions,
      activeSessionId: sessionsQuery.data.activeSessionId ?? sessionsQuery.data.sessions[0]?.id ?? null
    }));
  }, [dispatch, sessionsQuery.data, workspaceQuery.data]);

  useEffect(() => {
    if (eventsQuery.data) dispatch(harnessActions.setEvents(eventsQuery.data.events));
  }, [dispatch, eventsQuery.data]);

  useEffect(() => {
    if (!diagnosticsQuery.data) return;
    dispatch(harnessActions.setRuntime(diagnosticsQuery.data.adapter));
    dispatch(harnessActions.setModel(diagnosticsQuery.data.model));
    dispatch(harnessActions.setCapabilityDecisions(diagnosticsQuery.data.capabilityDecisions));
  }, [diagnosticsQuery.data, dispatch]);

  useEffect(() => {
    if (!harness.selectedSessionId) return;
    return connectSessionEvents(harness.selectedSessionId, harness.lastSequence, dispatch);
  // The initial sequence is captured when this Session stream is attached.
  // EventSource then carries Last-Event-ID for its own reconnects; received events
  // must not recreate the connection on every sequence increment.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch, harness.selectedSessionId]);

  const sendComposer = async () => {
    const text = harness.composerDraft.trim();
    if (!text || !harness.selectedSessionId || commandPendingRef.current) return;
    if (text.startsWith("/")) {
      dispatch(harnessActions.showNotice(commandsQuery.isLoading
        ? "正在读取当前 Harness 的命令目录"
        : "请从斜杠命令菜单中确认并执行；未知命令不会发送给模型"));
      return;
    }
    if (harness.connection !== "connected") {
      dispatch(harnessActions.showNotice("连接恢复后才能提交操作"));
      return;
    }
    const controllingActiveRun = harness.runStatus === "running";
    commandPendingRef.current = true;
    setCommandPending(true);
    try {
      if (controllingActiveRun) {
        const action = harness.composerMode === "follow_up" ? "follow-up" : "steer";
        const retry = controlRetryRef.current;
        const requestId = retry?.action === action && retry.text === text ? retry.requestId : crypto.randomUUID();
        controlRetryRef.current = { action, text, requestId };
        const receipt = await sendControl({
          sessionId: harness.selectedSessionId,
          action,
          requestId,
          text
        }).unwrap();
        if (!receipt.accepted) throw new Error(receipt.reason ?? "消息未被接受");
        controlRetryRef.current = null;
        dispatch(harnessActions.setComposerDraft(""));
        dispatch(harnessActions.showNotice(action === "follow-up" ? "后续任务已排队" : "引导已发送"));
        return;
      }
      controlRetryRef.current = null;
      interruptRetryRef.current = null;
      const requestId = harness.pendingRequestId ?? crypto.randomUUID();
      dispatch(harnessActions.beginRun({ text, requestId }));
      const receipt = await submitRun({
        sessionId: harness.selectedSessionId,
        requestId,
        text
      }).unwrap();
      dispatch(harnessActions.applyReceipt(receipt));
    } catch (error) {
      const message = error instanceof Error ? error.message : bridgeErrorMessage(error);
      dispatch(controllingActiveRun ? harnessActions.showNotice(message) : harnessActions.commandFailed(message));
    } finally {
      commandPendingRef.current = false;
      setCommandPending(false);
    }
  };

  const runSlashCommand = async (command: HarnessCommand, argument = "", file?: { name: string; content: string }) => {
    if (!harness.selectedSessionId || commandPendingRef.current) return;
    if (harness.connection !== "connected") {
      dispatch(harnessActions.showNotice("连接恢复后才能执行命令"));
      return;
    }
    const signature = [harness.selectedSessionId, command.id, argument, file?.name ?? "", file?.content.length ?? 0, file?.content.slice(0, 32) ?? ""].join("\u0000");
    const retry = commandRetryRef.current;
    const requestId = retry?.signature === signature ? retry.requestId : crypto.randomUUID();
    commandRetryRef.current = { signature, requestId };
    commandPendingRef.current = true;
    setCommandPending(true);
    setCommandFeedback(null);
    if (command.startsRun) dispatch(harnessActions.beginRun({ text: `/${command.name}${argument ? ` ${argument}` : ""}`, requestId }));
    try {
      const result = await executeCommand({
        sessionId: harness.selectedSessionId,
        requestId,
        commandId: command.id,
        ...(argument ? { argument } : {}),
        ...(file ? { file } : {})
      }).unwrap();
      if (!result.accepted) {
        const message = result.reason ?? "命令未被接受";
        if (command.startsRun) dispatch(harnessActions.commandFailed(message));
        else dispatch(harnessActions.showNotice(message));
        setCommandFeedback({ tone: "error", title: `/${command.name} 未执行`, detail: message });
        return;
      }
      commandRetryRef.current = null;
      if (command.startsRun) dispatch(harnessActions.applyReceipt(result));
      else dispatch(harnessActions.setComposerDraft(""));
      const effect = result.effect;
      if (!effect) {
        if (!command.startsRun) setCommandFeedback({ tone: "success", title: `/${command.name} 已完成` });
        return;
      }
      if (effect.type === "session") {
        dispatch(harnessActions.setCurrentSession(effect.session));
        setCommandFeedback({ tone: "success", title: `/${command.name} 已完成`, detail: `当前会话：${effect.session.name}` });
        return;
      }
      if (effect.type === "details") {
        setCommandFeedback({ tone: "success", title: effect.title, data: effect.data });
        return;
      }
      if (effect.type === "clipboard") {
        try {
          await navigator.clipboard.writeText(effect.text);
          setCommandFeedback({ tone: "success", title: "最后一条回复已复制" });
        } catch {
          setCommandFeedback({ tone: "error", title: "浏览器未授予剪贴板权限", detail: "请在浏览器地址栏中允许此站点访问剪贴板后重试。" });
        }
        return;
      }
      if (effect.type === "download") {
        const link = document.createElement("a");
        link.href = effect.url;
        link.download = effect.fileName;
        document.body.append(link);
        link.click();
        link.remove();
        setCommandFeedback({ tone: "success", title: "会话导出已开始", detail: effect.fileName });
        return;
      }
      navigate(effect.path);
    } catch (error) {
      const message = bridgeErrorMessage(error);
      if (command.startsRun) dispatch(harnessActions.commandFailed(message));
      else dispatch(harnessActions.showNotice(message));
      setCommandFeedback({ tone: "error", title: `/${command.name} 执行失败`, detail: message });
    } finally {
      commandPendingRef.current = false;
      setCommandPending(false);
    }
  };

  const interrupt = async () => {
    if (!harness.selectedSessionId || commandPendingRef.current) return;
    if (harness.connection !== "connected") {
      dispatch(harnessActions.showNotice("连接恢复后才能中断任务"));
      return;
    }
    commandPendingRef.current = true;
    setCommandPending(true);
    dispatch(harnessActions.markInterrupting());
    try {
      const requestId = interruptRetryRef.current ?? crypto.randomUUID();
      interruptRetryRef.current = requestId;
      const receipt = await sendControl({
        sessionId: harness.selectedSessionId,
        action: "interrupt",
        requestId
      }).unwrap();
      if (!receipt.accepted) throw new Error(receipt.reason ?? "停止请求未被接受");
      interruptRetryRef.current = null;
    } catch (error) {
      dispatch(harnessActions.interruptFailed());
      dispatch(harnessActions.showNotice(error instanceof Error ? error.message : bridgeErrorMessage(error)));
    } finally {
      commandPendingRef.current = false;
      setCommandPending(false);
    }
  };

  const notify = (message: string) => dispatch(harnessActions.showNotice(message));

  return (
    <AppShell connection={harness.connection} lockContentViewport>
      <div className={styles.workbench}>
        <Group orientation="horizontal" className={styles.panels} defaultLayout={{ dock: 24, center: 47, inspector: 29 }}>
          <Panel id="dock" defaultSize="24%" minSize="260px" maxSize="390px" className={styles.panel}>
            <WorkspaceDock search={search} onSearch={setSearch} changeScope={workspaceQuery.data?.changeScope} onRefresh={() => void Promise.all([workspaceQuery.refetch(), sessionsQuery.refetch()])} />
          </Panel>
          <Separator className={styles.separator}><span /></Separator>
          <Panel id="center" defaultSize="47%" minSize="500px" className={styles.panel}>
            <TaskWorkspace commands={commandsQuery.data?.commands ?? []} commandsLoading={commandsQuery.isLoading || commandsQuery.isFetching} commandsError={commandsQuery.isError} commandFeedback={commandFeedback} commandPending={commandPending} onDismissCommandFeedback={() => setCommandFeedback(null)} onExecuteCommand={(command, argument, file) => void runSlashCommand(command, argument, file)} onInterrupt={() => void interrupt()} onSend={() => void sendComposer()} onNotify={notify} />
          </Panel>
          <Separator className={styles.separator}><span /></Separator>
          <Panel id="inspector" defaultSize="29%" minSize="350px" maxSize="560px" collapsible collapsedSize="0px" className={`${styles.panel} ${harness.inspector === "process" ? styles.compactInspectorPanel : ""}`}>
            <Inspector onRefresh={() => void workspaceQuery.refetch()} />
          </Panel>
        </Group>
      </div>
    </AppShell>
  );
}

function WorkspaceDock({ search, onSearch, changeScope, onRefresh }: { search: string; onSearch: (value: string) => void; changeScope: "run" | "git" | "workspace" | "unavailable" | undefined; onRefresh: () => void }) {
  const dispatch = useAppDispatch();
  const { activeDock, files, sessions, selectedFileId, selectedSessionId, workspace, runStatus, currentRunId } = useAppSelector((state) => state.harness);
  const sessionChangeLocked = isActive(runStatus);
  const [changedOnly, setChangedOnly] = useState(false);
  const [createSession] = useCreateSessionMutation();
  const [openSession] = useOpenSessionMutation();
  const [closeSession] = useCloseSessionMutation();
  const [deleteSession] = useDeleteSessionMutation();
  const [getForkPoints] = useLazyGetForkPointsQuery();
  const [forkSession] = useForkSessionMutation();
  const [deleteTarget, setDeleteTarget] = useState<SessionSummary | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const visibleFiles = useMemo(() => {
    if (search) return files.filter((file) => file.name.toLowerCase().includes(search.toLowerCase()));
    let collapsedDepth: number | null = null;
    return files.filter((file) => {
      if (collapsedDepth !== null && file.depth > collapsedDepth) return false;
      if (collapsedDepth !== null && file.depth <= collapsedDepth) collapsedDepth = null;
      if (file.kind === "folder" && file.expanded === false) collapsedDepth = file.depth;
      return !changedOnly || file.changed || file.kind === "folder";
    });
  }, [changedOnly, files, search]);
  const changedFiles = files.filter((file) => file.changed);
  const visibleSelectedFile = visibleFiles.some((file) => file.id === selectedFileId);

  const newSession = async () => {
    if (sessionChangeLocked) return;
    try {
      const session = await createSession({ name: "新的开发任务" }).unwrap();
      dispatch(harnessActions.setCurrentSession(session));
    } catch (error) {
      dispatch(harnessActions.showNotice(bridgeErrorMessage(error)));
    }
  };

  const chooseSession = async (sessionId: string) => {
    if (sessionId === selectedSessionId || sessionChangeLocked) return;
    try {
      const session = await openSession(sessionId).unwrap();
      dispatch(harnessActions.setCurrentSession(session));
    } catch (error) {
      dispatch(harnessActions.showNotice(bridgeErrorMessage(error)));
    }
  };

  const forkLatest = async () => {
    if (!selectedSessionId || sessionChangeLocked) return;
    try {
      const result = await getForkPoints(selectedSessionId).unwrap();
      const latest = result.points.at(-1);
      if (!latest) throw new Error("当前会话还没有可分叉的用户消息。");
      const session = await forkSession({ sessionId: selectedSessionId, entryId: latest.entryId }).unwrap();
      dispatch(harnessActions.setCurrentSession(session));
    } catch (error) {
      dispatch(harnessActions.showNotice(error instanceof Error ? error.message : bridgeErrorMessage(error)));
    }
  };

  const closeCurrent = async () => {
    if (!selectedSessionId || sessionChangeLocked) return;
    try {
      await closeSession(selectedSessionId).unwrap();
      dispatch(harnessActions.detachSession());
      dispatch(harnessActions.showNotice("会话已结束，历史仍保留并可重新打开"));
    } catch (error) {
      dispatch(harnessActions.showNotice(bridgeErrorMessage(error)));
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget || deletePending || sessionChangeLocked) return;
    const deletingCurrent = deleteTarget.id === selectedSessionId;
    const nextSession = deletingCurrent ? sessions.find((entry) => entry.id !== deleteTarget.id && entry.recoverable) : undefined;
    setDeletePending(true);
    try {
      await deleteSession(deleteTarget.id).unwrap();
      dispatch(harnessActions.removeSession(deleteTarget.id));
      setDeleteTarget(null);
      dispatch(harnessActions.showNotice(deletingCurrent && nextSession ? "会话已永久删除，正在切换到下一会话" : "会话已永久删除"));
      if (nextSession) {
        try {
          const opened = await openSession(nextSession.id).unwrap();
          dispatch(harnessActions.setCurrentSession(opened));
        } catch (error) {
          dispatch(harnessActions.showNotice(`会话已删除，但未能打开下一会话：${bridgeErrorMessage(error)}`));
          return;
        }
      }
    } catch (error) {
      dispatch(harnessActions.showNotice(bridgeErrorMessage(error)));
    } finally {
      setDeletePending(false);
    }
  };

  return (
    <aside className={styles.dock}>
      <div className={styles.dockTabs}>
        <button aria-pressed={activeDock === "sessions"} className={activeDock === "sessions" ? styles.activeTab : ""} onClick={() => dispatch(harnessActions.setActiveDock("sessions"))}><MessageSquareMore size={17} />会话</button>
        <button aria-pressed={activeDock === "files"} className={activeDock === "files" ? styles.activeTab : ""} onClick={() => dispatch(harnessActions.setActiveDock("files"))}><Files size={17} />文件</button>
      </div>
      {activeDock === "files" ? <>
        {sessionChangeLocked
          ? <ThemeTooltip content="任务执行中不可切换工作区" side="bottom"><span className={styles.disabledTooltipTarget}><button className={styles.workspacePicker} aria-label="任务执行中不可切换工作区" disabled><Folder size={16} /><span>{workspace?.name ?? "尚未选择工作区"}</span><ChevronDown size={15} /></button></span></ThemeTooltip>
          : <Link className={styles.workspacePicker} to="/setup"><Folder size={16} /><span>{workspace?.name ?? "尚未选择工作区"}</span><ChevronDown size={15} /></Link>}
        {workspace?.fileScanLimited && <div className={styles.scanLimitNote}><AlertTriangle size={13} />文件列表因目录深度、数量或访问权限仅显示可读取部分</div>}
        <div className={styles.searchRow}><label><Search size={15} /><input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="搜索文件或目录" /></label><button className={changedOnly ? styles.filterActive : ""} aria-label="只看变化文件" aria-pressed={changedOnly} onClick={() => setChangedOnly((value) => !value)}><Filter size={16} /></button></div>
        <div className={styles.fileTree} role="tree" aria-label="代码文件树"><AnimatePresence initial={false}>{visibleFiles.map((file, index) => <FileRow key={file.id} file={file} selected={selectedFileId === file.id} focusable={visibleSelectedFile ? selectedFileId === file.id : index === 0} />)}</AnimatePresence>{visibleFiles.length === 0 && <div className={styles.emptyTree}>没有可显示的文件</div>}</div>
        <section className={styles.changesCard}><header><strong>{currentRunId ? "本轮代码变化" : "当前工作区变化"}</strong><span>{changedFiles.length}</span></header>{changedFiles.map((file) => <button key={file.id} onClick={() => dispatch(harnessActions.selectFile(file.id))}><FileText size={15} /><ThemeTooltip content={file.previousPath ? `${file.previousPath} → ${file.path}` : file.path} side="top"><span>{file.path}</span></ThemeTooltip><em>{changeMark(file)} · {workspace?.git && !currentRunId ? stageLabel(file) : changeLabel(file)}</em></button>)}{changedFiles.length === 0 && <p className={styles.changesEmpty}>{changeScope === "unavailable" ? "这次任务没有保存旧版本，无法还原本轮变化" : currentRunId ? "本轮没有代码变化" : "工作区当前没有变化"}</p>}<footer><button onClick={onRefresh}><RefreshCw size={13} /> 刷新事实</button></footer></section>
      </> : <div className={styles.sessionDock}>
        <div className={styles.sessionDockHeader}>
          <div><strong>最近会话</strong><span>{sessions.length}</span></div>
          {sessionChangeLocked ? <ThemeTooltip content="任务执行中不可切换会话" side="bottom"><span className={styles.compactTooltipTarget}><button className={styles.newSession} aria-label="任务执行中不可切换会话" disabled><Plus size={15} /> 新建会话</button></span></ThemeTooltip> : <button className={styles.newSession} onClick={() => void newSession()}><Plus size={15} /> 新建会话</button>}
        </div>
        <div className={styles.sessionList}>{sessions.map((session) => <div key={session.id} className={styles.sessionRow}><button disabled={sessionChangeLocked && selectedSessionId !== session.id} className={`${styles.sessionItem} ${selectedSessionId === session.id ? styles.selectedSession : ""}`} onClick={() => void chooseSession(session.id)}><span className={`${styles.sessionStatus} ${styles[session.status]}`} /><span><strong>{session.title}</strong><span className={styles.sessionMeta}><small>{session.description}</small><em>{session.updatedAt}</em></span></span></button><ThemeTooltip content={sessionChangeLocked ? "任务执行中不可删除会话" : "删除会话"} side="left"><span className={styles.sessionDeleteTarget}><button className={styles.sessionDeleteButton} aria-label={`删除会话：${session.title}`} disabled={sessionChangeLocked} onClick={() => setDeleteTarget(session)}><Trash2 size={15} /></button></span></ThemeTooltip></div>)}</div>
        <div className={styles.sessionActions}>
          <button className={styles.forkButton} disabled={sessionChangeLocked || !selectedSessionId} onClick={() => void forkLatest()}><GitBranch size={15} /> 从最近用户消息分叉</button>
          <button className={styles.forkButton} disabled={sessionChangeLocked || !selectedSessionId} onClick={() => void closeCurrent()}><CircleStop size={15} /> 结束当前会话</button>
        </div>
        {sessionChangeLocked && <p className={styles.sessionLockNote}>任务运行期间保留当前会话；完成或中断后可切换。</p>}
        <ConfirmDialog open={deleteTarget !== null} title={deleteTarget ? `删除“${deleteTarget.title}”？` : "删除会话？"} description="该会话及其执行历史将从会话列表中永久移除，独立验收记录不受影响。此操作无法撤销。" confirmLabel="永久删除" pending={deletePending} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }} onConfirm={confirmDelete} />
      </div>}
    </aside>
  );
}

function FileRow({ file, selected, focusable }: { file: FileNode; selected: boolean; focusable: boolean }) {
  const dispatch = useAppDispatch();
  const Icon = file.kind === "folder" ? file.expanded ? FolderOpen : Folder : fileIcon(file);
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const items = [...(event.currentTarget.closest('[role="tree"]')?.querySelectorAll<HTMLButtonElement>('[role="treeitem"]') ?? [])];
    const index = items.indexOf(event.currentTarget);
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const next = event.key === "Home" ? items[0]
        : event.key === "End" ? items.at(-1)
          : items[index + (event.key === "ArrowDown" ? 1 : -1)];
      next?.focus();
      return;
    }
    if (file.kind === "folder" && event.key === "ArrowRight" && !file.expanded) {
      event.preventDefault();
      dispatch(harnessActions.toggleFolder(file.id));
    }
    if (file.kind === "folder" && event.key === "ArrowLeft" && file.expanded) {
      event.preventDefault();
      dispatch(harnessActions.toggleFolder(file.id));
    }
  };
  return <motion.button layout="position" initial={{ opacity: 0, height: 0, x: -4 }} animate={{ opacity: 1, height: 28, x: 0 }} exit={{ opacity: 0, height: 0, x: -4 }} transition={{ duration: 0.16, ease: "easeOut" }} className={`${styles.fileRow} ${selected ? styles.selectedFile : ""}`} style={{ paddingLeft: `${12 + file.depth * 20}px` }} role="treeitem" aria-selected={selected} aria-expanded={file.kind === "folder" ? file.expanded : undefined} tabIndex={focusable ? 0 : -1} onKeyDown={handleKeyDown} onClick={() => dispatch(file.kind === "folder" ? harnessActions.toggleFolder(file.id) : harnessActions.selectFile(file.id))}>{file.kind === "folder" ? file.expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} /> : <span className={styles.treeSpacer} />}<Icon size={15} /><span>{file.name}</span>{file.changed && <ThemeTooltip content={stageLabel(file)} side="top"><em>{changeMark(file)}{file.staged ? "S" : ""}{file.unstaged ? "W" : ""}</em></ThemeTooltip>}</motion.button>;
}

interface CommandFeedback {
  tone: "success" | "error";
  title: string;
  detail?: string;
  data?: Record<string, unknown>;
}

interface CommandWorkspaceProps {
  commands: HarnessCommand[];
  commandsLoading: boolean;
  commandsError: boolean;
  commandFeedback: CommandFeedback | null;
  commandPending: boolean;
  onDismissCommandFeedback: () => void;
  onExecuteCommand: (command: HarnessCommand, argument?: string, file?: { name: string; content: string }) => void;
  onInterrupt: () => void;
  onSend: () => void;
  onNotify: (message: string) => void;
}

function TaskWorkspace({ commands, commandsLoading, commandsError, commandFeedback, commandPending, onDismissCommandFeedback, onExecuteCommand, onInterrupt, onSend, onNotify }: CommandWorkspaceProps) {
  const dispatch = useAppDispatch();
  const harness = useAppSelector((state) => state.harness);
  const session = harness.sessions.find((item) => item.id === harness.selectedSessionId);
  const [renameSession] = useRenameSessionMutation();
  const [renameOpen, setRenameOpen] = useState(false);
  const [renamePending, setRenamePending] = useState(false);
  const terminal = ["completed", "failed", "cancelled", "unknown"].includes(harness.runStatus);
  const active = isActive(harness.runStatus);
  const assistantText = harness.assistantText || assistantStatusCopy(harness.runStatus);
  const historicalRuns = useMemo(() => summarizeHistoricalRuns(harness.events, harness.currentRunId), [harness.currentRunId, harness.events]);

  const rename = async (name: string) => {
    if (!session || renamePending) return;
    setRenamePending(true);
    try {
      const updated = await renameSession({ sessionId: session.id, name }).unwrap();
      dispatch(harnessActions.setCurrentSession(updated));
      setRenameOpen(false);
    } catch (error) {
      dispatch(harnessActions.showNotice(bridgeErrorMessage(error)));
    } finally {
      setRenamePending(false);
    }
  };

  return <section className={`${styles.taskArea} ${active ? styles.taskAreaActive : ""} ${terminal ? styles.taskAreaTerminal : ""}`}>
    <header className={styles.taskHeader}><div><h1>{session?.title ?? "尚未创建会话"} {session && <button aria-label="编辑任务标题" onClick={() => setRenameOpen(true)}><FileText size={14} /></button>}</h1><p>{session?.description ?? "请先完成首次设置并创建会话"}</p></div><RunPill status={harness.runStatus} /></header>
    <div className={styles.timeline}>{harness.runStatus === "idle" && !harness.currentPrompt ? <motion.div className={styles.emptyConversation} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}><div className={styles.emptyOrbit} aria-hidden="true"><i /><i /><i /></div><span><Bot size={24} /></span><h2>准备开始新的开发任务</h2><p className={styles.emptyDescription}><span>描述你希望 Harness 完成的修改。</span><span>代码树、执行过程与文件变化将在同一工作台持续可见。</span></p><div className={styles.emptyFlow}><span>理解任务</span><i /><span>操作代码</span><i /><span>验证结果</span></div></motion.div> : <>{historicalRuns.length > 0 && <section className={styles.historyBlock}><header><strong>较早的任务</strong><span>{historicalRuns.length} 次</span></header>{historicalRuns.map((run) => <details key={run.id}><summary><span>{run.prompt}</span><em>{runStatusLabel(run.status)}</em></summary><SafeMarkdown content={run.assistant || "该任务没有可展示的最终说明。"} /><small>事件 #{run.firstSequence}–#{run.lastSequence} · {run.toolCount} 次工具调用</small></details>)}</section>}<div className={styles.userRequest}><span>你</span><p>{harness.currentPrompt || "已恢复最近一次任务"}</p></div><motion.div className={styles.assistantBlock} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}><span className={styles.botAvatar}><Bot size={20} /></span><div className={styles.assistantContent}>{harness.thinkingText && active && <div className={styles.liveThinking}><LoaderCircle className={styles.spinner} size={13} /> DeepSeek 正在分析 · 已接收 {harness.thinkingText.length} 字推理流</div>}{(harness.tools.length > 0 || terminal) && <ExecutionSummary tools={harness.tools} terminal={terminal} status={harness.runStatus} changeCount={harness.files.filter((file) => file.changed).length} />}{assistantText && <SafeMarkdown className={styles.assistantMarkdown} content={assistantText} />}{terminal && <div className={styles.feedback}><button aria-label="有帮助" onClick={() => onNotify("已记录：本次回答有帮助")}><ThumbsUp size={16} /></button><button aria-label="没有帮助" onClick={() => onNotify("已记录反馈，可继续补充要求")}><ThumbsDown size={16} /></button><button aria-label="复制回答" onClick={() => void navigator.clipboard.writeText(assistantText).then(() => onNotify("Assistant 说明已复制")).catch(() => onNotify("浏览器未授予剪贴板权限"))}><Copy size={16} /></button></div>}</div></motion.div></>}</div>
    <Composer active={active} terminal={terminal} commands={commands} commandsLoading={commandsLoading} commandsError={commandsError} commandFeedback={commandFeedback} commandPending={commandPending} onDismissCommandFeedback={onDismissCommandFeedback} onExecuteCommand={onExecuteCommand} onInterrupt={onInterrupt} onSend={onSend} onNotify={onNotify} />
    {session && <TextInputDialog open={renameOpen} title="修改会话标题" description="标题只用于识别当前会话，不会改变任务内容或 Harness 运行状态。" initialValue={session.title} inputLabel="会话标题" confirmLabel="保存标题" pending={renamePending} onOpenChange={setRenameOpen} onConfirm={rename} />}
  </section>;
}

function ExecutionSummary({ tools, terminal, status, changeCount }: { tools: ToolStep[]; terminal: boolean; status: RunStatus; changeCount: number }) {
  const [expanded, setExpanded] = useState(!terminal);
  const bodyRef = useRef<HTMLDivElement>(null);
  const wasTerminal = useRef(terminal);
  useEffect(() => {
    if (!wasTerminal.current && terminal) setExpanded(false);
    if (wasTerminal.current && !terminal) setExpanded(true);
    wasTerminal.current = terminal;
  }, [terminal]);
  useEffect(() => {
    if (!terminal && expanded && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [expanded, terminal, tools.length]);
  const hasRunningTool = tools.some((tool) => tool.status === "running");
  const summary = terminal
    ? `${runStatusLabel(status)} · ${tools.length} 项操作 · ${changeCount} 个文件变化`
    : hasRunningTool ? `正在执行 · ${tools.length} 项操作` : `已执行 ${tools.length} 项操作`;

  return <div className={`${styles.executionGroup} ${expanded ? styles.executionExpanded : styles.executionCollapsed}`} role="group" aria-label="本轮执行过程">
    <button className={styles.executionToggle} type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
      <span>{hasRunningTool && !terminal ? <LoaderCircle className={styles.spinner} size={15} /> : <CheckCircle2 size={15} />}{summary}</span>
      <ChevronDown size={15} />
    </button>
    <div className={styles.executionBody} ref={bodyRef}>
      {tools.length > 0 && <div className={styles.toolStack}>{tools.map((tool) => <ToolCard key={tool.id} tool={tool} />)}</div>}
      {terminal && <TerminalResult status={status} changeCount={changeCount} />}
    </div>
  </div>;
}

function ToolCard({ tool }: { tool: ToolStep }) {
  const dispatch = useAppDispatch();
  const selected = useAppSelector((state) => state.harness.selectedToolId === tool.id);
  const visibleDetail = tool.status === "failed" && tool.output?.trim() ? tool.output.trim() : tool.detail;
  return <motion.button layout className={`${styles.toolCard} ${styles[tool.status]} ${selected ? styles.selectedTool : ""}`} onClick={() => dispatch(harnessActions.selectTool(tool.id))}><span className={styles.toolStatusIcon}>{tool.status === "completed" ? <Check size={15} /> : tool.status === "running" ? <LoaderCircle className={styles.spinner} size={15} /> : <TriangleAlert size={15} />}</span><span><strong>{tool.name} <em>{toolStatusLabel(tool.status)}</em></strong><small title={visibleDetail}>{visibleDetail}</small></span><ChevronRight size={15} /></motion.button>;
}

interface ComposerProps {
  active: boolean;
  terminal: boolean;
  commands: HarnessCommand[];
  commandsLoading: boolean;
  commandsError: boolean;
  commandFeedback: CommandFeedback | null;
  commandPending: boolean;
  onDismissCommandFeedback: () => void;
  onExecuteCommand: (command: HarnessCommand, argument?: string, file?: { name: string; content: string }) => void;
  onInterrupt: () => void;
  onSend: () => void;
  onNotify: (message: string) => void;
}

function Composer({ active, terminal, commands, commandsLoading, commandsError, commandFeedback, commandPending, onDismissCommandFeedback, onExecuteCommand, onInterrupt, onSend, onNotify }: ComposerProps) {
  const dispatch = useAppDispatch();
  const harness = useAppSelector((state) => state.harness);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileCommandRef = useRef<HarnessCommand | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const selectedFile = harness.files.find((entry) => entry.id === harness.selectedFileId && entry.kind === "file");
  const isInterrupting = harness.runStatus === "interrupting";
  const connected = harness.connection === "connected";
  const canSteer = capabilityAvailable(harness.capabilityDecisions?.steering);
  const canFollowUp = capabilityAvailable(harness.capabilityDecisions?.followUp);
  const canInterrupt = capabilityAvailable(harness.capabilityDecisions?.interrupt);
  const parsedSlash = useMemo(() => parseSlashDraft(harness.composerDraft), [harness.composerDraft]);
  const resolvedSlash = useMemo(() => resolveSlashDraft(commands, harness.composerDraft), [commands, harness.composerDraft]);
  const exactCommand = resolvedSlash.kind === "known" ? resolvedSlash.command : undefined;
  const choosingOptions = Boolean(parsedSlash?.hasArgumentSeparator && exactCommand?.input === "select");
  const commandItems = useMemo(() => parsedSlash && !parsedSlash.hasArgumentSeparator ? filterSlashCommands(commands, harness.composerDraft) : [], [commands, harness.composerDraft, parsedSlash]);
  const optionItems = useMemo(() => choosingOptions ? filterCommandOptions(exactCommand, harness.composerDraft) : [], [choosingOptions, exactCommand, harness.composerDraft]);
  const selectableCount = choosingOptions ? optionItems.length : commandItems.length;

  useEffect(() => setHighlightedIndex(0), [harness.composerDraft, choosingOptions]);

  const focusComposer = () => requestAnimationFrame(() => textareaRef.current?.focus());
  const triggerFilePicker = (command: HarnessCommand) => {
    if (!command.available) return onNotify(command.unavailableReason ?? "该命令当前不可用");
    fileCommandRef.current = command;
    fileInputRef.current?.click();
  };
  const chooseCommand = (command: HarnessCommand) => {
    if (!command.available) {
      onNotify(command.unavailableReason ?? "该命令当前不可用");
      return;
    }
    if (command.input === "none") {
      onExecuteCommand(command);
      return;
    }
    if (command.input === "file") {
      triggerFilePicker(command);
      return;
    }
    dispatch(harnessActions.setComposerDraft(`/${command.name} `));
    focusComposer();
  };
  const chooseOption = (command: HarnessCommand, value: string) => {
    if (!command.available) return onNotify(command.unavailableReason ?? "该命令当前不可用");
    onExecuteCommand(command, value);
  };
  const submitDraft = () => {
    if (!parsedSlash) {
      onSend();
      return;
    }
    if (commandsLoading) return onNotify("正在读取当前 Harness 的命令目录");
    if (commandsError) return onNotify("命令目录读取失败，请稍后重试");
    if (resolvedSlash.kind !== "known") {
      onNotify(parsedSlash.name ? `未找到 /${parsedSlash.name}；该内容不会发送给模型` : "请先选择一个斜杠命令");
      return;
    }
    const command = resolvedSlash.command;
    if (!command.available) return onNotify(command.unavailableReason ?? "该命令当前不可用");
    if (command.input === "file") {
      triggerFilePicker(command);
      return;
    }
    if (command.input === "select") {
      const option = command.options?.find((item) => item.value === resolvedSlash.argument || item.label === resolvedSlash.argument);
      if (!option) return onNotify("请从命令菜单中选择一个有效选项");
      chooseOption(command, option.value);
      return;
    }
    if (command.input === "text" && command.argumentRequired && !resolvedSlash.argument) {
      onNotify(`请输入 ${command.argumentHint ?? "命令参数"}`);
      return;
    }
    onExecuteCommand(command, resolvedSlash.argument);
  };
  const activateHighlighted = (): boolean => {
    if (choosingOptions && exactCommand && optionItems[highlightedIndex]) {
      chooseOption(exactCommand, optionItems[highlightedIndex]!.value);
      return true;
    }
    if (!choosingOptions && commandItems[highlightedIndex]) {
      chooseCommand(commandItems[highlightedIndex]!);
      return true;
    }
    return false;
  };
  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (parsedSlash && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      if (selectableCount > 0) setHighlightedIndex((value) => (value + (event.key === "ArrowDown" ? 1 : -1) + selectableCount) % selectableCount);
      return;
    }
    if (parsedSlash && event.key === "Escape") {
      event.preventDefault();
      dispatch(harnessActions.setComposerDraft(""));
      return;
    }
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    if (!parsedSlash || !activateHighlighted()) submitDraft();
  };
  const handleFile = async (file: File | undefined) => {
    const command = fileCommandRef.current;
    fileCommandRef.current = null;
    if (!file || !command) return;
    if (!file.name.toLowerCase().endsWith(".jsonl")) return onNotify("请选择 .jsonl 会话文件");
    if (file.size > 10_000_000) return onNotify("JSONL 会话文件必须小于 10 MB");
    try {
      const content = arrayBufferToBase64(await file.arrayBuffer());
      onExecuteCommand(command, "", { name: file.name, content });
    } catch {
      onNotify("无法读取所选会话文件");
    }
  };
  const footerHint = parsedSlash
    ? "斜杠命令 · ↑↓ 选择 · Enter 确认 · Esc 清空"
    : connected ? "输入 / 打开命令中心 · Enter 发送 · Shift + Enter 换行" : "连接恢复前保持只读";
  return <div className={styles.composerWrap}>
    {commandFeedback && <CommandFeedbackBar feedback={commandFeedback} onDismiss={onDismissCommandFeedback} />}
    {parsedSlash && <div className={styles.commandPalette} role="listbox" aria-label="Harness 斜杠命令">
      <header><span><Command size={15} />Harness 命令</span><small>{commands.length} 项 · 当前会话</small></header>
      <div className={styles.commandPaletteBody}>
        {commandsLoading ? <div className={styles.commandPaletteState}><LoaderCircle className={styles.spinner} size={16} />正在读取命令目录…</div>
          : commandsError ? <div className={styles.commandPaletteState}><TriangleAlert size={16} />命令目录读取失败</div>
            : choosingOptions && exactCommand ? optionItems.length > 0 ? optionItems.map((option, index) => <button key={option.value} type="button" role="option" aria-selected={index === highlightedIndex} className={index === highlightedIndex ? styles.commandSelected : ""} onMouseDown={(event) => event.preventDefault()} onClick={() => chooseOption(exactCommand, option.value)}><span className={styles.commandMark}>{index === highlightedIndex ? <ArrowRight size={15} /> : <span />}</span><span><strong>{option.label}</strong><small>{option.description ?? option.value}</small></span><kbd>Enter</kbd></button>) : <div className={styles.commandPaletteState}>没有匹配的选项，请继续输入或清空参数</div>
              : parsedSlash.hasArgumentSeparator && exactCommand?.input === "text" ? <div className={styles.commandArgumentPrompt}><span><Command size={15} /></span><div><strong>/{exactCommand.name} {exactCommand.argumentHint}</strong><small>{exactCommand.description} · Enter 执行</small></div></div>
                : parsedSlash.hasArgumentSeparator && exactCommand?.input === "file" ? <button type="button" className={styles.commandFilePrompt} onMouseDown={(event) => event.preventDefault()} onClick={() => triggerFilePicker(exactCommand)}><FileUp size={16} /><span><strong>选择 JSONL 会话文件</strong><small>只读取本次导入所选文件，最大 10 MB</small></span></button>
                  : commandItems.length > 0 ? commandItems.map((command, index) => <button key={command.id} type="button" role="option" aria-selected={index === highlightedIndex} disabled={!command.available} className={index === highlightedIndex ? styles.commandSelected : ""} onMouseDown={(event) => event.preventDefault()} onClick={() => chooseCommand(command)}><span className={styles.commandMark}>{command.source === "skill" ? "S" : command.source === "prompt" ? "P" : command.source === "extension" ? "E" : "/"}</span><span><strong>/{command.name} {command.argumentHint && <em>{command.argumentHint}</em>}</strong><small>{command.available ? command.description : command.unavailableReason}</small></span><b>{commandSourceLabel(command.source)}</b></button>)
                    : <div className={styles.commandPaletteState}>未找到这个命令；它不会被发送给 DeepSeek</div>}
      </div>
      <footer><span>↑↓ 选择</span><span>Enter 确认</span><span>Esc 关闭</span></footer>
    </div>}
    {active && harness.runStatus === "running" && (canSteer || canFollowUp) && <div className={styles.composerModes}>{canSteer && <button className={harness.composerMode === "steer" ? styles.modeActive : ""} onClick={() => dispatch(harnessActions.setComposerMode("steer"))}>发送引导</button>}{canFollowUp && <button className={harness.composerMode === "follow_up" ? styles.modeActive : ""} onClick={() => dispatch(harnessActions.setComposerMode("follow_up"))}>排队后续</button>}{(harness.queuedSteering + harness.queuedFollowUp) > 0 && <span>队列 {harness.queuedSteering + harness.queuedFollowUp}</span>}</div>}
    <div className={styles.composer}><textarea ref={textareaRef} value={harness.composerDraft} disabled={!connected} onChange={(event) => dispatch(harnessActions.setComposerDraft(event.target.value))} placeholder={!connected ? "正在恢复连接，操作暂时冻结…" : active ? harness.composerMode === "follow_up" ? "排队一个完成后执行的后续任务…" : "发送引导，指导 DeepSeek 继续推进任务…" : terminal ? "继续当前会话，描述新的修改…" : "描述你希望 Harness 完成的开发任务…"} onKeyDown={handleComposerKeyDown} /><div className={styles.composerFooter}><div><button aria-label="引用工作区文件" disabled={!connected} onClick={() => { if (!selectedFile) return onNotify("请先在左侧选择一个文件"); dispatch(harnessActions.setComposerDraft(`${harness.composerDraft}${harness.composerDraft ? " " : ""}@${selectedFile.path} `)); }}><AtSign size={17} /></button><span>{footerHint}</span></div><div>{!active && <button className={styles.sendButton} onClick={submitDraft} disabled={!connected || commandPending || !harness.composerDraft.trim() || !harness.selectedSessionId}>{commandPending ? "正在执行" : parsedSlash ? "执行命令" : terminal ? "继续任务" : "发送任务"}{parsedSlash ? <Command size={16} /> : <Send size={16} />}</button>}{active && canInterrupt && <button className={styles.interruptButton} onClick={onInterrupt} disabled={!connected || commandPending || isInterrupting}><CircleStop size={16} />{isInterrupting ? "正在中断" : "中断"}</button>}{active && harness.runStatus === "running" && ((harness.composerMode === "follow_up" && canFollowUp) || (harness.composerMode !== "follow_up" && canSteer)) && <button className={styles.sendButton} onClick={submitDraft} disabled={!connected || commandPending || !harness.composerDraft.trim()}>{commandPending ? "正在执行" : parsedSlash ? "执行命令" : harness.composerMode === "follow_up" ? "排队" : "发送引导"}{parsedSlash ? <Command size={16} /> : <Send size={16} />}</button>}</div></div></div>
    <input ref={fileInputRef} className={styles.hiddenFileInput} type="file" accept=".jsonl,application/x-ndjson" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; void handleFile(file); }} />
  </div>;
}

function CommandFeedbackBar({ feedback, onDismiss }: { feedback: CommandFeedback; onDismiss: () => void }) {
  const entries = feedback.data ? Object.entries(feedback.data).slice(0, 10) : [];
  return <section className={`${styles.commandFeedback} ${feedback.tone === "error" ? styles.commandFeedbackError : ""}`} aria-live="polite"><span>{feedback.tone === "error" ? <TriangleAlert size={16} /> : <CheckCircle2 size={16} />}</span><div><strong>{feedback.title}</strong>{feedback.detail && <p>{feedback.detail}</p>}{entries.length > 0 && <dl>{entries.map(([key, value]) => <div key={key}><dt>{commandDetailLabel(key)}</dt><dd>{formatCommandValue(value)}</dd></div>)}</dl>}</div><button type="button" aria-label="关闭命令结果" onClick={onDismiss}><X size={15} /></button></section>;
}

function Inspector({ onRefresh }: { onRefresh: () => void }) {
  const dispatch = useAppDispatch();
  const harness = useAppSelector((state) => state.harness);
  const selectedFile = harness.files.find((file) => file.id === harness.selectedFileId && file.kind === "file");
  const selectedTool = harness.tools.find((tool) => tool.id === harness.selectedToolId);
  const mode = harness.inspector === "source" ? "source" : "diff";
  const previewableAsRichFile = selectedFile ? /\.(?:mdx?|png|jpe?g|gif|webp|svg|html?)$/i.test(selectedFile.path) : false;
  const showRichPreview = harness.inspector === "source" && previewableAsRichFile;
  const fileView = useGetFileViewQuery({ path: selectedFile?.path ?? "", ...(harness.currentRunId ? { runId: harness.currentRunId } : {}) }, { skip: !selectedFile || showRichPreview });
  const source = fileView.data ? { original: fileView.data.baseline, updated: fileView.data.current } : undefined;
  const diffAvailable = fileView.data?.baselineAvailable !== false;
  const inspectorTitle = harness.inspector === "tool"
    ? selectedTool?.name
    : harness.inspector === "diagnostic" ? "运行诊断"
      : harness.inspector === "process" ? "执行过程"
        : selectedFile?.path ?? "上下文检查器";
  const diffLabel = fileView.data?.baselineSource === "run" ? "本轮代码变化 · 只读" : fileView.data?.baselineSource === "git" ? "相对 Git 基线 · 只读" : fileView.data?.baselineSource === "workspace" ? "相对打开目录时 · 只读" : "本轮旧版本不可用";
  return <aside className={`${styles.inspector} ${harness.inspector === "process" ? styles.compactInspector : ""}`}><header className={styles.inspectorHeader}><div>{harness.inspector === "tool" ? <TerminalSquare size={17} /> : harness.inspector === "diagnostic" ? <AlertTriangle size={17} /> : <FileCode2 size={17} />}<h2>{inspectorTitle}</h2></div><button aria-label="关闭检查器" onClick={() => dispatch(harnessActions.setInspector("process"))}><X size={17} /></button></header><AnimatePresence mode="wait" initial={false}><motion.div className={styles.inspectorContent} key={`${harness.inspector}-${selectedFile?.id ?? "none"}-${selectedTool?.id ?? "none"}`} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -7 }} transition={{ duration: 0.18, ease: "easeOut" }}>{harness.inspector === "tool" && selectedTool ? <ToolInspector tool={selectedTool} /> : harness.inspector === "process" ? <ProcessInspector /> : harness.inspector === "diagnostic" ? <DiagnosticInspector /> : <><div className={styles.inspectorTabs}><button className={mode === "source" ? styles.inspectorTabActive : ""} onClick={() => dispatch(harnessActions.setInspector("source"))}>{previewableAsRichFile ? "预览" : "源码"}</button><button className={mode === "diff" ? styles.inspectorTabActive : ""} onClick={() => dispatch(harnessActions.setInspector("diff"))}>Diff</button></div>{showRichPreview ? <FilePreview path={selectedFile?.path ?? null} /> : <><div className={styles.editorHeader}><span>{fileView.isFetching ? "正在读取…" : mode === "diff" ? diffLabel : "当前文件 · 只读"}</span><button onClick={() => { void fileView.refetch(); onRefresh(); }}><RefreshCw size={14} />刷新</button></div><div className={styles.editorArea}><CodeMirrorDiff mode={mode} source={source} diffAvailable={diffAvailable} /></div></>}</>}</motion.div></AnimatePresence></aside>;
}

function ToolInspector({ tool }: { tool: ToolStep }) {
  return <div className={styles.toolInspector}><div className={styles.toolInspectorState}><span className={styles[tool.status]}>{toolStatusLabel(tool.status)}</span><small>工具调用 · {tool.id}</small></div><h3>{tool.summary}</h3><p>{tool.detail}</p><div className={styles.toolTime}><span>开始：{formatEventTime(tool.startedAt)}</span><span>结束：{formatEventTime(tool.endedAt)}</span></div>{tool.exitCode !== undefined && <p>退出码：{tool.exitCode ?? "未返回"}</p>}{tool.observedChangedPaths && tool.observedChangedPaths.length > 0 && <div className={styles.factNote}><GitBranch size={14} />同一 Run 独立观察到文件变化：{tool.observedChangedPaths.join("、")}。这是时间关联，不代表该工具的确定归因。</div>}<div className={styles.outputHeader}><TerminalSquare size={15} /> 输出 {tool.truncated && "· 已截断"}{tool.fullOutputId && <a href={`/api/tool-outputs/${encodeURIComponent(tool.fullOutputId)}`} target="_blank" rel="noreferrer"><Download size={13} />完整输出 {tool.fullOutputSize ? formatFileSize(tool.fullOutputSize) : ""}</a>}</div><pre>{tool.output || "等待工具输出…"}</pre><div className={styles.factNote}><AlertTriangle size={14} />工具结果不等于整个 Run 已完成。</div></div>;
}

function ProcessInspector() {
  const harness = useAppSelector((state) => state.harness);
  const visibleActivity = harness.activity.filter((item) => item.kind !== "raw");
  return <div className={styles.processInspector}><h3>执行过程</h3><p>这里展示来自统一事件的真实运行状态；未识别载荷保留在“诊断 / 原始事件”。</p><div className={styles.processLine}><span className={`${styles.processDot} ${styles[harness.model?.status === "ready" ? "completed" : "unknown"]}`} /><div><strong>{harness.model?.modelId ?? "模型尚未连接"}</strong><small>{harness.model ? `${thinkingLabel(harness.model.thinkingLevel)}思考强度 · ${contextSummary(harness.usage)}` : "等待真实模型状态"}</small></div></div><div className={styles.processLine}><span className={`${styles.processDot} ${styles[harness.runStatus]}`} /><div><strong>{runStatusLabel(harness.runStatus)}</strong><small>Run 与 Session 分离建模 · 事件 #{harness.lastSequence || "—"}</small></div></div>{harness.sequenceGap && <div className={styles.processLine}><span className={`${styles.processDot} ${styles.failed}`} /><div><strong>事件序号缺口</strong><small>期望 #{harness.sequenceGap.expected}，收到 #{harness.sequenceGap.received}</small></div></div>}{[...visibleActivity, ...harness.tools.map((tool) => ({ id: tool.id, label: tool.name, detail: `${tool.detail}${tool.exitCode !== undefined ? ` · exit ${tool.exitCode ?? "?"}` : ""}`, status: tool.status, sequence: harness.events.find((event) => event.payload.toolCallId === tool.id)?.sequence ?? 0, startedAt: tool.startedAt }))].sort((left, right) => left.sequence - right.sequence).map((item) => <div key={item.id} className={styles.processLine}><span className={`${styles.processDot} ${styles[item.status]}`} /><div><strong>{item.label}</strong><small>{item.detail} · 事件 #{item.sequence}{item.startedAt ? ` · ${formatEventTime(item.startedAt)}` : ""}</small></div></div>)}{harness.usage && <div className={styles.processLine}><span className={`${styles.processDot} ${styles.completed}`} /><div><strong>Token 与用量</strong><small>{usageSummary(harness.usage)}</small></div></div>}</div>;
}

function DiagnosticInspector() {
  const harness = useAppSelector((state) => state.harness);
  const items = [
    ["Browser", "前端应用", "ready", "React 页面与状态仓正在运行"],
    ["Bridge", "本地服务", harness.connection === "connected" ? "ready" : "error", harness.connection === "connected" ? "HTTP + SSE 已连接" : "事件连接不可用"],
    ["Harness", harness.runtime?.displayName ?? "Harness Runtime", harness.runtime?.status === "ready" ? "ready" : "unknown", harness.runtime ? `${harness.runtime.harnessId} ${harness.runtime.harnessVersion} · Adapter 接入` : "尚未探测"],
    ["DeepSeek", "模型连接", harness.model?.status === "ready" ? "ready" : "unknown", harness.model ? `${harness.model.modelId} · ${harness.model.status}` : "尚未连接"],
    ["Git", "工作区事实", harness.workspace?.git ? "ready" : "unknown", harness.workspace?.git ? `${harness.workspace.branch ?? "detached"} · ${harness.workspace.fileCount} 个文件` : "当前不是 Git 工作区"]
  ] as const;
  return <div className={styles.diagnosticInspector}>{items.map(([layer, label, status, detail]) => <div key={layer}><span className={styles[status]} /><strong>{layer} · {label}</strong><p>{detail}</p></div>)}</div>;
}

function TerminalResult({ status, changeCount }: { status: RunStatus; changeCount: number }) {
  const copy = {
    completed: ["任务已完成", `run.settled · ${changeCount} 个文件变化`],
    failed: ["任务执行失败", `错误已保留 · ${changeCount} 个文件变化`],
    cancelled: ["任务已取消", `队列已清空 · ${changeCount} 个文件变化`],
    unknown: ["最终状态无法确认", "运行脉冲已停止 · 请查看诊断"]
  }[status as "completed" | "failed" | "cancelled" | "unknown"] ?? [];
  return <motion.div className={`${styles.terminalResult} ${styles[status]}`} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}><strong>{status === "completed" ? <CheckCircle2 size={16} /> : <TriangleAlert size={16} />}{copy[0]}</strong><span>{copy[1]}</span><Link to="/results">查看结果<ArrowRight size={13} /></Link></motion.div>;
}

function RunPill({ status }: { status: RunStatus }) {
  return <span className={`${styles.runPill} ${styles[status]}`}>{isActive(status) && <LoaderCircle className={styles.spinner} size={14} />}{runStatusLabel(status)}</span>;
}

function fileIcon(file: FileNode) {
  if (file.language === "typescript" || file.language === "javascript") return FileCode2;
  if (file.language === "json") return Braces;
  if (file.language === "markdown") return FileText;
  if (file.name === "package.json") return Package;
  return File;
}

function changeMark(file: FileNode): string {
  return file.changeKind === "added" ? "A" : file.changeKind === "deleted" ? "D" : file.changeKind === "renamed" ? "R" : "M";
}

function stageLabel(file: Pick<FileNode, "staged" | "unstaged">): string {
  if (file.staged && file.unstaged) return "已暂存 + 未暂存";
  return file.staged ? "已暂存" : "未暂存";
}

function changeLabel(file: Pick<FileNode, "changeKind">): string {
  return file.changeKind === "added" ? "新增" : file.changeKind === "deleted" ? "删除" : file.changeKind === "renamed" ? "重命名" : "修改";
}

function assistantStatusCopy(status: RunStatus): string {
  if (status === "submitting") return "正在提交任务，草稿会在收到接受回执后清空。";
  if (status === "acknowledged") return "任务已接受，正在等待运行开始。这还不代表任务已经成功。";
  if (status === "running") return "DeepSeek 正在分析任务并通过 Harness 操作工作区。";
  if (status === "settling") return "工具执行已结束，正在等待运行完成收尾。";
  if (status === "interrupting") return "正在清空排队输入并中断当前执行，等待最终状态确认。";
  if (status === "failed") return "任务执行失败。已发生的修改和工具输出仍然保留。";
  if (status === "cancelled") return "任务已取消。已经发生的文件变化仍然保留。";
  if (status === "unknown") return "连接中断后无法确认最终状态，当前不会显示成功。";
  if (status === "completed") return "任务已经完成，可以在右侧逐文件核对真实 Diff。";
  return "等待新的开发任务。";
}

function toolStatusLabel(status: ToolStep["status"]): string {
  return { pending: "等待中", running: "运行中", completed: "已完成", failed: "失败", cancelled: "已取消" }[status];
}

function runStatusLabel(status: RunStatus): string {
  return { idle: "空闲", submitting: "正在提交", acknowledged: "已接受", running: "执行中", settling: "正在收尾", interrupting: "正在中断", completed: "已完成", failed: "失败", cancelled: "已取消", unknown: "待确认" }[status];
}

function isActive(status: RunStatus): boolean {
  return ["submitting", "acknowledged", "running", "settling", "interrupting"].includes(status);
}

function capabilityAvailable(decision: CapabilityDecision | undefined): boolean {
  return decision?.runtimeCapability === true
    && decision.productAvailability
    && decision.userPermission === true;
}

function usageSummary(usage: Record<string, unknown>): string {
  const input = typeof usage.input === "number" ? usage.input : "未提供";
  const output = typeof usage.output === "number" ? usage.output : "未提供";
  const cacheRead = typeof usage.cacheRead === "number" ? usage.cacheRead : "未提供";
  const costValue = typeof usage.cost === "object" && usage.cost !== null ? (usage.cost as Record<string, unknown>).total : undefined;
  const cost = typeof costValue === "number" ? `$${costValue.toFixed(6)}` : "未提供";
  const source = usage.costSource === "pi-model-config-estimate" ? "Pi 配置估算" : "来源未标明";
  return `输入 ${input} · 输出 ${output} · 缓存读取 ${cacheRead} · ${source} ${cost}`;
}

function contextSummary(usage: Record<string, unknown> | null): string {
  const context = usage && typeof usage.context === "object" && usage.context !== null
    ? usage.context as Record<string, unknown>
    : null;
  if (!context || typeof context.contextWindow !== "number") return "上下文占用待首轮响应";
  if (typeof context.tokens !== "number" || typeof context.percent !== "number") return `上下文占用待更新 / ${context.contextWindow.toLocaleString()} Token`;
  return `上下文 ${context.tokens.toLocaleString()} / ${context.contextWindow.toLocaleString()} · ${context.percent.toFixed(1)}%`;
}

function thinkingLabel(value: string): string {
  return value === "high" ? "高" : value === "max" ? "最大" : value;
}

function formatEventTime(value?: string): string {
  return value ? new Date(value).toLocaleTimeString("zh-CN", { hour12: false }) : "尚未返回";
}

function formatFileSize(value: number): string {
  return value < 1024 ? `${value} B` : `${(value / 1024).toFixed(1)} KB`;
}

function arrayBufferToBase64(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return window.btoa(binary);
}

function commandSourceLabel(source: HarnessCommand["source"]): string {
  return {
    product: "工作台",
    harness: "Harness",
    skill: "Skill",
    prompt: "Prompt",
    extension: "扩展"
  }[source];
}

function commandDetailLabel(key: string): string {
  return {
    sessionId: "会话 ID",
    userMessages: "用户消息",
    assistantMessages: "Assistant 消息",
    toolCalls: "工具调用",
    totalMessages: "消息总数",
    totalTokens: "累计 Token",
    contextTokens: "上下文 Token",
    contextWindow: "上下文窗口",
    tokensBefore: "压缩前 Token",
    estimatedTokensAfter: "压缩后预估",
    skills: "Skills",
    prompts: "Prompts",
    extensions: "Extensions"
  }[key] ?? key;
}

function formatCommandValue(value: unknown): string {
  if (Array.isArray(value)) return value.length > 0 ? value.map((item) => String(item)).join("、") : "无";
  if (typeof value === "number") return value.toLocaleString();
  if (typeof value === "boolean") return value ? "是" : "否";
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
