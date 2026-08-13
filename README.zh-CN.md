<p align="center">
  <img src="./.github/assets/readme/hero.png" alt="FF - DeepSeek Harness Web" width="100%" />
</p>

<h1 align="center">FF - DeepSeek Harness Web</h1>

<p align="center">
  <strong>同时兼容 DeepSeek Harness 与 Pi Agent 的本地优先浏览器开发工作台。</strong><br />
  在一个聚焦开发的 Web 界面中完成运行时配置、真实编程任务、工具过程观察、代码级 Diff 与结果验证。
</p>

<p align="center">
  <a href="./README.md">English</a> · <strong>简体中文</strong>
</p>

<p align="center">
  <a href="https://github.com/fufankeji/DeepSeekHarnessWeb/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/fufankeji/DeepSeekHarnessWeb/ci.yml?branch=main&style=flat-square&label=CI" /></a>
  <img alt="Node.js 24.16.0" src="https://img.shields.io/badge/Node.js-24.16.0-339933?style=flat-square&logo=nodedotjs&logoColor=white" />
  <img alt="DeepSeek Harness 0.1.0-rc.6" src="https://img.shields.io/badge/DeepSeek_Harness-0.1.0--rc.6-4D6BFE?style=flat-square" />
  <img alt="Pi Agent 0.84.1" src="https://img.shields.io/badge/Pi_Agent-0.84.1-171717?style=flat-square" />
  <a href="./LICENSE"><img alt="许可证：Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-2563EB?style=flat-square" /></a>
  <img alt="项目状态：预览" src="https://img.shields.io/badge/status-preview-F59E0B?style=flat-square" />
</p>

> [!IMPORTANT]
> 本项目由 **赋范空间** 独立开发，不是 DeepSeek 或 Pi 官方项目，与两个项目不存在隶属、赞助或官方背书关系。当前通过独立 Adapter 真实接入官方 [`@deepseek-ai/dsh@0.1.0-rc.6`](https://www.npmjs.com/package/@deepseek-ai/dsh) 与 Pi Agent `0.84.1` SDK 发行线。

> [!WARNING]
> [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 仍处于 Developer Preview，官方已明确提示后续会有破坏性兼容变更。本项目因此固定已验证版本，不会静默跟随上游 `latest`。

## DeepSeek 已经有官方 Web，为什么还要做这个项目？

DeepSeek Harness 已经提供官方 Web UI。执行 `npx @deepseek-ai/dsh web` 即可使用官方原生产品，获得与 DSH 插件架构、工作区、模型、计划、任务分工和审批协议直接对齐的一手体验。当用户追求最新官方能力或开发 DSH Plugin 时，官方 Web 是首选。

FF - DeepSeek Harness Web 解决的是另一个产品问题：把本地 Harness 转化为更易上手、过程可见、结果可审阅、证据可保留的开发工作台。它在稳定 Adapter 边界后管理官方 DSH，同时保留 Pi Agent 真实运行链路，并由 Local Bridge 独立观测文件变化和测试结果，不把“模型说完成了”当作工程事实。

| | DeepSeek Harness 官方 Web | FF - DeepSeek Harness Web |
|---|---|---|
| 核心目标 | 官方 DSH 体验与 Plugin 生态 | 面向学习、开发、审阅与演示的完整浏览器工作流 |
| 运行时 | DeepSeek Harness | 同一界面兼容 DeepSeek Harness 与 Pi Agent |
| 模型范围 | DSH 支持 DeepSeek、其他模型供应商与自定义 OpenAI 兼容端点 | 聚焦 DeepSeek 模型的配置与真实验证 |
| 首次上手 | DSH 原生配置和工作区流程 | 运行时、DeepSeek 模型、代码工作区、项目信任四步引导 |
| 过程呈现 | DSH 原生 Session 体验 | 统一展示模型 Turn、工具生命周期、终端摘要、文件和 Run 状态 |
| 代码核验 | Harness 原生行为 | Bridge 在每轮任务前建立基线，普通非 Git 目录也能展示代码级 Diff |
| 工程证据 | DSH 原生会话状态 | 脱敏本地验收台账：Adapter、事件、工具、文件、验证命令、退出码与输出 |
| 上游新鲜度 | 第一时间获得官方能力 | 以固定版本和真实验收优先，可能晚于官方新功能 |
| 更适合 | 追求原生能力、官方插件和最新 DSH 体验的用户 | 需要中文引导、低 CLI/Git 门槛、双运行时和工程级证据的用户 |

两者并不冲突：

- 需要官方原生行为、Plugin 生态与最新能力时，优先使用 [DeepSeek Harness 官方项目](https://github.com/deepseek-ai/deepseek-harness)。
- 需要浏览器产品化工作流、Pi 兼容、非 Git Diff 和可持续核对的本地证据时，使用本项目。
- 本项目不会复制或重写 DeepSeek/Pi 的 Agent Loop，上游 Harness 始终是对应 Adapter 背后的真实事实源。

## 32 秒电影级产品片

这支电影级短片集中呈现浏览器零门槛配置、DeepSeek 真实开发链路、可感知执行过程、文件结果核验、Pi 兼容与常用 Harness 命令。下方产品实景则进一步给出对应的工程证据。

<p align="center">
  <a href="https://cdn.jsdelivr.net/gh/fufankeji/deepseek-harness-web@v0.1.0/.github/assets/readme/demo.mp4">
    <img src="./.github/assets/readme/hero.png" alt="FF - DeepSeek Harness Web 电影级产品片，点击播放" width="100%" />
  </a>
</p>

<p align="center"><a href="https://cdn.jsdelivr.net/gh/fufankeji/deepseek-harness-web@v0.1.0/.github/assets/readme/demo.mp4"><strong>▶ 观看 32 秒电影级产品片（MP4）</strong></a></p>

## 产品实景

<table>
  <tr>
    <td width="50%">
      <img src="./.github/assets/readme/runtime-selection.png" alt="选择 DeepSeek Harness 或 Pi Agent" />
      <br /><strong>两套真实 Harness 运行时</strong><br />可选择官方 DeepSeek Harness，也可选择 Pi + DeepSeek 兼容链路。可用性来自真实运行时探测，不是 Mock 选项。
    </td>
    <td width="50%">
      <img src="./.github/assets/readme/verified-setup.png" alt="已验证的四步配置" />
      <br /><strong>引导式真实配置</strong><br />运行时、模型、代码工作区和项目信任是四类独立事实，全部通过后才能进入工作台。
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="./.github/assets/readme/live-execution.png" alt="Read、Edit 与 Bash 实时执行" />
      <br /><strong>让执行过程可感知</strong><br />任务运行时持续展示模型 Turn、Read/Edit/Write/Bash 生命周期、长输出、用量、终态和错误。
    </td>
    <td width="50%">
      <img src="./.github/assets/readme/code-diff.png" alt="白色代码级 Diff" />
      <br /><strong>不要求 Git 的代码级 Diff</strong><br />Local Bridge 在每轮 Run 前建立轻量基线，并独立于 Harness 计算本轮观测变化。
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="./.github/assets/readme/project-verification.png" alt="在浏览器中运行的大型项目" />
      <br /><strong>真实代码库，不止于对话</strong><br />打开普通本地目录，修改源码、执行项目命令并验证完整应用，不把聊天文本当作任务终点。
    </td>
    <td width="50%">
      <img src="./.github/assets/readme/slash-commands.png" alt="Harness 斜杠命令中心" />
      <br /><strong>与 Session 同步的斜杠命令</strong><br />命令由当前运行时和 Session 真实发现。DSH 当前通过结构化命令接口提供 <code>/compact</code>、<code>/plan</code> 与 <code>/permission</code> 等能力。
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="./.github/assets/readme/test-result.png" alt="退出码为零的独立测试结果" />
      <br /><strong>从模型说明回到工程结果</strong><br />将真实命令、退出码、输出、变化文件和可下载产物与 Assistant 最终说明分开核对。
    </td>
    <td width="50%">
      <img src="./.github/assets/readme/acceptance-evidence.png" alt="脱敏本地验收证据" />
      <br /><strong>本地验收证据</strong><br />保留 Adapter、Harness 版本、Session、Run、事件、工具、文件变化和独立测试结果等脱敏记录。
    </td>
  </tr>
</table>

## 已实现能力

- **DeepSeek 官方 Harness Adapter**：管理固定版本的 `dsh --profile web` 子进程，将官方 HTTP RPC 与 WebSocket 事件映射为供应商无关的产品合同。
- **Pi Agent 兼容 Adapter**：通过 `@earendil-works/pi-coding-agent` 直接 SDK 连接 DeepSeek，不复制 Pi 的 Agent Loop 或工具调度。
- **工作区引导**：内置示例、本地目录选择、可选 HTTPS/SSH Git 导入、非 Git 目录、路径边界和显式 Project Trust。
- **Session 生命周期**：新建、列表、命名、恢复、分叉、结束和删除，Session 与单次 Run 保持独立状态机。
- **实时任务控制**：幂等提交、SSE 事件、steer、follow-up、清队列、中断、断线恢复和 runtime generation 隔离。
- **可观察执行**：消息、思考、Turn、Read/Edit/Write/Bash、重试、压缩、用量、上下文、长输出取回以及明确的 unknown/error 状态。
- **独立文件事实**：Run 级文本快照、代码级统一 Diff、可选 Git 状态、文件树、Markdown/图片/隔离 HTML 预览和下载。
- **结构化命令中心**：从当前 Session 发现命令、校验参数，并区分同步 effect 与会发起新 Run 的命令。
- **诊断与证据**：Browser/Bridge/Adapter/Harness/模型/工作区分层诊断、能力矩阵、脱敏原始事件、SQLite 历史和验收记录。
- **中文高保真产品界面**：响应式桌面/移动端布局、单视口工作台、键盘提交、无障碍弹窗与 reduced-motion 支持。

DSH 官方协议已具备沙箱与审批能力，本产品当前只开放已落地的沙箱路径，尚未开放审批交互；额外授权请求会被安全拒绝。Pi 本身不内置权限系统，因此界面会单独呈现其真实边界，不会把 Project Trust 冒充为沙箱。

## 系统架构

<p align="center">
  <img src="./.github/assets/readme/architecture.svg" alt="FF - DeepSeek Harness Web 系统架构" width="100%" />
</p>

```text
React Web UI
  ↕ 同源 HTTP 快照/命令 + SSE 统一事件
Node.js / TypeScript Local Bridge
  ├─ WorkspaceService：目录选择、文件、可选 Git、Run 级 Diff
  ├─ Session/Event Store：SQLite WAL、回执、脱敏验收台账
  ├─ DeepSeekOfficialAdapter
  │    └─ @deepseek-ai/dsh → Web Profile HTTP RPC + WebSocket 事件
  └─ PiHarnessAdapter
       └─ Pi Agent SDK → DeepSeek 模型 API
```

前端只消费一套 `HarnessAdapter` 合同，不直接解析 DSH 或 Pi 专属对象。运行时身份、能力、命令、事件、Session 引用和错误都在后端对应 Adapter 中标准化；工作区变化和 Diff 始终是 Bridge 的独立事实。

## 快速开始

### 环境要求

- Node.js `24.16.0` 与 npm `11.x`
- 可用的 DeepSeek API Key 以及能访问对应端点的网络
- 当前版本的 Chromium 系浏览器
- 只有克隆本仓库或导入远程工作区时才需要 Git

完整产品与浏览器自动化链路已在 macOS 真实验证。架构上支持 Linux 与 WSL2，但仍需要目标平台实测；当前不声称 Windows 原生目录选择已验证。

### 安装与启动

```bash
git clone https://github.com/fufankeji/DeepSeekHarnessWeb.git
cd DeepSeekHarnessWeb
npm run install:all
npm run build
npm start
```

浏览器访问 <http://127.0.0.1:4317>。首次打开时，四步设置会引导你选择 Harness、输入 DeepSeek API Key、选择工作区并决定是否信任项目资源。对于普通本地目录，用户无需单独操作 DSH CLI，也无需初始化 Git 仓库。

### 可选：本地凭证文件

如果不希望在设置页输入 Key，可以在版本库外创建本地文件：

```yaml
api_keys:
  deepseek:
    key: YOUR_DEEPSEEK_API_KEY
    base_url: https://api.deepseek.com
```

然后通过绝对路径启动 Bridge。不要提交或分享该文件。

```bash
chmod 600 /absolute/path/to/.local-secrets.yaml
FF_CREDENTIAL_FILE=/absolute/path/to/.local-secrets.yaml npm start
```

可选环境变量：

| 变量 | 默认值 | 作用 |
|---|---|---|
| `FF_BRIDGE_HOST` | `127.0.0.1` | Local Bridge 监听地址 |
| `FF_BRIDGE_PORT` | `4317` | 浏览器和 API 端口 |
| `FF_BRIDGE_DATA_DIR` | `backend/data` | Session、SQLite 事件、DSH Home、Run 快照和完整工具输出 |
| `FF_ALLOWED_WORKSPACE_ROOT` | 不限制 | 将可选本地目录限制在一个根目录中 |
| `FF_DEEPSEEK_MODEL` | `deepseek-v4-flash` | 默认模型 ID |
| `FF_DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | 手动输入 Key 时使用的默认端点 |

## 开发与验证

| 命令 | 作用 | 是否调用模型 |
|---|---|---:|
| `npm run dev` | 以 Watch 模式启动 Local Bridge | 不会，除非提交任务 |
| `npm run dev --prefix frontend` | 启动 Vite，并将 `/api` 代理到 `4317` | 否 |
| `npm run check` | 后端 TypeScript 检查 + 前端 typecheck | 否 |
| `npm run test:unit` | 后端 Node Test + 前端 Vitest | 否 |
| `npm run build` | 构建生产前端 | 否 |
| `npm run test:e2e` | 在隔离实例中执行 Playwright 产品链路 | **是** |
| `npm run verify:real` | 真实修改代码并独立测试 | **是** |
| `npm run verify:controls` | steer、follow-up、中断与幂等控制 | **是** |
| `npm run verify:restart` | 进程重启、Session 恢复与事件回放 | **是** |
| `npm run verify:commands` | Prompt、Skill 和结构化命令行为 | **是** |
| `npm run verify:import` | 真实 Git 工作区导入 | 无需模型 |

执行任何会调用模型的真实验收命令前，需要提供已授权的本地凭证文件：

```bash
FF_CREDENTIAL_FILE=/absolute/path/to/.local-secrets.yaml npm run verify:real
```

真实验收使用独立端口和数据目录，不复用交互式 `backend/data/` 实例。系统会有意保留脱敏工作区与验收记录，使真实执行结果能够继续在产品中查看。

## 安全与数据边界

- Bridge 默认只监听 `127.0.0.1`，并校验 loopback Host/Origin 与同源 CSP。它**不是**远程多租户服务。
- API Key 不进入 Redux、URL、统一事件、日志、测试夹具或 SQLite。Pi 使用内存凭证；DSH 使用隔离的临时凭证覆盖文件，运行时释放后删除。
- 受限项目禁用受保护的项目资源。DSH 链路从托管的只读 Preset 启动；Pi 没有内置权限系统，界面会明确呈现这一独立边界。
- 每个文件路径都会在 `realpath` 后重新校验是否位于当前工作区内，包括符号链接父目录。
- HTML/SVG 在无权限 iframe 中预览；其他文件按 MIME 和大小限制预览或下载。
- `backend/data/`、凭证、依赖、构建结果、内部交付证据和本地产品规划文档都不会推送到 GitHub。

安全漏洞请按 [SECURITY.md](./SECURITY.md) 私下报告。请勿在公开 Issue 中附带凭证、私有源码、个人路径或未脱敏 Harness 事件。

## 项目结构

```text
DeepSeekHarnessWeb/
├── .github/assets/readme/   # README 公开图片、架构图和定稿演示
├── backend/                 # Local Bridge、Adapter、工作区事实、存储和测试
├── frontend/                # React UI、统一 ViewModel、HTTP/SSE 客户端和测试
├── scripts/                 # 包验证与录制工具
├── AGENTS.md                # 项目级工程边界
├── CONTRIBUTING.md          # 贡献工作流
├── SECURITY.md              # 漏洞私密报告策略
└── package.json             # 前后端统一命令入口
```

根目录 `docs/` 保存本地 PRD、产品规格、架构决策、开发计划和发布证据。根据项目约定，该目录仅在本地保留、不推送到 GitHub；对外 README 已包含独立理解和运行项目所需的信息。

## 上游项目与兼容关系

| 上游项目 | 已验证版本 | 在本项目中的作用 |
|---|---|---|
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) | [`@deepseek-ai/dsh@0.1.0-rc.6`](https://www.npmjs.com/package/@deepseek-ai/dsh) | 通过官方 Web Profile 控制面接入的主运行时 |
| [Pi Agent Harness](https://github.com/earendil-works/pi) | `@earendil-works/pi-*` `0.84.1` | 通过 Pi 公开 SDK 使用 DeepSeek 的兼容编程 Agent 运行时 |

DeepSeek、DeepSeek Harness、Pi 及其标识归各自权利人所有。本仓库中的兼容性说明只表示独立测试的互操作性，不表示官方关联或背书。

## 参与贡献

欢迎提交可复现的产品问题、Adapter 兼容结果与边界明确的用户功能改进。提交变更前请阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)。Harness 兼容性报告应链接官方资料，并且只附带已脱敏的观测信息。

## 许可证

项目软件采用 [Apache License 2.0](./LICENSE) 开源。该许可证不会额外授予将 **赋范空间**、**FF** 或原创 FF Logo 作为商标使用的权利，许可证允许的署名等用途除外；详见 [TRADEMARKS.md](./TRADEMARKS.md)。第三方组件继续遵循各自许可证，摘要见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。

---

<p align="center"><strong>@赋范空间 独家研发</strong></p>
