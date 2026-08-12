---
document: architecture
status: proposed
updated: "2026-08-12"
---

# FF - DeepSeek Harness Web 技术架构

## 1. 当前结论

技术栈尚未选定，但逻辑架构已经确定：**Web UI 不直接依赖官方 Harness；本地 Bridge 统一处理运行时、工作区与 Adapter。**

浏览器不能稳定、跨平台地直接启动本地 Harness 进程、接管 PTY、完整访问工作区和执行 Git 操作，因此本产品不能只有静态前端。V0.1 至少需要一个随用户本地运行的 Bridge。

## 2. 架构原则

1. **能力驱动**：运行时明确报告支持能力，UI 不按名称猜测。
2. **协议隔离**：官方专属字段只存在于 `DeepSeekOfficialAdapter`。
3. **原始数据保留**：每次转换保留原始事件，未知事件可观察。
4. **渐进增强**：PTY 是最低兼容路径，结构化事件和高级能力逐步增强体验。
5. **独立事实源**：文件变化与 Git Diff 由工作区服务读取，不依赖模型自报。
6. **真实状态**：失联、进程退出、不支持和部分恢复必须明确表达。

## 3. 逻辑组件

```text
┌──────────────────────── Web UI ────────────────────────┐
│ 工作区/会话 │ 任务与时间线 │ Diff/产物 │ Web Terminal │
│                  统一状态与事件模型                    │
└──────────────────────────┬──────────────────────────────┘
                           │ 本地双向通信
┌──────────────────── Local Harness Bridge ──────────────┐
│ Runtime API │ Session Store │ Workspace/Git │ PTY Host │
│                    Adapter Registry                     │
│  Mock │ Generic PTY │ Generic JSONL │ DeepSeek Official│
└──────────────────────────┬──────────────────────────────┘
                           │ 官方真实接口
                 DeepSeek Harness Runtime
```

### Web UI

- 渲染统一领域状态和 `HarnessEvent`。
- 收集用户输入、审批决策和运行控制。
- 不访问本地进程，不解析 DeepSeek 专属协议。

### Local Harness Bridge

- 启动、监控和停止 Harness 进程或连接官方本地服务。
- 托管 PTY 和双向字节流。
- 访问工作区、监听文件变化并读取 Git Diff。
- 持久化会话元信息、统一事件和诊断数据。
- 通过 Adapter Registry 选择具体运行时实现。

### Harness Adapter

- 探测版本、接口和能力。
- 把统一用户动作转换为官方调用。
- 把官方事件、stdout 或 SDK 回调转换为统一事件。
- 保留官方原始载荷，隔离协议变化。

## 4. 目录边界

- `frontend/`：Web 页面、组件、前端领域状态、Bridge 客户端、前端测试和构建配置。
- `backend/`：Bridge 服务、Adapter、进程与 PTY、工作区与 Git、会话持久化、后端测试和配置。
- 根目录：项目级说明与未来真实需要的跨服务命令；当前无跨服务运行文件。

建议在技术落地时保持以下内部边界，具体目录名可随框架惯例调整：

```text
backend/
├── adapters/
│   ├── mock/
│   ├── generic-pty/
│   ├── generic-jsonl/
│   └── deepseek-official/
├── runtime/
├── sessions/
├── workspace/
└── transport/
```

## 5. 请求、事件与运行链

### 结构化运行链

```text
用户提交任务
→ Web UI 发送统一 UserInput
→ Bridge 定位当前 Session 与 Adapter
→ Adapter 转换为官方 API/SDK/CLI 输入
→ 官方运行时返回事件
→ Adapter 转换为 HarnessEvent 并保留 raw
→ Bridge 持久化、排序并推送事件
→ Web UI 更新会话状态和执行时间线
```

### PTY 兜底运行链

```text
用户连接官方 CLI/TUI
→ GenericPtyAdapter 在工作区启动 PTY
→ Terminal 双向转发原始字节流
→ Bridge 独立监听进程和工作区
→ 页面展示 Terminal、进程状态、文件变化和 Git Diff
→ 后续识别稳定输出后再逐步增加结构化映射
```

### 恢复链

```text
页面刷新或 Bridge 重启
→ 读取本地会话和事件日志
→ Adapter 查询运行时是否支持恢复
→ 可恢复：重连并从游标继续事件流
→ 不可恢复：保留历史，标记真实终止/失联状态
```

## 6. 官方发布形态与接入策略

| 官方形态 | 首选 Adapter 实现 | 最低可用结果 |
|---|---|---|
| HTTP/SSE/WebSocket API | 网络 Adapter | 结构化会话、事件和控制 |
| 官方 SDK | Bridge 内 SDK Wrapper | 将回调/对象映射为统一协议 |
| CLI + JSONL/NDJSON | `GenericJsonlAdapter` 派生 | 结构化事件时间线与控制 |
| 交互式 CLI/TUI | `GenericPtyAdapter` 派生 | Web Terminal + 文件变化 + Git Diff |
| 仅封闭桌面应用且无外部接口 | 无法立即深度接入 | 记录阻塞，不通过 UI 自动化伪造正式集成 |

## 7. 发布日适配流程

1. 获取官方发布物并记录版本、平台、安装方式和可调用入口。
2. 运行只读探测：帮助、版本、配置说明、API/SDK 示例与事件格式。
3. 判断最优接入路径，并先跑通“启动/连接、发送、接收、停止”最小闭环。
4. 捕获真实输入输出样本，固化为 Adapter fixtures；不得手写猜测样本冒充官方协议。
5. 实现 `probe()` 和 P0 事件映射，所有未知内容先进入 `raw`。
6. 用真实运行时验证工作区、会话、任务、停止、Terminal、文件变化和 Diff。
7. 再按真实能力逐项开启审批、计划、产物、恢复、用量及高级能力。

发布日完成的最低标准：新增或修改官方 Adapter 和映射测试即可跑通 P0 核心旅程，核心 UI 不因官方字段变化而重构。

## 8. 外部服务与安全边界

- Bridge 只访问用户明确选择的工作区。
- API Key、访问令牌和进程环境的存储方案尚未确定；实现时不得进入前端持久化、日志或版本库。
- 终端与文件写入的权限以官方 Harness 能力和用户审批为准；Web 不伪造已获得授权。
- 本轮不调用 DeepSeek API、不启动计费服务、不部署外部环境。

## 9. 待定技术选择

| 决策 | 需要解决的问题 | 当前状态 |
|---|---|---|
| 前端框架与组件体系 | 时间线、Diff、Terminal、大量实时状态的开发效率 | 待讨论 |
| Bridge 语言与运行方式 | PTY、进程管理、文件监听、Git、跨平台和安装体积 | 待讨论 |
| Web 与 Bridge 通信 | 双向 Terminal、事件流、审批与重连 | 待讨论 |
| 会话持久化 | 事件顺序、去重、恢复、日志体积与迁移 | 待讨论 |
| 产品分发形态 | 浏览器 + 本地守护进程、桌面壳或两者兼容 | 待讨论 |
| 工作区隔离 | 路径授权、并发会话与进程生命周期 | 待讨论 |
| Git/Diff 实现 | 非 Git 工作区、超大文件和二进制文件策略 | 待讨论 |

技术方案讨论应先解决 Bridge 与分发形态，因为它们会约束其他选型。
