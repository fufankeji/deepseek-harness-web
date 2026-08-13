import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, Bot, CheckCircle2, CircleHelp, PanelLeftClose, PanelLeftOpen, Settings } from "lucide-react";
import { Link, useLocation } from "react-router";
import { motion } from "motion/react";
import { AnimatePresence } from "motion/react";
import { useAppDispatch, useAppSelector } from "../app/hooks";
import { harnessActions } from "../app/store";
import { useGetDiagnosticsQuery, useHealthQuery } from "../api/bridge-api";
import { ThemeTooltip } from "./ThemeTooltip";
import styles from "./AppShell.module.css";

interface AppShellProps {
  children: ReactNode;
  connection?: "connected" | "reconnecting" | "disconnected" | "error";
  compactHeader?: boolean;
  lockContentViewport?: boolean;
}

export function AppShell({ children, connection = "connected", compactHeader = false, lockContentViewport = false }: AppShellProps) {
  const location = useLocation();
  const dispatch = useAppDispatch();
  const [railExpanded, setRailExpanded] = useState(() => window.localStorage.getItem("ff-navigation-expanded") === "true");
  const notice = useAppSelector((state) => state.harness.notice);
  const runtime = useAppSelector((state) => state.harness.runtime);
  const runStatus = useAppSelector((state) => state.harness.runStatus);
  const selectedSessionId = useAppSelector((state) => state.harness.selectedSessionId);
  const setupLocked = ["submitting", "acknowledged", "running", "settling", "interrupting"].includes(runStatus);
  const health = useHealthQuery(undefined, { pollingInterval: 8_000, skipPollingIfUnfocused: true });
  const diagnostics = useGetDiagnosticsQuery(undefined, { pollingInterval: 10_000, skipPollingIfUnfocused: true });
  const runtimeName = runtime?.displayName ?? diagnostics.data?.adapter.displayName ?? "Harness 尚未探测";
  const sessionStreamOwnsConnection = location.pathname === "/workbench" && Boolean(selectedSessionId);

  useEffect(() => {
    if (health.isSuccess && !sessionStreamOwnsConnection) dispatch(harnessActions.setConnection("connected"));
    else if (health.isError) dispatch(harnessActions.setConnection("disconnected"));
  }, [dispatch, health.isError, health.isSuccess, sessionStreamOwnsConnection]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => dispatch(harnessActions.clearNotice()), 2200);
    return () => window.clearTimeout(timer);
  }, [dispatch, notice]);

  return (
    <div className={`${styles.shell} ${railExpanded ? styles.railExpanded : ""}`}>
      <aside className={styles.rail} aria-label="全局导航">
        <Link className={styles.menuButton} to="/workbench" aria-label="打开工作台">
          <img src="/brand/ff-logo.png" alt="FF - DeepSeek Harness Web Logo" />
          <span className={styles.railBrand}>DeepSeek Harness</span>
        </Link>
        <ThemeTooltip content={railExpanded ? "收起导航" : "展开导航"}>
          <button className={styles.railToggle} type="button" aria-label={railExpanded ? "收起导航" : "展开导航"} aria-expanded={railExpanded} onClick={() => setRailExpanded((value) => {
            window.localStorage.setItem("ff-navigation-expanded", String(!value));
            return !value;
          })}>
            {railExpanded ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={14} />}
          </button>
        </ThemeTooltip>
        <nav className={styles.railNav}>
          <RailLink active={location.pathname === "/workbench"} expanded={railExpanded} to="/workbench" label="开发工作台">
            <WorkspaceGlyph />
          </RailLink>
          <RailLink active={location.pathname === "/diagnostics"} expanded={railExpanded} to="/diagnostics" label="运行诊断">
            <DiagnosticsGlyph />
          </RailLink>
        </nav>
        <div className={styles.railFooter}>
          {setupLocked
            ? <ThemeTooltip content="任务执行中不可更改环境设置"><span className={styles.disabledTooltipTarget}><button className={styles.iconButton} aria-label="任务执行中不可更改环境设置" disabled><Settings size={19} /><span className={styles.railLabel}>环境设置</span></button></span></ThemeTooltip>
            : <ThemeTooltip content="环境设置"><Link className={styles.iconButton} to="/setup" aria-label="环境设置"><Settings size={19} /><span className={styles.railLabel}>环境设置</span></Link></ThemeTooltip>}
          <ThemeTooltip content="帮助与诊断"><Link className={styles.iconButton} to="/diagnostics" aria-label="帮助与诊断"><CircleHelp size={19} /><span className={styles.railLabel}>帮助与诊断</span></Link></ThemeTooltip>
        </div>
      </aside>

      <div className={styles.stage}>
        <header className={`${styles.header} ${compactHeader ? styles.compactHeader : ""}`}>
          <Link className={styles.brand} to="/workbench">
            <span>FF - DeepSeek Harness Web</span>
          </Link>
          <div className={styles.headerMeta}>
            <div className={styles.runtimeBadge}><Bot size={15} /> {runtimeName}</div>
            <a className={styles.githubBadge} href="https://github.com/fufankeji/DeepSeekHarnessWeb" target="_blank" rel="noreferrer" aria-label="打开 DeepSeek Harness Web GitHub 仓库">
              <img src="/brand/github-mark.svg" alt="" aria-hidden="true" /> GitHub
            </a>
          </div>
        </header>
        {connection !== "connected" && (
          <div className={styles.connectionBanner} role="status">
            <AlertTriangle size={16} />
            {connection === "reconnecting" ? "正在重新连接，当前内容可能已过期" : "当前连接已断开，运行结果无法确认"}
            <Link to="/diagnostics">查看诊断</Link>
          </div>
        )}
        <main className={`${styles.content} ${lockContentViewport ? styles.lockedContent : ""}`}>{children}</main>
        <footer className={styles.productFooter}>@赋范空间 独家研发</footer>
      </div>
      <AnimatePresence>
        {notice && (
          <motion.div className={styles.toast} role="status" initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }}>
            <CheckCircle2 size={17} />{notice}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function RailLink({ active, expanded, to, label, children }: { active: boolean; expanded: boolean; to: string; label: string; children: ReactNode }) {
  const link = <Link className={`${styles.railLink} ${active ? styles.active : ""}`} to={to} aria-label={label}>
    {active && <motion.span className={styles.activeRail} layoutId="active-rail" />}
    <span className={styles.navGlyph}>{children}</span>
    <span className={styles.railLabel}>{label}</span>
  </Link>;

  return expanded ? link : <ThemeTooltip content={label}>{link}</ThemeTooltip>;
}

function WorkspaceGlyph() {
  return <svg className={styles.productGlyph} viewBox="0 0 24 24" aria-hidden="true">
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <path d="m7.5 9 3 3-3 3M13 15h3.5" />
  </svg>;
}

function DiagnosticsGlyph() {
  return <svg className={styles.productGlyph} viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="8.5" />
    <path d="M7 12h2.4l1.55-3.25 2.1 6.5L14.6 12H17" />
  </svg>;
}
