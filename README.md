# FF - DeepSeek Harness Web

面向 DeepSeek Harness 的可适配 Web 操作环境。

> [!IMPORTANT]
> 本项目由赋范空间独立开发，不是 DeepSeek 官方项目。DeepSeek Harness 尚未公开完整功能与集成协议；当前仓库处于产品规划和兼容层设计阶段，暂时没有可运行版本。

## 项目目标

DeepSeek Harness 发布后，用户应当能够通过统一的 Web 界面完成以下旅程：

```text
连接 Harness
→ 选择工作区
→ 创建或继续会话
→ 提交任务
→ 查看执行过程并处理审批
→ 检查文件 Diff、终端输出与产物
→ 停止、继续或结束会话
```

本项目不会提前复制或猜测官方 Harness 的内部实现。Web UI 只依赖统一能力和事件协议，官方 API、SDK 或 CLI 由独立 Adapter 接入。

## V0.1 规划能力

- Harness 启动、连接、版本和能力探测
- 本地工作区、文件树与 Git 仓库
- 会话、任务输入与流式消息
- 计划、工具调用、命令、错误与状态时间线
- 审批、停止、断连和恢复
- Web Terminal 与交互式 CLI/TUI 透传
- 文件变化、Git Diff 与产物查看
- 原始事件、Adapter 日志与兼容性诊断
- 对记忆、上下文压缩、子 Agent、用量、缓存、浏览器、MCP 和 Skills 的能力预留

详细范围与验收标准见 [PRD](docs/PRD.md)。

## 兼容架构

```text
Web UI
  ↕ 统一状态与事件协议
Local Harness Bridge
  ├─ 工作区与 Git
  ├─ 会话与事件存储
  ├─ PTY 与进程管理
  └─ Harness Adapter
       ├─ Mock Adapter
       ├─ Generic PTY Adapter
       ├─ Generic JSONL Adapter
       └─ DeepSeek Official Adapter
```

官方发布后的接入优先级：

1. HTTP、SSE 或 WebSocket API
2. 官方 SDK
3. JSONL/NDJSON CLI
4. 交互式 CLI/TUI，通过 PTY 作为最低兼容路径

这套边界的目标是：接入官方 Harness 时只新增或调整 Adapter，不重写核心 UI。

## 当前状态

- [x] 产品范围与核心旅程
- [x] 能力、事件和 Adapter 合同
- [x] 发布日兼容策略
- [ ] 前端、Bridge、通信和持久化技术选型
- [ ] Mock Adapter 与核心 UI
- [ ] PTY、工作区与 Git Diff
- [ ] DeepSeek 官方 Adapter（等待官方发布物）

当前没有 manifest、依赖或启动命令。技术方案确认后才会创建真实前后端框架，并从真实脚本更新本节。

## 文档

- [产品需求文档](docs/PRD.md)
- [产品规格](docs/specs/product-spec.md)
- [技术架构](docs/architecture/architecture.md)
- [实施计划](docs/plans/implementation-plan.md)
- [验证记录](docs/verification/)

## 仓库结构

```text
DeepSeekHarnessWeb/
├── frontend/   # Web UI、前端状态、组件与测试
├── backend/    # Local Bridge、工作区服务与 Harness Adapter
├── docs/       # PRD、规格、架构、计划与验证证据
├── AGENTS.md   # 项目开发约束
└── CLAUDE.md   # AGENTS.md 兼容入口
```

## 参与项目

提交 Issue 或 Pull Request 前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。兼容性问题请提供 Harness 版本、发布入口、运行平台和脱敏后的原始输出，不要提交 API Key、访问令牌或私有代码。

安全问题请按 [SECURITY.md](SECURITY.md) 私下报告。

## 许可证

许可证尚未确定。仓库公开不代表已经授予复制、修改、分发或商业使用许可；在 `LICENSE` 文件加入前，请不要假定本项目采用任何开源许可证。

## 名称说明

DeepSeek 是其权利人的名称或商标。本仓库名称用于说明计划兼容的目标产品，不表示 DeepSeek 对本项目的认可、赞助或隶属关系。

---

出品：赋范空间（FuFan Space）· `@2026 赋范空间 独家自研`
