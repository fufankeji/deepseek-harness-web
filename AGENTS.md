# AGENTS.md

> `FF - DeepSeek Harness Web`：为 DeepSeek Harness 提供可快速适配的 Web 操作环境。

## 项目定位

- 项目根目录名：`DeepSeekHarnessWeb`
- 对外产品名：`FF - DeepSeek Harness Web`
- 内部工程标识：`deepseek-harness-web`
- 目标用户：希望通过浏览器操作 DeepSeek Harness 的开发者与技术用户。
- P0 核心旅程：连接 Harness → 选择工作区 → 创建或继续会话 → 提交任务 → 查看执行过程并处理审批 → 检查文件 Diff、终端与产物 → 停止、继续或结束会话。
- V0.1 范围：连接与能力探测、工作区、会话、任务输入、统一执行时间线、审批与运行控制、文件变化与 Git Diff、Terminal、产物、原始事件与诊断。
- 明确不做：自行实现 DeepSeek Harness；在官方接口未知时仿造其内部 Agent 循环；提前开发多 Agent、记忆、Skills 或 MCP 的完整管理器；引入团队、计费、云沙箱和在线 IDE。

## 品牌与产品语言

- 用户可见名称逐字使用 `FF - DeepSeek Harness Web`；内部工程名、缩写和临时代号不得进入界面。
- Logo 尚未确定；在品牌资产确认前不得制作或临时替代正式 Logo。
- 凡出现版权、脚标或研发署名，逐字使用 `@2026 赋范空间 独家自研`。
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
- `frontend/` 只消费统一 Harness 协议，不得直接解析官方 DeepSeek Harness 输出。
- `backend/` 负责进程、文件系统、Git、PTY、会话持久化与全部 Harness Adapter。
- 官方专属命令、字段、事件和兼容逻辑只能存在于 `backend/` 的官方 Adapter 内。
- 所有事件必须保留可选原始载荷；未知事件降级为 `raw`，不得造成核心页面崩溃。
- 功能是否出现由运行时能力探测决定，不得根据产品名或版本号硬编码猜测。
- Git Diff 与文件变化观察由本产品提供，不依赖 Harness 是否输出对应事件。
- 不为目录整齐凭空添加 workspace、Compose、CI、数据库或部署设施。

## 文档职责

- `docs/PRD.md`：用户价值、范围、需求 ID 和 Given/When/Then 验收。
- `docs/specs/product-spec.md`：页面、状态、交互、能力和统一事件合同。
- `docs/architecture/architecture.md`：逻辑组件、运行链、Adapter 边界和技术决策。
- `docs/plans/implementation-plan.md`：把已确认需求拆成实施切片，不创造新需求。
- `docs/verification/`：记录真实命令、退出状态、可观察结果和未验证项。

## 技术基线与真实命令

- 前端：尚未选型。
- 后端：尚未选型，但产品架构已确定需要本地 Bridge。
- 数据与模型：会话持久化方式尚未选型；模型与 Agent 循环由外部 Harness 提供。
- 安装：尚未定义。
- 启动：尚未定义。
- 测试与构建：尚未定义。

## 开发规则

- 只实现已确认并进入当前计划切片的需求；保持 PRD、Spec、架构、计划和实现一致。
- 先映射核心旅程、状态、前后端合同和可见结果，再修改代码。
- 正常、加载、空、失败、断连、等待审批和成功状态服从产品合同，不用假成功或隐藏 Mock 冒充真实结果。
- Mock 数据只能由明确命名的 `MockAdapter` 提供，并在界面可识别为模拟运行时。
- 每项验收只使用一个最窄且充分的验证方法；通过后记录证据并停止。
- 不读取、回显、提交或复制真实凭证；计费调用、外部写入和部署必须获得明确授权。
- 保留用户已有改动，不使用破坏性工作区回滚。

## Definition of Done

- 行为可追踪到已确认需求 ID 与验收标准。
- 官方 Harness 接入只修改或新增 Adapter、能力映射及其测试；核心 UI 和领域状态无需按官方字段重写。
- 不支持的能力会隐藏或明确降级，未知事件仍可在原始事件视图中观察。
- 直接受影响的页面、协议、数据和后台状态一致。
- 最窄相关检查通过，核心旅程得到可观察结果。
- README、AGENTS、PRD、Spec、架构、计划和验证证据已同步。
- 未执行项、外部依赖和剩余风险已如实记录。

## 最终教学交付

目录初始化和功能开发不等于最终交付。全部开发完成且用户明确要求后，使用 `$prepare-teaching-project-delivery` 生成学员包、项目介绍、截图和视频。
