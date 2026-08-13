# 参与贡献

感谢关注 `FF - DeepSeek Harness Web`。V0.1 已实现 Pi Harness + DeepSeek 的真实本地运行链。产品规划文档保留在维护者本地且不会发布到 GitHub；公开贡献请以 README、Issue 与实际代码合同为准。

## 提交 Issue

- Bug 使用 Bug Report 表单。
- 官方 Harness 的新版本、接口或兼容性信息使用 Harness Compatibility 表单。
- 新需求使用 Feature Request 表单，并说明它对应哪段用户旅程。
- 日志、事件和配置必须脱敏，不得包含 API Key、访问令牌、私有仓库内容或个人信息。

## 提交 Pull Request

1. 先确认改动可以追踪到现有需求或已讨论的 Issue。
2. 保持 `frontend/` 与 `backend/` 的边界；`docs/` 是维护者本地规划资料，不进入提交。
3. 官方 Harness 专属字段只能进入 `backend/` 的官方 Adapter。
4. 未知事件只保留字段白名单内的脱敏 `raw` 元数据并安全降级，不能转储完整上游对象或使核心页面失败。
5. 使用最窄相关检查验证改动，并在 PR 中写明真实结果。
6. 行为、协议或范围变化时在 PR 中说明迁移影响；维护者负责同步本地产品文档。

## 本地验证

要求 Node.js `24.16.0`：

```bash
npm run install:all
npm run check
npm run test:unit
npm run build
```

真实模型验收会产生调用费用，且需要维护者授权的本地凭证；普通 PR 不要求贡献者运行。

## Commit 与 PR

- Commit 使用简短、可验证的动作描述。
- 一个 PR 只解决一个明确问题，避免顺带重构无关内容。
- PR 描述必须包含变更原因、可观察结果、验证方法与剩余限制。

提交贡献即表示你有权提交相应内容。除非你明确书面声明其他安排，提交并被项目接收的贡献将按照 [Apache License 2.0](./LICENSE) 第 5 节授权。
