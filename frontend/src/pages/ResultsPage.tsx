import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLeft,
  ArrowRight,
  Box,
  Check,
  CheckCircle2,
  CircleDot,
  ClipboardCheck,
  Code2,
  ExternalLink,
  FileCode2,
  FileText,
  GitCompareArrows,
  PackageCheck,
  TerminalSquare
} from "lucide-react";
import { AppShell } from "../components/AppShell";
import { CodeMirrorDiff } from "../components/CodeMirrorDiff";
import { FilePreview } from "../components/FilePreview";
import { useAppDispatch, useAppSelector } from "../app/hooks";
import { harnessActions } from "../app/store";
import {
  useGetAcceptanceRecordsQuery,
  useGetEventsQuery,
  useGetFileViewQuery,
  useGetSessionsQuery,
  useGetWorkspaceQuery
} from "../api/bridge-api";
import type { ChangedFile } from "../api/contracts";
import type { RunStatus } from "../contracts/view-model";
import styles from "./ResultsPage.module.css";

type ResultTab = "files" | "tests" | "artifacts";

export function ResultsPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const harness = useAppSelector((state) => state.harness);
  const workspaceQuery = useGetWorkspaceQuery(harness.currentRunId ?? undefined);
  const recordsQuery = useGetAcceptanceRecordsQuery();
  const sessionsQuery = useGetSessionsQuery();
  const resultSessionId = harness.selectedSessionId || sessionsQuery.data?.activeSessionId || sessionsQuery.data?.sessions[0]?.id || "";
  const eventsQuery = useGetEventsQuery(resultSessionId, { skip: !resultSessionId });
  const [tab, setTab] = useState<ResultTab>("files");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const changes = workspaceQuery.data?.changes ?? [];
  const artifactCandidates = changes.filter((change) => change.status !== "deleted");
  const selectedArtifacts = harness.artifactPaths.filter((path) => artifactCandidates.some((change) => change.path === path));
  const acceptance = useMemo(() => {
    const records = recordsQuery.data?.records ?? [];
    return records.find((record) => record.runId === harness.currentRunId)
      ?? records.find((record) => record.sessionId === harness.selectedSessionId);
  }, [harness.currentRunId, harness.selectedSessionId, recordsQuery.data]);
  const session = harness.sessions.find((entry) => entry.id === harness.selectedSessionId);
  const status = terminalStatus(acceptance?.finalStatus ?? harness.runStatus);
  const statusCopy = resultStatusCopy(status);
  const successful = status === "completed";

  useEffect(() => {
    if (!sessionsQuery.data) return;
    dispatch(harnessActions.restoreActiveSession({
      sessions: sessionsQuery.data.sessions,
      activeSessionId: sessionsQuery.data.activeSessionId ?? sessionsQuery.data.sessions[0]?.id ?? null
    }));
  }, [dispatch, sessionsQuery.data]);

  useEffect(() => {
    if (eventsQuery.data) dispatch(harnessActions.setEvents(eventsQuery.data.events));
  }, [dispatch, eventsQuery.data]);

  useEffect(() => {
    if (!selectedFile || !changes.some((change) => change.path === selectedFile)) {
      setSelectedFile(changes[0]?.path ?? null);
    }
  }, [changes, selectedFile]);

  const fileView = useGetFileViewQuery({ path: selectedFile ?? "", ...(harness.currentRunId ? { runId: harness.currentRunId } : {}) }, {
    skip: !selectedFile
  });
  const source = fileView.data
    ? { original: fileView.data.baseline, updated: fileView.data.current }
    : undefined;
  const lastBash = [...harness.tools].reverse().find((tool) => tool.name.toLowerCase() === "bash");
  const verification = acceptance?.verification;
  const evidence = verification
    ? {
        title: verification.passed ? "独立验证通过" : "独立验证未通过",
        detail: "该结论来自 Bridge 在 Agent 结束后独立执行的验证命令。",
        command: verification.command ?? "未提供命令",
        exit: verification.exitCode === null ? "未知" : String(verification.exitCode),
        output: verification.output || "命令没有返回文本输出。",
        passed: verification.passed
      }
    : lastBash
      ? {
          title: lastBash.status === "completed" ? "命令执行完成" : `命令${toolStatusCopy(lastBash.status)}`,
          detail: "这里只陈述 Bash 工具状态；没有独立验证记录时不推断测试通过。",
          command: lastBash.detail,
          exit: lastBash.exitCode === undefined || lastBash.exitCode === null ? "未提供" : String(lastBash.exitCode),
          output: lastBash.output || "工具没有返回文本输出。",
          passed: false
        }
      : {
          title: "没有观察到验证命令",
          detail: "当前 Run 没有可核对的 Bash 或独立验证证据。",
          command: "未执行",
          exit: "未提供",
          output: "没有命令输出。",
          passed: false
        };

  const continueTask = () => {
    dispatch(harnessActions.setComposerMode("prompt"));
    dispatch(harnessActions.setComposerDraft(""));
    navigate("/workbench");
  };

  const locateInWorkspace = (path: string) => {
    dispatch(harnessActions.selectFile(path));
    dispatch(harnessActions.showNotice(`已在工作台定位 ${path}`));
    navigate("/workbench");
  };

  return (
    <AppShell connection={harness.connection} compactHeader>
      <div className={styles.page}>
        <aside className={styles.summaryRail}>
          <Link className={styles.backLink} to="/workbench"><ArrowLeft size={16} /> 返回会话</Link>
          <div className={styles.railDivider} />
          <section>
            <span className={styles.sectionLabel}>当前会话</span>
            <div className={styles.sessionCard}>
              <div><strong>{session?.title ?? "尚未选择会话"}</strong><FileText size={14} /></div>
              <p>{harness.currentPrompt || "从当前会话核对真实运行结果"}</p>
              <span className={!successful ? styles.nonSuccess : ""}>{successful ? <CheckCircle2 size={17} /> : <CircleDot size={17} />} {statusCopy.title}</span>
            </div>
          </section>
          <section className={styles.factCard}>
            <h3>验证结果</h3>
            <button onClick={() => setTab("tests")}><ClipboardCheck size={18} /><span><strong>{evidence.title}</strong><small>{verification ? "来自独立验证记录" : "来自 Bash 工具事件"}</small></span><ArrowRight size={14} /></button>
            <button onClick={() => setTab("tests")}><span className={styles.exitCode}>{evidence.exit}</span><span><strong>退出码 {evidence.exit}</strong><small>不从 Assistant 文本推断</small></span><ArrowRight size={14} /></button>
          </section>
          <section className={styles.factCard}>
            <h3>文件与产物</h3>
            <button onClick={() => setTab("files")}><FileCode2 size={18} /><span><strong>文件变化 <em>{changes.length}</em></strong><small>来自 Bridge / Git</small></span><ArrowRight size={14} /></button>
            <button onClick={() => setTab("artifacts")}><Box size={18} /><span><strong>已选产物 <em>{selectedArtifacts.length}</em></strong><small>{artifactCandidates.length} 个真实变化候选</small></span><ArrowRight size={14} /></button>
          </section>
          <button className={styles.continueButton} onClick={continueTask}>继续任务<ArrowRight size={18} /></button>
          <p className={styles.sourceNote}><CircleDot size={13} />Run 终态、命令验证与 Git 变化保持独立事实来源</p>
        </aside>

        <main className={styles.resultStage}>
          <header className={styles.resultHeader}>
            <div>
              <div className={styles.titleLine}><h1>任务结果核对</h1><span className={!successful ? styles.nonSuccessPill : ""}>{successful ? <Check size={14} /> : <CircleDot size={14} />} {statusCopy.short}</span></div>
              <p>{workspaceQuery.data?.workspace.name ?? "当前工作区"} · 核对文件变更与验证证据</p>
            </div>
            <div className={styles.headerFacts}><span>Run · {harness.currentRunId?.slice(0, 8) ?? "未恢复"}</span><span>Session 仍可继续</span></div>
          </header>

          <nav className={styles.tabs} aria-label="结果类型">
            <ResultTabButton active={tab === "files"} onClick={() => setTab("files")} icon={<GitCompareArrows size={18} />} label="文件变化" count={changes.length} />
            <ResultTabButton active={tab === "tests"} onClick={() => setTab("tests")} icon={<TerminalSquare size={18} />} label="验证输出" />
            <ResultTabButton active={tab === "artifacts"} onClick={() => setTab("artifacts")} icon={<PackageCheck size={18} />} label="产物预览" count={selectedArtifacts.length} />
          </nav>

          <AnimatePresence mode="wait">
            {tab === "files" && (
              <motion.section key="files" className={styles.filesView} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <div className={styles.changedFiles}>
                  <header>文件变化 <span>{changes.length}</span></header>
                  {changes.map((change) => <ChangeButton key={change.path} change={change} scope={workspaceQuery.data?.changeScope} selected={selectedFile === change.path} onSelect={setSelectedFile} />)}
                  {changes.length === 0 && <div className={styles.emptyResult}>{workspaceQuery.data?.changeScope === "unavailable" ? "这次任务发生在快照功能启用前，无法可靠还原本轮文件变化。" : "Bridge 未观察到本轮文件变化。"}</div>}
                  <div className={styles.legend}><span>M / A / D / R</span> {changeScopeLabel(workspaceQuery.data?.changeScope)} · 只读核对</div>
                </div>
                <div className={`${styles.diffPanel} ${selectedFile ? "" : styles.emptyDiffPanel}`}>
                  <header><strong>{selectedFile ?? "未选择变化文件"}</strong><span className={styles.readonlyMode}>{fileView.data?.baselineSource === "run" ? "本轮 Diff" : "Diff"} · 只读</span></header>
                  {selectedFile
                    ? <div className={styles.diffEditor}><CodeMirrorDiff mode="diff" source={source} diffAvailable={fileView.data?.baselineAvailable !== false} /></div>
                    : <div className={styles.emptyDiffState}><FileCode2 size={26} /><strong>{workspaceQuery.data?.changeScope === "unavailable" ? "本轮旧版本不可用" : "本次没有文件变化"}</strong><p>{workspaceQuery.data?.changeScope === "unavailable" ? "这次任务发生在快照功能启用前，系统不会用错误基线伪造 Diff。" : "当前 Run 只产生了命令输出；如需核对执行证据，请切换到“验证输出”。"}</p></div>}
                </div>
              </motion.section>
            )}

            {tab === "tests" && (
              <motion.section key="tests" className={styles.evidenceView} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <div className={`${styles.evidenceSummary} ${!evidence.passed ? styles.evidenceNeutral : ""}`}>
                  <span><ClipboardCheck size={24} /></span>
                  <div><small>{verification ? "Bridge 独立验证证据" : "Bash 工具证据"}</small><h2>{evidence.title}</h2><p>{evidence.detail}</p></div>
                  <strong>退出码 {evidence.exit}</strong>
                </div>
                <div className={styles.commandPanel}>
                  <header><TerminalSquare size={16} /><span>{evidence.command}</span><em>只读输出</em></header>
                  <pre>{evidence.output}</pre>
                </div>
              </motion.section>
            )}

            {tab === "artifacts" && (
              <motion.section key="artifacts" className={styles.artifactView} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <div className={styles.artifactList}>
                  <header>产物候选 <span>{artifactCandidates.length}</span></header>
                  {artifactCandidates.map((change) => (
                    <button className={`${selectedFile === change.path ? styles.selectedArtifact : ""} ${harness.artifactPaths.includes(change.path) ? styles.chosenArtifact : ""}`} key={change.path} onClick={() => { setSelectedFile(change.path); dispatch(harnessActions.toggleArtifact(change.path)); }}><FileCode2 size={18} /><span><strong>{fileName(change.path)}</strong><small>{change.path} · 点击选择或取消产物</small></span>{harness.artifactPaths.includes(change.path) && <Check size={15} />}</button>
                  ))}
                  {artifactCandidates.length === 0 && <div className={styles.emptyResult}>没有可预览的变化文件候选。</div>}
                  <div className={styles.provenance}><Code2 size={17} /><div><strong>为什么是产物候选？</strong><p>候选只来自 Bridge / Git 观察到的真实文件变化；当前已选择 {selectedArtifacts.length} 个，模型描述本身不构成产物事实。</p></div></div>
                </div>
                <div className={styles.artifactPreview}>
                  <header><div><FileCode2 size={17} /><strong>{selectedFile ?? "未选择产物"}</strong></div>{selectedFile && <button onClick={() => locateInWorkspace(selectedFile)}><ExternalLink size={15} />在工作区定位</button>}</header>
                  <div className={styles.diffEditor}><FilePreview path={selectedFile} /></div>
                </div>
              </motion.section>
            )}
          </AnimatePresence>
        </main>
      </div>
    </AppShell>
  );
}

function ChangeButton({ change, scope, selected, onSelect }: { change: ChangedFile; scope: "run" | "git" | "workspace" | "unavailable" | undefined; selected: boolean; onSelect: (path: string) => void }) {
  const detail = scope === "git"
    ? change.staged && change.unstaged ? "已暂存 + 未暂存" : change.staged ? "已暂存" : "未暂存"
    : changeStatusLabel(change.status);
  return <button className={selected ? styles.selectedFile : ""} onClick={() => onSelect(change.path)}><FileCode2 size={17} /><span><strong>{change.path}</strong><small>{change.previousPath ? `${change.previousPath} → ` : ""}{detail}</small></span><em>{changeMark(change.status)}</em></button>;
}

function ResultTabButton({ active, onClick, icon, label, count }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; count?: number }) {
  return <button className={active ? styles.activeTab : ""} onClick={onClick}>{icon}{label}{count !== undefined && <span>{count}</span>}</button>;
}

function terminalStatus(status: RunStatus): "completed" | "failed" | "cancelled" | "unknown" {
  return ["completed", "failed", "cancelled", "unknown"].includes(status) ? status as "completed" | "failed" | "cancelled" | "unknown" : "unknown";
}

function resultStatusCopy(status: string) {
  return {
    completed: { title: "任务已完成", short: "已完成" },
    failed: { title: "任务执行失败", short: "失败" },
    cancelled: { title: "任务已取消", short: "已取消" },
    unknown: { title: "任务状态待确认", short: "待确认" }
  }[status] ?? { title: "任务状态待确认", short: "待确认" };
}

function changeMark(status: ChangedFile["status"]): string {
  return status === "added" || status === "untracked" ? "A" : status === "deleted" ? "D" : status === "renamed" ? "R" : "M";
}

function changeStatusLabel(status: ChangedFile["status"]): string {
  return status === "added" || status === "untracked" ? "本轮新增" : status === "deleted" ? "本轮删除" : status === "renamed" ? "本轮重命名" : "本轮修改";
}

function toolStatusCopy(status: string): string {
  return { running: "运行中", completed: "已完成", failed: "失败", cancelled: "已取消" }[status] ?? "状态待确认";
}

function fileName(path: string): string {
  return path.split("/").at(-1) ?? path;
}

function changeScopeLabel(scope: "run" | "git" | "workspace" | "unavailable" | undefined): string {
  if (scope === "run") return "本轮开始前后对比";
  if (scope === "git") return "当前 Git 状态";
  if (scope === "workspace") return "普通目录 · 打开时基线";
  return "本轮基线不可用";
}
