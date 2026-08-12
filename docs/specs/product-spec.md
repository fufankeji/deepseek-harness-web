---
document: product-spec
status: draft
updated: "2026-08-12"
---

# FF - DeepSeek Harness Web 产品规格

## 1. 范围说明

### V0.1 计划实现

- Harness 连接、启动和能力探测。
- 本地工作区、文件树与 Git 导入入口。
- 会话和任务输入。
- 统一执行时间线与原始事件降级。
- 审批、停止和连接控制。
- Web Terminal。
- 文件变化、Git Diff 与产物查看。
- 会话时间线持久化与诊断。
- `MockAdapter`、通用 PTY Adapter、通用 JSONL Adapter，以及发布后的 DeepSeek 官方 Adapter。

### 本轮实际落盘

- 标准项目结构。
- PRD、产品规格、逻辑架构、实施计划与验证记录。
- 不创建前后端框架，不实现可运行产品。

### 明确不做

- 自研 Harness 或 Agent 循环。
- 在官方能力未知时开发高级能力的完整管理界面。
- 团队、计费、云沙箱和完整在线 IDE。

## 2. 信息架构

```text
顶部状态栏：产品名 | Harness/Adapter | 版本 | 连接状态 | 运行控制
左侧区域：工作区 | 文件树 | 会话列表
中间区域：任务输入 | 对话与执行时间线
右侧区域：文件内容 | Git Diff | 产物 | 运行详情
底部区域：Web Terminal（可展开或收起）
辅助入口：能力详情 | 原始事件 | Adapter 日志
```

区域可以响应屏幕宽度折叠，但信息职责不得混合：时间线解释“发生了什么”，Terminal 保留“原始交互”，Diff 展示“工作区发生了什么变化”。

## 3. 核心旅程与状态

| 需求 ID | 入口 | 输入/触发 | 加载/过程 | 成功结果 | 空/失败与恢复 |
|---|---|---|---|---|---|
| REQ-001 | 顶部 Harness 状态 | 选择并连接 Adapter | `probing` 展示检测进度 | `ready` 展示版本与能力 | `incompatible`/`error` 显示原因并允许重试或切换 Adapter |
| REQ-002 | 工作区区域 | 选择目录或导入 Git URL | 校验路径或导入进度 | 文件树与工作区信息可见 | 无工作区时禁用任务执行；失败后保留重试入口 |
| REQ-003 | 会话列表 | 新建、打开、继续、停止、结束 | 状态实时更新 | 当前会话与运行时一致 | 失联会话标记为 `disconnected`，不伪装为仍在运行 |
| REQ-004 | 中间输入区 | 文本与文件引用 | 发送中禁用重复提交 | 流式消息和完成消息可见 | 发送失败保留原输入并允许重试 |
| REQ-005 | 执行时间线 | Adapter 事件 | 按 `sequence` 增量追加 | 已知事件结构化展示 | 未知/解析失败事件进入 `raw`，不阻断后续事件 |
| REQ-006 | 底部 Terminal | 键盘输入、窗口尺寸变化 | PTY 双向转发 | 原始 CLI/TUI 可操作 | 退出码、信号、断连和重启入口明确可见 |
| REQ-007 | 时间线审批卡/顶部停止 | 允许、拒绝、取消 | 防止重复决策 | 对应请求解除等待 | 决策失败保留请求并显示重试；取消超时显示真实状态 |
| REQ-008 | 文件树或 Diff 标签 | 文件系统/Git 变化 | 增量刷新 | 文件状态与 Diff 可见 | 非 Git 工作区仍显示文件变化，Diff 能力说明受限 |
| REQ-009 | 产物标签或时间线卡片 | 点击产物 | 加载预览器 | 受支持类型可预览 | 不支持或丢失时显示元信息与错误原因 |
| REQ-010 | 页面重载/Bridge 重连 | 恢复会话 | 回放持久化事件 | 时间线与最终状态恢复 | 运行时无法恢复时标记终止或失联，仍保留历史证据 |

### 连接状态

```text
disconnected → probing → ready
                     ↘ incompatible
                     ↘ error
ready → reconnecting → ready | disconnected | error
```

### 会话状态

```text
idle → starting → running ↔ waiting_approval
                    ├→ completed
                    ├→ failed
                    ├→ cancelled
                    └→ disconnected
```

## 4. 能力驱动界面

Adapter 必须返回能力集合；页面按能力启用功能，不根据 Harness 名称猜测。

| 能力键 | 含义 | V0.1 页面行为 |
|---|---|---|
| `structuredEvents` | 提供结构化事件 | 开启结构化时间线；否则主要展示 Terminal 和 `raw` |
| `resumableSessions` | 运行时可恢复会话 | 显示“继续执行”；否则只恢复本地历史记录 |
| `approvals` | 支持审批请求 | 显示审批卡和待审批状态 |
| `plans` | 提供计划或步骤 | 在时间线中展示计划卡，不预设计划格式 |
| `toolCalls` | 提供工具调用事件 | 展示通用动作卡及输入/结果摘要 |
| `attachments` | 接收附件或文件引用 | 启用任务附件入口 |
| `artifacts` | 提供结构化产物 | 启用产物区域 |
| `usage` | 提供 Token/成本信息 | 显示运行用量；无数据时不估算 |
| `cacheMetrics` | 提供缓存指标 | 显示官方返回的缓存数据；无数据时不推断 |
| `terminal` | 支持终端透传 | 启用 Web Terminal |
| `checkpoints` | 支持 Harness 检查点 | 显示恢复检查点入口；与 Git 回滚分开 |
| `memory` | 提供记忆管理 | 预留能力，不在 V0.1 猜测数据结构 |
| `contextCompression` | 提供上下文压缩事件/控制 | 有事件时展示状态，不自行模拟压缩 |
| `subagents` | 提供子 Agent 数据 | 预留通用父子关系，不在 V0.1 开发完整 Agent 树 |
| `skills` | 提供 Skills 管理 | 预留能力，不提前设计官方 Skill 格式 |
| `mcp` | 提供 MCP 管理 | 预留能力，不提前设计官方 MCP 配置格式 |
| `browser` | 提供浏览器动作或产物 | 先作为通用动作/产物展示，后续按官方协议增强 |

能力值至少支持 `true`、`false` 和 `unknown`；`unknown` 不等于支持。

## 5. 统一 Harness 合同

以下为技术无关的产品合同，具体语言类型在技术选型后实现。

```ts
interface HarnessAdapter {
  probe(): Promise<RuntimeInfo>
  createSession(input: CreateSessionInput): Promise<Session>
  resumeSession(sessionId: string): Promise<Session>
  send(sessionId: string, input: UserInput): Promise<void>
  events(sessionId: string): AsyncIterable<HarnessEvent>
  approve(requestId: string, decision: "allow" | "deny"): Promise<void>
  cancel(sessionId: string): Promise<void>
  dispose(sessionId: string): Promise<void>
}
```

所有 Adapter 不必原生支持全部方法。`probe()` 必须明确返回能力，调用不支持的方法必须产生可识别的“不支持”结果，而不是静默成功。

### 统一事件

```ts
type HarnessEventKind =
  | "session.status"
  | "message.delta"
  | "message.completed"
  | "plan.updated"
  | "action.started"
  | "action.output"
  | "action.completed"
  | "action.failed"
  | "approval.requested"
  | "artifact.created"
  | "usage.updated"
  | "error"
  | "raw"

interface HarnessEvent {
  id: string
  sessionId: string
  sequence: number
  kind: HarnessEventKind
  timestamp: number
  payload: unknown
  raw?: unknown
}
```

### 事件约束

- `id` 在同一会话内唯一，用于去重。
- `sequence` 决定展示顺序，不以客户端接收时间重新排序。
- Adapter 转换事件时保留 `raw`，便于官方协议变化后的诊断。
- 无法映射的事件转换为 `raw`；单个解析错误不得终止整个事件流。
- 重连后重复事件按 `id` 去重；缺失序号必须显示诊断信息，不自动伪造完整历史。

## 6. Adapter 类型

| Adapter | 发布前作用 | 输入 | 输出 |
|---|---|---|---|
| `MockAdapter` | 完成 UI、状态和协议开发 | 固定场景脚本 | 全类型统一事件 |
| `GenericPtyAdapter` | 最低兼容与发布日兜底 | 命令、参数、工作目录、环境配置 | Terminal 字节流、进程状态、文件变化 |
| `GenericJsonlAdapter` | 快速连接结构化 CLI | 一行一个 JSON 的 stdout | 通过可配置映射转为统一事件 |
| `DeepSeekOfficialAdapter` | 官方发布后的正式连接 | 以真实 API/SDK/CLI 为准 | 统一事件与能力集合 |

## 7. 文件、Diff 与回滚边界

- 文件树、文件变化与 Git Diff 属于本产品能力，由 Bridge 直接观察工作区。
- Harness 是否报告文件操作不影响 Diff 的正确来源。
- Git 文件恢复与 Harness 检查点是两种不同操作，界面不得混称“回滚”。
- V0.1 只要求展示 Diff；具体恢复粒度和确认流程在技术方案中确定。

## 8. 产品语言

- 对外产品名：`FF - DeepSeek Harness Web`。
- 固定术语：Harness、Adapter、工作区、会话、任务、执行时间线、审批、文件变化、Diff、终端、产物、能力。
- `MockAdapter` 必须标明“模拟运行时”。
- 不使用“官方版、官方 Web、DeepSeek 官方前端”等会造成归属误解的产品表述。
