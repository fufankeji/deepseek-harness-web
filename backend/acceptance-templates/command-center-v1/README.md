# Command Center Acceptance Workspace

这是 DeepSeek Harness Web 的内置斜杠命令验收工作区。

它保留两类 Pi 项目资源：

- `.pi/prompts/command-check.md`：验证 Prompt Template 的发现、展开和真实模型 Run。
- `.pi/skills/command-check/SKILL.md`：验证 Skill 的发现、显式调用和真实模型 Run。
- `.pi/extensions/command-check.ts`：验证 Extension 命令可发现，但在未建立 Web UI Bridge 前保持不可执行。

该工作区不要求修改代码。`verify.mjs` 只核对验收资源仍然存在，便于平台长期保留和复查本次命令中心测试数据。
