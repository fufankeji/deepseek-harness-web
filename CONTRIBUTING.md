# 参与贡献

感谢关注 `FF - DeepSeek Harness Web`。项目目前处于产品规划和技术选型阶段，请先阅读 [PRD](docs/PRD.md)、[产品规格](docs/specs/product-spec.md)、[技术架构](docs/architecture/architecture.md) 与 [实施计划](docs/plans/implementation-plan.md)。

## 提交 Issue

- Bug 使用 Bug Report 表单。
- 官方 Harness 的新版本、接口或兼容性信息使用 Harness Compatibility 表单。
- 新需求使用 Feature Request 表单，并说明它对应哪段用户旅程。
- 日志、事件和配置必须脱敏，不得包含 API Key、访问令牌、私有仓库内容或个人信息。

## 提交 Pull Request

1. 先确认改动可以追踪到现有需求或已讨论的 Issue。
2. 保持 `frontend/`、`backend/` 和 `docs/` 的边界。
3. 官方 Harness 专属字段只能进入 `backend/` 的官方 Adapter。
4. 未知事件必须保留原始载荷并降级为 `raw`，不能使核心页面失败。
5. 使用最窄相关检查验证改动，并在 PR 中写明真实结果。
6. 行为、协议或范围变化时同步更新 PRD、Spec、架构或实施计划。

## 当前限制

技术栈尚未确定，因此当前没有安装、启动、测试或构建命令。不要为了提交代码提前引入框架、CI、数据库或部署设施；先通过 Issue 对齐对应技术切片。

## Commit 与 PR

- Commit 使用简短、可验证的动作描述。
- 一个 PR 只解决一个明确问题，避免顺带重构无关内容。
- PR 描述必须包含变更原因、可观察结果、验证方法与剩余限制。

提交贡献即表示你有权提交相应内容。许可证确定前，外部代码贡献将暂缓合并，以避免权利边界不清。
