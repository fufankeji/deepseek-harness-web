---
document: implementation-plan
status: active
updated: "2026-08-12"
---

# FF - DeepSeek Harness Web 实施计划

## 1. 实施原则

- 先冻结统一产品合同，再选择技术栈。
- 先用 Mock 验证 UI 和状态，再连接任何真实 Harness。
- 先完成 PTY 最低兼容路径，再增强结构化事件。
- 官方发布后以真实接口为准，只在 Adapter 内适配。
- 每个切片通过最窄验收后停止，不提前扩展高级能力。

## 2. 实施切片

| 顺序 | 需求 ID | 范围 | 可观察验收 | 状态 |
|---:|---|---|---|---|
| 0 | 全部 | 建立标准骨架，落盘 PRD、Spec、架构、计划与项目规则 | 文件齐全、产品名/范围一致、无模板占位符 | 已完成 |
| 1 | 全部 | 确认前端、Bridge、通信、持久化和分发技术方案 | 架构文档中的技术表有明确选择、理由与边界 | 待讨论 |
| 2 | REQ-001、003、005、007、009、010、011 | 创建真实前后端框架、统一协议、领域状态和 `MockAdapter` | 模拟运行时可完整演示连接、执行、审批、失败、产物、完成和恢复 | 待开始 |
| 3 | REQ-006 | 实现 Bridge 进程生命周期、PTY 与 Web Terminal | 任意测试 CLI 可在 Web 中双向操作，并展示退出/断连状态 | 待开始 |
| 4 | REQ-002、008 | 实现工作区选择、文件树、文件监听与 Git Diff | 外部测试进程修改文件后，页面可独立显示变化与 Diff | 待开始 |
| 5 | REQ-001、003、004、005、010 | 实现 `GenericJsonlAdapter`、事件排序、去重、持久化与重连 | JSONL fixture 可稳定映射，未知事件进入 `raw` | 待开始 |
| 6 | 全部 P0 | 完成统一界面联调与基线验收 | 不依赖官方 Harness 即可验证所有 P0 状态和降级路径 | 待开始 |
| 7 | 以官方能力为准 | DeepSeek 官方发布后实现 `DeepSeekOfficialAdapter` | 真实运行时跑通 P0 核心旅程，核心 UI 无专属改造 | 等待官方发布 |
| 8 | REQ-011 | 按真实能力逐项增强高级功能 | 每项能力有官方证据、独立验收和明确降级 | 后续 |

## 3. 技术方案讨论顺序

下一轮按以下顺序决策，避免局部选型反过来限制产品：

1. 产品分发形态：浏览器 + 本地 Bridge，还是桌面壳承载 Web UI。
2. Bridge 技术：Node.js、Rust、Go 或其他方案。
3. 前端技术：框架、状态管理、Terminal、Diff 和组件体系。
4. 通信协议：WebSocket、HTTP + SSE 或组合。
5. 会话事件存储：文件日志、SQLite 或其他本地方案。
6. 打包与跨平台：macOS、Windows、Linux 的首发优先级。

## 4. 发布日前准备清单

- `MockAdapter` 覆盖所有统一事件与能力组合。
- `GenericPtyAdapter` 可配置命令、参数、工作目录和环境变量。
- `GenericJsonlAdapter` 的映射规则不依赖固定供应商字段。
- UI 对 `false`/`unknown` 能力均能正确降级。
- 未知事件、解析错误、断连、进程异常退出均有可观察结果。
- 文件变化与 Git Diff 不依赖 Harness 输出。
- Adapter fixtures 和映射测试有固定放置位置。
- 官方 Adapter 有独立目录，不影响 Mock 与通用 Adapter。

## 5. 发布日最小接入顺序

```text
probe/version
→ create or attach session
→ send input
→ receive raw output/events
→ cancel/stop
→ workspace + file changes + Diff
→ structured timeline mapping
→ approvals/resume/artifacts
→ optional advanced capabilities
```

先保证真实闭环，再增加展示精度；不得为了看起来功能完整而伪造官方没有提供的数据。

## 6. 验证方法

| 验收项 | 最窄方法 | 预期结果 |
|---|---|---|
| 切片 0：项目与文档基线 | 检查标准文件、关键产品术语和模板占位符 | 标准文件存在，产品名和核心架构一致，无未处理模板槽位 |
| 切片 1：技术决策 | 对照待定决策表审阅架构文档 | 每项有明确结论、理由和被排除方案 |
| 切片 2：Mock 核心状态 | 一条覆盖核心状态的 Adapter 集成测试 | 完整事件序列到达正确页面状态 |
| 切片 3：PTY | 一个真实交互式测试 CLI 的端到端测试 | 输入、输出、resize、退出和取消均通过 |
| 切片 4：工作区与 Diff | 一个临时 Git 仓库的集成测试 | 新建、修改、删除和 Diff 与仓库真实状态一致 |
| 切片 5：JSONL | fixture 驱动的 Adapter 映射测试 | 排序、去重、未知事件和错误恢复符合合同 |
| 切片 7：官方 Adapter | 官方运行时 P0 冒烟旅程 | 真实任务完成且核心 UI 无官方专属字段 |

## 7. 进度与偏差

- 2026-08-12：完成产品规划基线；尚未进行技术选型和功能开发。
- 2026-08-12：补齐公开 GitHub 仓库的 README、贡献说明、安全策略、Issue Forms、PR 模板、CODEOWNERS 与基础 Git/编辑器规则；许可证仍待产品所有者选择。
- 官方 Harness 功能与接口仍是外部未知项；任何新增能力均需以发布物或官方文档为依据。
- 下一步是讨论并确认技术方案，不自动创建框架或实现产品。
