import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { motion } from "motion/react";
import {
  ArrowRight,
  Check,
  ChevronRight,
  CircleAlert,
  Cpu,
  Eye,
  EyeOff,
  FolderCode,
  KeyRound,
  Laptop,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Sparkles
} from "lucide-react";
import { AppShell } from "../components/AppShell";
import { ThemeSelect } from "../components/ThemeSelect";
import { useAppDispatch, useAppSelector } from "../app/hooks";
import { harnessActions } from "../app/store";
import {
  useCreateSessionMutation,
  useGetModelSourcesQuery,
  useGetDiagnosticsQuery,
  useGetSessionsQuery,
  useGetWorkspaceQuery,
  useImportWorkspaceMutation,
  useCreateStarterWorkspaceMutation,
  usePickWorkspaceMutation,
  useProbeRuntimeMutation,
  useSelectRuntimeMutation,
  useSelectWorkspaceMutation,
  useSetWorkspaceTrustMutation
} from "../api/bridge-api";
import { connectModelEphemeral } from "../api/model-connect";
import type { RuntimeChoice, SetupState, SetupStep } from "../contracts/view-model";
import styles from "./SetupPage.module.css";

const orderedSteps: SetupStep[] = ["environment", "model", "workspace", "trust"];
const DSH_DISPLAY_VERSION = "0.1.0-rc.6 · 已发布";

export function SetupPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedStep = setupStepFromQuery(searchParams.get("step"));
  const setup = useAppSelector((state) => state.harness.setup);
  const model = useAppSelector((state) => state.harness.model);
  const workspace = useAppSelector((state) => state.harness.workspace);
  const runtime = useAppSelector((state) => state.harness.runtime);
  const [apiKey, setApiKey] = useState("");
  const [workspacePath, setWorkspacePath] = useState("");
  const [workspacePathVerified, setWorkspacePathVerified] = useState(false);
  const [gitUrl, setGitUrl] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [furthestVisitedIndex, setFurthestVisitedIndex] = useState(() => requestedStep ? orderedSteps.indexOf(requestedStep) : 0);
  const [viewMode, setViewMode] = useState<"detecting" | "summary" | "editor">(() => requestedStep ? "editor" : runtime?.status === "ready" && model?.status === "ready" && workspace?.status === "ready" && setup.trust !== "undecided" ? "summary" : "detecting");
  const diagnostics = useGetDiagnosticsQuery();
  const currentWorkspace = useGetWorkspaceQuery(undefined, { skip: diagnostics.isLoading || diagnostics.data?.workspace.status === "unselected" });
  const [probeRuntime] = useProbeRuntimeMutation();
  const [selectRuntime] = useSelectRuntimeMutation();
  const [selectWorkspace] = useSelectWorkspaceMutation();
  const [pickWorkspace] = usePickWorkspaceMutation();
  const [importWorkspace] = useImportWorkspaceMutation();
  const [createStarterWorkspace] = useCreateStarterWorkspaceMutation();
  const [setWorkspaceTrust] = useSetWorkspaceTrustMutation();
  const [createSession] = useCreateSessionMutation();
  const modelSources = useGetModelSourcesQuery();
  const sessionsQuery = useGetSessionsQuery(undefined, { skip: setup.workspace !== "complete" });

  useEffect(() => {
    if (!requestedStep) return;
    const index = orderedSteps.indexOf(requestedStep);
    setViewMode("editor");
    setFurthestVisitedIndex((value) => Math.max(value, index));
    dispatch(harnessActions.setSetupStep(requestedStep));
  }, [dispatch, requestedStep]);

  useEffect(() => {
    if (!diagnostics.data) return;
    const hasExistingConfiguration = diagnostics.data.model.status !== "unconfigured" || diagnostics.data.workspace.status !== "unselected";
    if (!hasExistingConfiguration) {
      if (viewMode === "detecting") setViewMode("editor");
      return;
    }
    dispatch(harnessActions.setRuntime(diagnostics.data.adapter));
    dispatch(harnessActions.setModel(diagnostics.data.model));
    dispatch(harnessActions.setCapabilityDecisions(diagnostics.data.capabilityDecisions));
    if (viewMode === "detecting" && (diagnostics.data.adapter.status !== "ready" || diagnostics.data.model.status !== "ready" || diagnostics.data.workspace.status === "unselected")) setViewMode("editor");
  }, [diagnostics.data, dispatch, viewMode]);

  useEffect(() => {
    if (currentWorkspace.data) {
      dispatch(harnessActions.hydrateWorkspace(currentWorkspace.data));
      if (viewMode === "detecting" && diagnostics.data?.adapter.status === "ready" && diagnostics.data.model.status === "ready") setViewMode("summary");
    } else if (viewMode === "detecting" && currentWorkspace.isError) {
      setViewMode("editor");
    }
  }, [currentWorkspace.data, currentWorkspace.isError, diagnostics.data, dispatch, viewMode]);

  const configured = runtime?.status === "ready" && model?.status === "ready" && workspace?.status === "ready" && setup.trust !== "undecided";
  const loadingConfiguration = viewMode === "detecting";

  const currentIndex = orderedSteps.indexOf(setup.currentStep);
  const canContinue = useMemo(() => {
    if (setup.currentStep === "environment") return setup.environment === "complete";
    if (setup.currentStep === "model") return setup.model === "complete";
    if (setup.currentStep === "workspace") return setup.workspace === "complete" && (workspacePathVerified || workspace?.status === "ready");
    return setup.trust !== "undecided";
  }, [setup, workspace, workspacePathVerified]);

  const checkEnvironment = async () => {
    dispatch(harnessActions.setSetupStatus({ key: "environment", value: "checking" }));
    try {
      const adapterId = setup.runtimeChoice === "deepseek-harness" ? "deepseek-official" : "pi";
      const selected = await selectRuntime({ adapterId }).unwrap();
      const result = selected.adapterId === adapterId ? selected : await probeRuntime().unwrap();
      dispatch(harnessActions.setRuntime(result));
      if (result.status !== "ready") throw new Error("本地运行环境版本不兼容");
    } catch (error) {
      dispatch(harnessActions.setSetupStatus({ key: "environment", value: "error", errorMessage: errorMessage(error) }));
    }
  };

  const checkModel = async () => {
    dispatch(harnessActions.setSetupStatus({ key: "model", value: "checking" }));
    try {
      const result = await connectModelEphemeral({ apiKey, modelId: setup.modelId, thinkingLevel: setup.thinkingLevel, verify: true });
      dispatch(harnessActions.setModel(result));
      setApiKey("");
      setShowKey(false);
    } catch (error) {
      setApiKey("");
      setShowKey(false);
      dispatch(harnessActions.setSetupStatus({ key: "model", value: "error", errorMessage: errorMessage(error) }));
    }
  };

  const checkConfiguredModel = async () => {
    dispatch(harnessActions.setSetupStatus({ key: "model", value: "checking" }));
    try {
      const result = await connectModelEphemeral({ credentialSource: "configured-file", modelId: setup.modelId, thinkingLevel: setup.thinkingLevel, verify: true });
      dispatch(harnessActions.setModel(result));
    } catch (error) {
      dispatch(harnessActions.setSetupStatus({ key: "model", value: "error", errorMessage: errorMessage(error) }));
    }
  };

  const chooseWorkspace = async () => {
    dispatch(harnessActions.setSetupStatus({ key: "workspace", value: "checking" }));
    try {
      const result = await selectWorkspace({ path: workspacePath, projectTrusted: false }).unwrap();
      setWorkspacePathVerified(true);
      dispatch(harnessActions.setWorkspace(result));
    } catch (error) {
      dispatch(harnessActions.setSetupStatus({ key: "workspace", value: "error", errorMessage: errorMessage(error) }));
    }
  };

  const chooseWorkspaceDirectory = async () => {
    dispatch(harnessActions.setSetupStatus({ key: "workspace", value: "checking" }));
    try {
      const result = await pickWorkspace().unwrap();
      if (result.cancelled) {
        dispatch(harnessActions.setSetupStatus({ key: "workspace", value: workspace?.status === "ready" ? "complete" : "idle" }));
        return;
      }
      setWorkspacePath(result.selectedPath);
      setWorkspacePathVerified(true);
      setGitUrl("");
      dispatch(harnessActions.setWorkspace(result.workspace));
    } catch (error) {
      dispatch(harnessActions.setSetupStatus({ key: "workspace", value: "error", errorMessage: errorMessage(error) }));
    }
  };

  const importGitWorkspace = async () => {
    dispatch(harnessActions.setSetupStatus({ key: "workspace", value: "checking" }));
    try {
      const result = await importWorkspace({ url: gitUrl }).unwrap();
      setWorkspacePath("");
      setWorkspacePathVerified(false);
      dispatch(harnessActions.setWorkspace(result));
    } catch (error) {
      dispatch(harnessActions.setSetupStatus({ key: "workspace", value: "error", errorMessage: errorMessage(error) }));
    }
  };

  const useStarterWorkspace = async () => {
    dispatch(harnessActions.setSetupStatus({ key: "workspace", value: "checking" }));
    try {
      const result = await createStarterWorkspace({ templateVersion: "counter-v1" }).unwrap();
      setWorkspacePath("");
      setWorkspacePathVerified(false);
      setGitUrl("");
      dispatch(harnessActions.setWorkspace(result));
    } catch (error) {
      dispatch(harnessActions.setSetupStatus({ key: "workspace", value: "error", errorMessage: errorMessage(error) }));
    }
  };

  const chooseTrust = async (value: "restricted" | "trusted") => {
    try {
      const result = await setWorkspaceTrust({ projectTrusted: value === "trusted" }).unwrap();
      dispatch(harnessActions.setWorkspace(result));
      dispatch(harnessActions.setTrust(value));
    } catch (error) {
      dispatch(harnessActions.showNotice(errorMessage(error)));
    }
  };

  const next = async () => {
    if (currentIndex === orderedSteps.length - 1) {
      if (finishing) return;
      setFinishing(true);
      try {
        const sessions = await sessionsQuery.refetch().unwrap();
        if (sessions.sessions.length === 0) {
          const session = await createSession({ name: "新的开发任务" }).unwrap();
          dispatch(harnessActions.setCurrentSession(session));
        } else {
          dispatch(harnessActions.restoreActiveSession({
            sessions: sessions.sessions,
            activeSessionId: sessions.activeSessionId ?? sessions.sessions[0]?.id ?? null
          }));
        }
        navigate("/workbench");
      } catch (error) {
        setFinishing(false);
        dispatch(harnessActions.showNotice(errorMessage(error)));
      }
      return;
    }
    setFurthestVisitedIndex((value) => Math.max(value, currentIndex + 1));
    dispatch(harnessActions.setSetupStep(orderedSteps[currentIndex + 1]!));
  };

  const previous = () => {
    if (currentIndex === 0) return;
    dispatch(harnessActions.setSetupStep(orderedSteps[currentIndex - 1]!));
  };

  const beginReconfiguration = () => {
    setFurthestVisitedIndex(0);
    dispatch(harnessActions.setSetupStep("environment"));
    setViewMode("editor");
  };

  const openVisitedStep = (step: SetupStep, index: number) => {
    if (index > furthestVisitedIndex) return;
    dispatch(harnessActions.setSetupStep(step));
  };

  return (
    <AppShell compactHeader>
      <div className={styles.page}>
        <section className={styles.hero}>
          <div className={styles.ambientOne} />
          <div className={styles.ambientTwo} />
          <div className={styles.heroContent}>
            <div className={styles.productKicker}>FF - DeepSeek Harness Web</div>
            <h1>DeepSeek Harness<br />可视化开发工作台</h1>
            <p>在浏览器中打开本地代码目录、提交开发任务，并实时查看执行过程、代码修改、命令输出、测试结果与文件 Diff。</p>
            <div className={styles.heroFacts}>
              <span><Check size={15} /> 浏览与检索代码</span>
              <span><Check size={15} /> 跟踪任务执行</span>
              <span><Check size={15} /> 审阅变更与结果</span>
            </div>
          </div>
        </section>

        <section className={`${styles.setupPanel} ${configured && viewMode === "summary" ? styles.summaryPanel : ""}`}>
          {configured && viewMode === "summary" ? <ConfigurationSummary runtimeName={runtime?.displayName ?? "Pi Harness + DeepSeek"} runtimeVersion={runtime?.harnessVersion ?? "—"} modelId={model?.modelId ?? setup.modelId} thinkingLevel={model?.thinkingLevel ?? setup.thinkingLevel} workspace={workspace} trust={setup.trust} onBack={() => navigate("/workbench")} onReconfigure={beginReconfiguration} /> : <>
          <div className={styles.panelHeader}>
            <div><span className={styles.stepCount}>{runtime || workspace ? "配置设置" : "首次设置"} · {currentIndex + 1} / 4</span><h2>完成以下设置后即可进入工作台</h2></div>
          </div>

          <nav className={styles.stepper} aria-label="配置步骤">
            {orderedSteps.map((step, index) => (
              <button key={step} disabled={index > furthestVisitedIndex} className={`${styles.stepItem} ${index === currentIndex ? styles.currentStep : ""} ${index < currentIndex && index <= furthestVisitedIndex ? styles.completeStep : ""}`} onClick={() => openVisitedStep(step, index)}>
                <span className={styles.stepIcon}>{index < currentIndex && index <= furthestVisitedIndex ? <Check size={15} /> : index + 1}</span>
                <span>{stepLabel(step)}</span>
                {index < 3 && <ChevronRight className={styles.chevron} size={15} />}
              </button>
            ))}
          </nav>

          <motion.div key={setup.currentStep} className={styles.stepBody} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.2 }}>
            {setup.currentStep === "environment" && <EnvironmentStep runtimeChoice={setup.runtimeChoice} status={setup.environment} error={setup.errorMessage} nodeVersion={runtime?.nodeVersion} runtimeLabel={runtime?.harnessId === "pi" ? "Pi Harness" : runtime?.displayName} runtimeVersion={runtime?.harnessVersion} onRuntimeChange={(value) => dispatch(harnessActions.setRuntimeChoice(value))} onCheck={() => void checkEnvironment()} />}
            {setup.currentStep === "model" && (
              <ModelStep runtimeChoice={setup.runtimeChoice} status={setup.model} error={setup.errorMessage} modelId={setup.modelId} thinkingLevel={setup.thinkingLevel} availableThinkingLevels={model?.availableThinkingLevels ?? ["high", "max"]} apiKey={apiKey} showKey={showKey} configuredFile={modelSources.data?.configuredFile === true} onToggleKey={() => setShowKey((value) => !value)} onModelChange={(value) => dispatch(harnessActions.setModelId(value))} onThinkingLevelChange={(value) => dispatch(harnessActions.setThinkingLevel(value))} onKeyChange={setApiKey} onCheck={() => void checkModel()} onCheckConfigured={() => void checkConfiguredModel()} />
            )}
            {setup.currentStep === "workspace" && (
              <WorkspaceStep status={setup.workspace} error={setup.errorMessage} workspace={workspace} path={workspacePath} pathVerified={workspacePathVerified} gitUrl={gitUrl} onPathChange={(value) => { setWorkspacePath(value); setWorkspacePathVerified(false); }} onGitUrlChange={setGitUrl} onSelect={() => void chooseWorkspace()} onPick={() => void chooseWorkspaceDirectory()} onStarter={() => void useStarterWorkspace()} onImport={() => void importGitWorkspace()} />
            )}
            {setup.currentStep === "trust" && <TrustStep trust={setup.trust} onSelect={(value) => void chooseTrust(value)} />}
          </motion.div>

          <footer className={styles.panelFooter}>
            <div>{currentIndex > 0 ? <button className={styles.resetButton} onClick={previous}><ArrowRight className={styles.backArrow} size={15} /> 上一步</button> : configured ? <button className={styles.resetButton} onClick={() => setViewMode("summary")}>取消重新配置</button> : null}</div>
            <button className={styles.nextButton} disabled={!canContinue || finishing} onClick={() => void next()}>{currentIndex === 3 ? finishing ? "正在完成设置" : "完成设置并进入工作台" : "下一步"} <ArrowRight size={17} /></button>
          </footer>
          </>}
          {loadingConfiguration && <div className={styles.configurationLoading}><LoaderCircle className={styles.spinner} size={20} /> 正在读取当前配置…</div>}
        </section>
      </div>
    </AppShell>
  );
}

function EnvironmentStep({ runtimeChoice, status, error, nodeVersion, runtimeLabel, runtimeVersion, onRuntimeChange, onCheck }: { runtimeChoice: RuntimeChoice; status: string; error: string | null; nodeVersion: string | undefined; runtimeLabel: string | undefined; runtimeVersion: string | undefined; onRuntimeChange: (value: RuntimeChoice) => void; onCheck: () => void }) {
  const successDetail = <span>Node {nodeVersion ?? "24.16.0"} · {runtimeLabel ?? "Harness"} {runtimeVersion ?? "已探测"}</span>;
  return <div className={styles.stepGrid}><div className={styles.copyBlock}><div className={styles.environmentHeading}><span className={styles.bigIcon}><Laptop size={21} /></span><div><span className={styles.sectionLabel}>开发环境</span><h3>选择 Harness 运行方式</h3></div></div><p>选择负责执行开发任务的 Harness，再检查当前机器是否满足运行要求。</p><div className={styles.runtimeChoices} role="radiogroup" aria-label="Harness 运行方式"><button className={`${styles.runtimeChoice} ${runtimeChoice === "pi-deepseek" ? styles.runtimeSelected : ""}`} role="radio" aria-checked={runtimeChoice === "pi-deepseek"} onClick={() => onRuntimeChange("pi-deepseek")}><span><Cpu size={18} /></span><strong>Pi + DeepSeek</strong><small>兼容运行时 · 已完成真实链路验证</small></button><button className={`${styles.runtimeChoice} ${runtimeChoice === "deepseek-harness" ? styles.runtimeSelected : ""}`} role="radio" aria-checked={runtimeChoice === "deepseek-harness"} onClick={() => onRuntimeChange("deepseek-harness")}><span><Sparkles size={18} /></span><strong>DeepSeek Harness</strong><small>官方 DSH · {DSH_DISPLAY_VERSION}</small></button></div><button className={styles.primaryAction} onClick={onCheck} disabled={status === "checking"}>{status === "checking" ? <><LoaderCircle className={styles.spinner} size={17} /> 正在检查</> : status === "complete" ? <><RefreshCw size={16} /> 重新检查</> : "开始检查"}</button></div><StatusCard status={status} error={error} successTitle="开发环境已就绪" successDetail={successDetail} errorTitle="开发环境尚未准备好" checkingTitle="正在检查开发环境" idleTitle="尚未检查" idleDetail="开始检查后，这里会显示真实结果" /></div>;
}

function ModelStep(props: { runtimeChoice: RuntimeChoice; status: string; error: string | null; modelId: string; thinkingLevel: "high" | "max"; availableThinkingLevels: Array<"high" | "max">; apiKey: string; showKey: boolean; configuredFile: boolean; onToggleKey: () => void; onModelChange: (value: string) => void; onThinkingLevelChange: (value: "high" | "max") => void; onKeyChange: (value: string) => void; onCheck: () => void; onCheckConfigured: () => void }) {
  const thinkingOptions = props.availableThinkingLevels.map((value) => ({ value, label: value === "max" ? "最大 · 复杂 Agent 任务" : "高 · 标准推理强度" }));
  const credentialDetail = props.runtimeChoice === "deepseek-harness" ? "官方运行时临时凭证，退出后清除" : "凭证仅保存在 Bridge 内存";
  return <div className={styles.stepGrid}><div className={styles.formBlock}><div className={styles.fieldHeader}><KeyRound size={18} /><div><h3>连接 DeepSeek</h3><p>填写模型凭证，系统会通过当前 Harness 发起一次真实连接检查。</p></div></div><div className={styles.formInset}><label className={styles.fieldLabel}>API Key</label><div className={styles.passwordField}><input type={props.showKey ? "text" : "password"} value={props.apiKey} onChange={(event) => props.onKeyChange(event.target.value)} placeholder="输入 DeepSeek API Key" autoComplete="off" /><button onClick={props.onToggleKey} aria-label={props.showKey ? "隐藏 API Key" : "显示 API Key"}>{props.showKey ? <EyeOff size={17} /> : <Eye size={17} />}</button></div><p className={styles.securityHint}><ShieldCheck size={14} /> API Key 不进入浏览器存储；{props.runtimeChoice === "deepseek-harness" ? "仅供本次官方 DSH 进程使用，退出即清除。" : "只保存在本地 Bridge 内存。"}</p><label className={styles.fieldLabel} htmlFor="model">模型</label><ThemeSelect id="model" value={props.modelId} onValueChange={props.onModelChange} options={[{ value: "deepseek-v4-flash", label: "DeepSeek V4 Flash" }, { value: "deepseek-v4-pro", label: "DeepSeek V4 Pro" }]} /><label className={styles.fieldLabel} htmlFor="thinking-level">思考强度</label><ThemeSelect id="thinking-level" value={props.thinkingLevel} onValueChange={(value) => props.onThinkingLevelChange(value as "high" | "max")} ariaLabel="思考强度" options={thinkingOptions} /><p className={styles.optionalHint}>DeepSeek V4 的有效档位为高和最大；低、中档会被接口映射为高。</p><div className={styles.workspaceActions}><button className={styles.primaryAction} onClick={props.onCheck} disabled={!props.apiKey || props.status === "checking"}>{props.status === "checking" ? <><LoaderCircle className={styles.spinner} size={17} /> 正在真实连接</> : props.status === "complete" ? "使用新凭证检查" : "检查模型连接"}</button>{props.configuredFile && <button className={styles.secondaryAction} onClick={props.onCheckConfigured} disabled={props.status === "checking"}>{props.status === "complete" ? "重新验证本机凭证" : "使用本机已配置凭证"}</button>}</div></div></div><StatusCard status={props.status} error={props.error} successTitle="DeepSeek 已就绪" successDetail={`${props.modelId} · ${thinkingLevelLabel(props.thinkingLevel)}思考强度 · ${credentialDetail}`} errorTitle="DeepSeek 连接失败" /></div>;
}

function WorkspaceStep(props: { status: string; error: string | null; workspace: { name: string; branch: string | null; fileCount: number; fileScanLimited: boolean; displayPath: string } | null; path: string; pathVerified: boolean; gitUrl: string; onPathChange: (value: string) => void; onGitUrlChange: (value: string) => void; onSelect: () => void; onPick: () => void; onStarter: () => void; onImport: () => void }) {
  const detail = props.workspace ? `${props.workspace.branch ?? "普通目录"} · ${props.workspace.fileCount} 个文件${props.workspace.fileScanLimited ? "（列表受限）" : ""} · ${props.workspace.displayPath}` : "完成选择后显示工作区事实";
  return <div className={styles.stepGrid}><div className={styles.formBlock}><div className={styles.fieldHeader}><FolderCode size={18} /><div><h3>选择代码工作区</h3><p>无需配置 Git。选择一个普通文件夹即可开始，也可以先使用系统准备好的示例项目。</p></div></div><div className={styles.formInset}><div className={styles.starterWorkspace}><div><strong>还没有代码项目？</strong><span>创建一份本机示例工作区，进入后可以直接让 Harness 读写代码。</span></div><button className={styles.secondaryAction} onClick={props.onStarter} disabled={props.status === "checking"}>使用示例工作区</button></div><div className={styles.optionalDivider}><span>或者打开自己的文件夹</span></div><label className={styles.fieldLabel} htmlFor="workspace-path">本地工作区</label><div className={styles.inlineField}><input id="workspace-path" className={styles.pathField} value={props.path} onChange={(event) => props.onPathChange(event.target.value)} placeholder="尚未选择目录" /><button className={styles.secondaryAction} onClick={props.onPick} disabled={props.status === "checking"}>{props.pathVerified && props.status === "complete" ? "重新选择" : "选择目录"}</button></div>{props.path.trim() && !props.pathVerified && <button className={styles.openPastedPath} onClick={props.onSelect} disabled={props.status === "checking"}>打开已填写路径</button>}<p className={`${styles.optionalHint} ${props.pathVerified && props.status === "complete" ? styles.selectedHint : ""}`}>{props.pathVerified && props.status === "complete" ? <><Check size={13} /> 已选择此目录，可以直接点击“下一步”</> : "普通文件夹即可使用；系统会自动记录每轮代码变化。"}</p><div className={styles.optionalDivider}><span>已有远程仓库时，可选</span></div><label className={styles.fieldLabel} htmlFor="git-url">Git 仓库地址 <span>选填，不影响普通目录使用</span></label><div className={styles.inlineField}><input id="git-url" className={styles.pathField} value={props.gitUrl} onChange={(event) => props.onGitUrlChange(event.target.value)} placeholder="选填：粘贴 Git 仓库地址" /><button className={styles.secondaryAction} onClick={props.onImport} disabled={!props.gitUrl.trim() || props.status === "checking"}>导入仓库</button></div></div></div><StatusCard status={props.status} error={props.error} successTitle={props.workspace?.name ?? "工作区已就绪"} successDetail={detail} errorTitle="工作区访问失败" checkingTitle="正在读取工作区事实" /></div>;
}

function TrustStep({ trust, onSelect }: { trust: string; onSelect: (value: "restricted" | "trusted") => void }) {
  return <div><div className={styles.trustHeading}><LockKeyhole size={21} /><div><h3>设置项目访问权限</h3><p>决定是否加载项目自己的配置与扩展。具体读写限制由当前 Harness 的沙箱能力独立执行，不代表命令已经过人工审批。</p></div></div><div className={styles.trustContent}><div className={styles.trustCards}><button className={`${styles.trustCard} ${trust === "restricted" ? styles.trustSelected : ""}`} onClick={() => onSelect("restricted")}><ShieldCheck size={23} /><strong>受限模式</strong><span>推荐首次打开项目时使用</span><small>不加载项目自定义资源；支持时同时启用只读沙箱</small></button><button className={`${styles.trustCard} ${trust === "trusted" ? styles.trustSelected : ""}`} onClick={() => onSelect("trusted")}><Sparkles size={23} /><strong>信任项目资源</strong><span>仅用于你确认来源的项目</span><small>允许当前 Harness 读取项目配置与扩展；写入范围仍由 Harness 控制</small></button></div></div></div>;
}

function ConfigurationSummary({ runtimeName, runtimeVersion, modelId, thinkingLevel, workspace, trust, onBack, onReconfigure }: { runtimeName: string; runtimeVersion: string; modelId: string; thinkingLevel: "high" | "max"; workspace: { name: string; displayPath: string } | null; trust: SetupState["trust"]; onBack: () => void; onReconfigure: () => void }) {
  return <div className={styles.configurationSummary}><div className={styles.summaryHero}><span><Check size={24} /></span><div><small>环境设置</small><h2>当前环境已配置</h2><p>以下配置已经过真实检查，可直接返回工作台继续使用。</p></div></div><dl className={styles.summaryList}><SummaryItem number="1" label="Harness 运行方式" title={runtimeName} detail={runtimeVersion} /><SummaryItem number="2" label="DeepSeek 模型" title={modelId} detail={`${thinkingLevelLabel(thinkingLevel)}思考强度 · 已验证`} /><SummaryItem number="3" label="代码工作区" title={workspace?.name ?? "已选择"} detail={workspace?.displayPath ?? "工作区已就绪"} /><SummaryItem number="4" label="项目访问权限" title={trust === "trusted" ? "信任项目资源" : "受限模式"} detail={trust === "trusted" ? "加载项目配置与扩展；写入范围由 Harness 控制" : "不加载项目自定义资源；支持时启用只读沙箱"} /></dl><div className={styles.summaryNotice}><ShieldCheck size={17} /><span>API Key 不进入浏览器存储；当前 Harness 按自己的安全边界管理运行时凭证。</span></div><footer className={styles.summaryActions}><button className={styles.secondaryAction} onClick={onReconfigure}><RefreshCw size={16} /> 重新配置</button><button className={styles.nextButton} onClick={onBack}>返回工作台 <ArrowRight size={17} /></button></footer></div>;
}

function SummaryItem({ number, label, title, detail }: { number: string; label: string; title: string; detail: string }) {
  return <div><span className={styles.summaryNumber}>{number}</span><dt>{label}</dt><dd><strong>{title}</strong><span>{detail}</span></dd></div>;
}

function StatusCard({ status, error, successTitle, successDetail, errorTitle, checkingTitle = "正在检查", idleTitle = "尚未开始", idleDetail = "完成左侧操作后，这里会显示结果" }: { status: string; error: string | null; successTitle: string; successDetail: ReactNode; errorTitle: string; checkingTitle?: string; idleTitle?: string; idleDetail?: ReactNode }) {
  const content = status === "complete" ? { tone: styles.successCard, icon: <Check size={22} />, title: successTitle, detail: successDetail } : status === "error" ? { tone: styles.errorCard, icon: <CircleAlert size={22} />, title: errorTitle, detail: error ?? "请根据提示处理后重新检查" } : status === "checking" ? { tone: styles.checkingCard, icon: <LoaderCircle className={styles.spinner} size={22} />, title: checkingTitle, detail: "正在等待真实结果" } : { tone: "", icon: <Check size={22} />, title: idleTitle, detail: idleDetail };
  return <div className={`${styles.statusCard} ${content.tone}`}><span>{content.icon}</span><h3>{content.title}</h3><div className={styles.statusDetail}>{content.detail}</div></div>;
}

function stepLabel(step: SetupStep): string {
  return { environment: "开发环境", model: "连接 DeepSeek", workspace: "选择工作区", trust: "访问权限" }[step];
}

function thinkingLevelLabel(value: "high" | "max"): string {
  return value === "max" ? "最大" : "高";
}

function setupStepFromQuery(value: string | null): SetupStep | null {
  if (value === "environment" || value === "model" || value === "workspace" || value === "trust") return value;
  return null;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "object" && error !== null && "data" in error) {
    const data = (error as { data?: unknown }).data;
    if (typeof data === "object" && data !== null && "error" in data) {
      const detail = (data as { error?: unknown }).error;
      if (typeof detail === "object" && detail !== null && "message" in detail && typeof (detail as { message?: unknown }).message === "string") return (detail as { message: string }).message;
    }
  }
  return "本地 Bridge 请求失败，请查看运行诊断。";
}
