---
document: verification
scope: github-bootstrap
date: "2026-08-12"
status: passed
---

# GitHub 公共仓库初始化验证

## 验证目标

- 本地仓库包含公共 README 和必要的社区健康文件。
- GitHub 仓库为 Public，默认分支为 `main`。
- 仓库描述、Topics、Issue Forms、PR 模板和安全报告入口可用。
- 本地初始提交已经推送，工作区干净。

## 验证结果

### 本地文件检查

- 方法：只读 Python 断言检查公共仓库文件、README 本地链接和模板占位符，并使用 PyYAML 解析全部 Issue Forms。
- 退出状态：`0`。
- 结果：公共仓库文件存在、README 本地链接均可解析、无模板占位符、Issue Forms YAML 合法。

### Git 与远端检查

- 仓库地址：<https://github.com/fufankeji/DeepSeekHarnessWeb>
- 可见性：`public`
- 默认分支：`main`
- 本地分支：跟踪 `origin/main`
- 初始提交：`387f6ec239b138a9cf70b7d7673e52b438acba7d`
- 推送检查：本地与远端 `main` 指向同一提交，工作区干净。

### GitHub 设置检查

- Issues：启用。
- Projects、Wiki、Discussions：在当前阶段关闭。
- 合并方式：允许 Squash 与 Rebase，关闭 Merge Commit。
- 合并后自动删除分支：启用。
- Topics：`deepseek`、`agent-harness`、`web-ui`、`coding-agent`、`developer-tools`。
- `compatibility` 标签：已创建。
- Secret Scanning：启用。
- Push Protection：启用。
- Private Vulnerability Reporting：接口返回 `HTTP 200`。
- 远端 Issue Forms：`bug_report.yml`、`feature_request.yml`、`harness_compatibility.yml` 均存在。
- GitHub Community Profile：`71%`；已识别 README、CONTRIBUTING、Issue Template 与 PR Template。

### 结论

公开仓库、默认分支、社区入口、安全入口和基础合并策略已就绪。

## 有意保留的未配置项

- 开源许可证尚未由产品所有者选择，因此不创建 `LICENSE`。
- `CODE_OF_CONDUCT.md` 不是当前抢占仓库和技术讨论的必要条件，待项目正式接受社区贡献时再决定是否加入。
- 技术栈和 manifest 尚未确定，因此不创建 CI、Dependabot 或伪造的构建命令。
