# AGENTS.md

> `FF - DeepSeek Harness Web`：为 DeepSeek Harness 提供可快速适配的 Web 操作环境。

## 项目定位

- 项目根目录名：`DeepSeekHarnessWeb`
- 对外产品名：`FF - DeepSeek Harness Web`
- 内部工程标识：`deepseek-harness-web`
- 目标用户：希望通过浏览器操作 DeepSeek Harness 或 Pi Agent 的开发者与技术用户。
- P0 核心旅程：选择 `DeepSeekOfficialAdapter` 或 `PiHarnessAdapter` → 配置 DeepSeek → 选择工作区 → 创建或继续会话 → 提交任务 → 查看消息、推理、工具与命令执行 → 检查文件 Diff 与产物 → 中断、继续、分叉或结束会话。
- V0.1 范围：官方 `DeepSeek Harness` 与 `PiHarnessAdapter + DeepSeek` 两条真实运行链、内置示例/普通目录/可选 Git 工作区、会话、任务输入、流式执行时间线、工具与命令输出、运行控制、本轮文件变化与代码 Diff、产物、原始事件和诊断。
- 当前开发状态：高保真前端、真实 Local Bridge、`DeepSeekOfficialAdapter`、`PiHarnessAdapter + DeepSeek`、持久化和诊断已实现；官方 DSH `0.1.0-rc.6` 已完成真实模型、命令、工具、Diff、分叉与恢复回归。后续改动不得退回演示状态。
- 明确不做：后端 Mock Server、`MockAdapter`、假 Agent 循环；Codex、Claude 或其他替代 Harness Adapter；复制 Pi 内部实现；提前开发审批、多 Agent、记忆、Skills/Prompt Templates 的安装编辑管理、Extension 交互式 UI Bridge、MCP、检查点或云沙箱。已信任 Session 中真实加载的 Skills/Prompt Templates 可通过结构化命令目录显式调用。

## 品牌与产品语言

- 用户可见名称逐字使用 `FF - DeepSeek Harness Web`；内部工程名、缩写和临时代号不得进入界面。
- 产品界面默认使用简体中文；命令、文件名、模型名、协议字段以及 `Harness`、`Adapter`、`Diff` 等必要技术标识保留原文，不为了表面汉化牺牲技术准确性。
- Logo 唯一来源：`frontend/public/brand/ff-logo.png`；原始文件为 PNG、RGB、300×300，SHA-256 为 `522944bbaee48d98190c8c5a0a0ac80f05b71b1975838807742a782e2aeceedc`。
- Logo 必须出现在左上角全局导航，并与完整产品名组合；不得覆盖、重绘、反色、改色、裁切、拉伸或添加装饰效果。
- 凡出现版权、脚注或研发署名，逐字使用 `@赋范空间 独家研发`；当前应用壳所有页面统一显示该脚注。
- 使用“工作区、会话、任务、执行、审批、文件变化、终端、产物、Harness”等可观察术语；避免“驾驶舱、宇宙、中枢、大脑、魔法”等包装词。

## 目录与架构边界

```text
DeepSeekHarnessWeb/
├── frontend/  # Web UI、前端状态、测试、静态资源和专属配置
├── backend/   # 本地 Bridge、工作区/会话服务、Adapter、测试和专属配置
├── docs/      # PRD、规格、架构、计划和验证证据
├── README.md
├── AGENTS.md
└── CLAUDE.md
```

- 根目录只保留项目级文档和真实跨服务编排文件。
- `frontend/` 只消费统一 Harness 合同，不得直接解析 Pi 或 DeepSeek 官方 Harness 的专属对象和事件。
- `backend/` 负责 Pi 进程/SDK 生命周期、DeepSeek 配置、文件系统、Git、会话持久化、Harness Adapter 和本地凭证处理。
- 官方专属命令、字段、事件和兼容逻辑只能存在于 `backend/` 的官方 Adapter 内。
- Pi 专属会话、事件、配置和兼容逻辑只能存在于 `PiHarnessAdapter` 内。
- Harness 运行状态与 DeepSeek 模型连接状态分别建模，但当前 DeepSeek 配置只经 `PiHarnessAdapter` 交给 Pi，不另建独立 Agent Loop 或 `DeepSeekResponsesProvider`。
- API Key 不得进入浏览器持久化、统一事件、日志、测试夹具或版本库。
- 统一事件允许保留经过字段白名单与脱敏的可选 `raw` 元数据；未知事件降级为 `raw`，不得转储完整上游对象或造成核心页面崩溃。
- 功能是否出现由当前 Adapter 的真实能力探测决定；Pi 没有的能力不得通过前端或 Bridge 模拟成已支持。
- 本轮 Diff 与文件变化观察由 Bridge 的 Run 前轻量快照提供，不依赖 Harness 是否输出对应事件，也不要求工作区初始化 Git；Git 仅作为可选导入与仓库状态能力。
- 不为目录整齐凭空添加 workspace、Compose、CI、数据库或部署设施。

## Pi、DeepSeek 与官方 Harness 边界

- **双运行时并存**：`DeepSeekOfficialAdapter` 与 `PiHarnessAdapter` 都是真实兼容目标；切换运行时不得删除或降级另一条链路。
- **模型与 Harness 分层**：Pi 使用 DeepSeek API；官方链路使用 DSH 控制面。模型连接成功与 Harness 运行时就绪仍是不同事实。
- **官方 Driver 固定**：当前固定 `@deepseek-ai/dsh@0.1.0-rc.6`，由 Bridge 托管 `dsh --profile web` 子进程，通过官方 HTTP RPC 和 WebSocket 事件接入；该传输只存在于官方 Adapter 内。未信任项目必须使用产品托管的 `ff-restricted` Agent Preset，并从 DSH 启动时设置 `read-only`，不得先按默认权限启动再事后降级。
- **不复制 Pi**：不得搬运、分叉或重写 Pi 的 Agent Loop、会话管理和工具调度；只调用其公开 SDK/RPC 并映射统一合同。
- **按真实能力开发**：会话、恢复、分叉、流式消息、工具事件、压缩、重试和中断均以实际探测为准。Pi 默认没有的审批、沙箱、MCP、Subagent 和 Plan Mode 不进入 V0.1。
- **明确运行时身份**：界面必须按当前 Adapter 显示真实运行时；Pi 链路显示“Pi Harness + DeepSeek”，官方链路使用发布后的真实名称，两者不得混称。
- **官方字段不得外泄**：DSH RPC、WebSocket frame、命令名和事件字段只在 `DeepSeekOfficialAdapter` 内映射；共享 UI 继续只消费统一合同。
- **真实状态边界**：生产页面只消费 Bridge HTTP 快照、命令回执、SSE 统一事件和 Bridge/Git 文件事实；不得新增 Mock Adapter、定时假事件、手写成功入口或把测试状态标成真实运行。
- **禁止旁路扩张**：未经新的产品决策，不得新增后端 Mock Server、`MockAdapter`、Codex、Claude、Generic PTY/JSONL 或其他 Harness Adapter。

## 文档职责

- `docs/PRD.md`：用户价值、范围、需求 ID 和 Given/When/Then 验收。
- `docs/specs/product-spec.md`：页面、状态、交互、能力和统一事件合同。
- `docs/specs/ui-state-spec.md`：主工作台、首次进入、异常、断连、检查器和结果页的 UI 状态与动效合同；前端不得另造同义状态。
- `docs/specs/feature-modules-spec.md`：FM-01～11 的功能深度、责任边界、验收和模块级陷阱；UI 与实现不得另建冲突功能合同。
- `docs/architecture/architecture.md`：逻辑组件、运行链、Adapter 边界和技术决策。
- `docs/architecture/frontend-architecture.md`：React/Vite、Redux Toolkit、样式、Motion、CodeMirror、1:1 基准和视觉回归的已确认决策。
- `docs/plans/implementation-plan.md`：把已确认需求拆成实施切片，不创造新需求。
- `docs/plans/development-tasks.md`：阶段门槛、T 编号、依赖、交付物、最窄验收和逐阶段陷阱；后续开发以此为执行清单。
- `docs/plans/deepseek-harness-release-playbook.md`：DSH 发布或获得合规内测权限后的证据、接入顺序、架构红线和上线门槛；Pi + DeepSeek 开发期间持续沉淀可复用接入资产，实现官方 Adapter 时必须遵守。
- `docs/verification/`：记录真实命令、退出状态、可观察结果和未验证项。

## DSH 接入资产持续沉淀

- 每个 Pi + DeepSeek 实施切片结束前必须执行一次“DSH 接入复用审查”，判断本次真实联调是否产生了可缩短官方接入时间或降低错误风险的信息；该审查不得省略，但没有有效新结论时不得为了留痕制造空洞文档改动。
- 以下变化或发现只要出现，就必须在同一任务中更新 `docs/plans/deepseek-harness-release-playbook.md` 的对应规则，并在 `docs/verification/` 留下固定 Pi 版本和真实证据：统一 Adapter 合同、能力定义、会话/控制语义、事件顺序与去重、`raw` 降级、鉴权分层、内部 Driver 边界、断线恢复、凭证/工作区/进程安全、合同测试和双运行时回归方法。
- 接入手册只沉淀“可跨 Harness 复用的结论、发布日动作、已发现风险和仍待官方核实的问题”；Pi 包名、命令、字段、事件名、文件格式和行为细节只进入 Pi Adapter、测试或验证记录，不得提升为 DSH 规格。
- 新结论必须标明证据来源、Pi 版本/commit、可复用范围和对 DSH 接入的具体影响；无法由真实运行证明的判断只能记为“待官方核实”，不得进入代码合同、能力默认值或用户可见承诺。
- 如果 Pi 联调暴露统一合同不足，先记录受影响旅程和兼容风险，再做最小、向后兼容的合同调整；不得为迁就 Pi 专属结构提前塑造 `DeepSeekOfficialAdapter`。
- 能直接复用的测试、脱敏夹具生成规则、诊断字段和验证命令应保持供应商无关；涉及 Pi 专属载荷的部分必须留在 `PiHarnessAdapter` 测试边界内。

## 真实验收记录保留

- 自动化联调产生的受控测试工作区、会话、统一事件、工具调用与输出、命令退出状态、文件变化、Git Diff、产物和功能覆盖结果是平台内置验收数据；验收通过后默认保留，不作为临时文件删除。
- 平台必须提供可浏览的“验收记录”入口，让用户能够按一次真实运行查看触发了哪些 FM 功能、调用了哪些工具、产生了哪些事件与文件变化，以及各链路是否通过；不得只把证据留在测试终端或 `docs/verification/`。
- 保留的是脱敏后的产品事实和受控测试仓库；API Key、完整私有 Prompt、用户私有源码、绝对用户路径和未脱敏原始载荷不得进入内置数据。真实模型返回内容只在通过敏感信息检查后保留。
- 每条验收记录必须包含固定 Pi 版本、模型 ID、运行时间、工作区模板版本、Session/Run 标识、触发的 FM/T 编号、最终状态和证据来源；同一场景重新执行应新增可追溯运行记录，不静默覆盖旧证据。
- 内置验收数据属于产品功能与回归资产，可由用户后续明确删除或重置；自动化开发过程不得在阶段收尾、测试 teardown 或仓库清理中默认删除。

## 技术基线与真实命令

- 前端：固定使用 React 19.2 + TypeScript + Vite 8.2 SPA、React Router Data Mode、Redux Toolkit + RTK Query、CSS Modules + CSS token、Radix Primitives、Motion 和 CodeMirror 6；TanStack Virtual 按真实性能阈值启用。
- 高保真基准：主工作台以 `source-materials/ui-exploration/round-05-code-tree-workbench-recalibration/candidates/3-task-first-adaptive-code-dock.png` 在 `1672 × 941` 视口 1:1 复刻；不得套用通用后台模板或组件库默认主题。
- 用户已停止后续子页面抽图；首次进入、异常、断连和恢复直接按 `docs/specs/ui-state-spec.md` 实现，除非用户再次明确要求，不得把新增 UI 候选图设为工程前置门槛。
- 状态开发：Redux 只归约供应商无关 ViewModel；HTTP 快照负责当前事实，SSE 负责实时事件，命令回执只表示接受/拒绝。测试可构造 reducer 输入，但生产构建不得包含状态切换或本地演示数据源。
- 后端：Local Bridge 固定使用 Node.js + TypeScript；优先直接接入 `@earendil-works/pi-coding-agent` SDK。Python 不进入 V0.1 主技术栈。
- Node.js exact version 固定为 `24.16.0`；Bridge 使用 `node:http + SSE + node:sqlite WAL`，Pi 与产品事件分别持久化。
- 数据与模型：Agent Loop 与运行时 Session 由当前 Harness 提供；Bridge 只持久化不透明 `runtimeSessionRef`、统一事件、幂等回执和脱敏验收记录；DeepSeek Key 仅驻留进程内存。
- 全量安装：`npm run install:all`；生产构建与启动：`npm run build && npm start`，默认同源监听 `http://127.0.0.1:4317`。
- 静态/单元检查：`npm run check`、`npm run test:unit`、`npm run build`。
- 真实验收：设置用户授权的 `FF_CREDENTIAL_FILE` 后运行 `npm run verify:real`、`npm run verify:controls`、`npm run verify:restart`、`npm run verify:commands`、`npm run test:e2e`；`npm run verify:import` 验证真实 Git 导入。自动化不得连接或复用正在运行的 `4317` 产品实例；Playwright 固定使用独立端口与独立数据目录，后端验证脚本使用 `backend/data/verification/`。Playwright 覆盖桌面 `1672 × 941` 与 Pixel 7。

## 开发规则

- 只实现已确认并进入当前计划切片的需求；保持 PRD、Spec、架构、计划和实现一致。
- 每个开发任务必须引用 `REQ-*`、`FM-*` 和 `T*-*` 中适用的编号，先满足所属阶段的进入依赖与退出门槛；不得跨过无 UI Spike 直接实现看似可用的前端状态。
- 先映射核心旅程、状态、前后端合同和可见结果，再修改代码。
- Session 与 Run 使用独立状态机；Pi 命令同步成功只记录为 accepted/acknowledged，不能据此显示运行成功、失败或取消。
- 所有流式可变值必须在 Adapter 层声明 `delta / snapshot / final` 语义；前端不得根据 Pi 字段名猜测追加或替换。
- 动效只能响应已确认的领域状态，不得从动画回调推动 Run 终态；断线或 `unknown` 时停止运行脉冲，`prefers-reduced-motion` 下取消位移与循环动效。
- 新建、恢复、切换、分叉或重连导致底层 Session Runtime 替换时，必须重新绑定订阅；`runtimeGeneration` 从该 Session 持久历史的最大值分配 `max + 1`，迟到事件不得污染当前 Session。
- 正常、加载、空、失败、断连、运行和成功状态必须由真实状态轴派生；断线只能标记 `unknown`，收到可证明活动的真实事件后才恢复 `running`。
- 共享事件来源只使用 `bridge / harness / model / workspace`；供应商名称只作为 Adapter 返回的运行时身份，不得成为共享来源枚举。
- 持久化层只把 Harness Session 位置保存为不透明 `runtimeSessionRef`；不得把 `pi_session_file` 或未来官方字段提升为共享数据库合同，既有字段变化必须带兼容迁移。
- Submit、steer、follow-up 和 interrupt 均使用客户端 `requestId`；同进程并发与 Bridge 重启后的重复请求都必须返回原回执，不得重复执行。
- 文件树达到深度、数量或访问限制时必须设置 `fileScanLimited` 并在页面说明，不能把截断结果展示为完整扫描。
- 用户无需懂 Git 即可使用内置示例或普通本地目录；每个 Run 必须在提交给 Harness 前建立可恢复的任务基线。历史基线缺失时明确降级，不得以空基线把整份既有文件伪装为新增。
- 工具与文件变化只能标记为同一 Run 的“观察关联”，不得把时间相关性冒充确定因果。
- 桌面工作台必须保持单视口外壳：页头、三栏工作区、composer 与产品脚注共同收纳在 `100dvh` 内；会话/文件、中央时间线和右侧检查器分别内部滚动，Harness 事件增长不得制造浏览器整页滚动。
- 协议归约回归优先使用真实 Pi 联调捕获并脱敏的夹具；单元测试手写事件只能验证算法，不得称为真实运行证据。
- 开始实现前固定 Pi 的仓库、包名和版本/commit，源码参考与实际安装包必须属于同一发行线。
- 当前实现基线为已真实验证的 `@earendil-works/pi-coding-agent@0.84.1`、tag `v0.84.1`、commit `53fa77ccd8a279eb87e92294ef3687b03ff80112` 与 Node.js `24.16.0`；所有 `@earendil-works/pi-*` 依赖保持同发行线精确版本。
- V0.1 不使用 `@earendil-works/pi-agent-core` 中仍抛出 `HarnessNotImplemented` 的新版 `AgentHarness`，也不把标记为 experimental 且无兼容承诺的 Pi Client/Protocol 作为核心 Bridge 协议；改变该决策需要新的固定版本证据与架构记录。
- V0.1 选择直接 Pi SDK Driver；产品级停止在 `PiHarnessAdapter` 临界区执行 `clearQueue() → abort() → agent_settled`，不能只调用 abort 或只判断 assistant stop reason。
- DeepSeek Key 使用进程内 CredentialStore 注入，不写入 Pi Bash/工具子进程会继承的环境变量。
- 新建 Session 的“空”按消息历史判断；fork 只有在 Pi Session 已因 assistant 消息真实落盘后开放。任何会话替换都重绑订阅，并使用耐久 generation 分配器提升代次。
- Session 引用非空不代表运行记录已经真实落盘；列表中的 `recoverable` 必须由耐久事实确认。普通会话删除只经统一 Adapter 合同执行，运行中拒绝，并保留独立验收记录；Pi 文件清理不得泄漏到共享 UI。
- 面向未知工作区创建 Pi Session 时不得使用默认 trusted 资源加载路径；显式以 `projectTrusted=false` 启动，完成本产品的资源信任决策后再加载受保护的项目设置、包和 Extensions。
- Pi 默认没有内置权限确认和沙箱；开发与测试必须限制工作区和进程权限，不得用虚假审批 UI 掩盖该边界。
- 每项验收只使用一个最窄且充分的验证方法；通过后记录证据并停止。
- 不读取、回显、提交或复制真实凭证；计费调用、外部写入和部署必须获得明确授权。
- 保留用户已有改动，不使用破坏性工作区回滚。

## Definition of Done

- 行为可追踪到已确认需求 ID 与验收标准。
- 实现可追踪到对应 FM 与 T 编号，所属阶段依赖已满足，阶段陷阱清单已定向检查。
- 当前 Pi 接入只修改 `PiHarnessAdapter`、能力映射及其测试；核心 UI 和领域状态不引用 Pi 专属字段。
- 每个 Pi + DeepSeek 切片已完成 DSH 接入复用审查；产生有效结论时，接入手册与带版本的验证证据已在同一任务中更新，且没有把 Pi 专属事实写成 DSH 承诺。
- 真实验收记录已脱敏并保留在平台内，用户可以从页面核对本次运行触发的功能、事件、工具、命令、文件变化与 Diff；测试 teardown 未删除这些记录。
- 官方 Harness 发布后只新增 `DeepSeekOfficialAdapter`、能力映射及其测试；核心 UI 不按官方字段重写。
- `DeepSeekOfficialAdapter` 上线不得导致既有 Pi 核心旅程消失或退化；两条链路分别按各自真实能力展示功能。
- DeepSeek 模型配置只负责让当前 Harness 使用目标模型，不得扩展为自研 Harness 或第二套 Agent Loop。
- 不支持的能力会隐藏或明确降级，未知事件仍可在原始事件视图中观察。
- 直接受影响的页面、协议、数据和后台状态一致。
- 最窄相关检查通过，核心旅程得到可观察结果。
- README、AGENTS、PRD、Spec、架构、计划和验证证据已同步。
- 未执行项、外部依赖和剩余风险已如实记录。

## 最终教学交付

目录初始化和功能开发不等于最终交付。全部开发完成且用户明确要求后，使用 `$prepare-teaching-project-delivery` 生成学员包、项目介绍、截图和视频。
