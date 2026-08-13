# Pi + DeepSeek 无 UI Spike

该目录用于阶段 1 的真实纵向验证，不是产品 Runtime，也不提供 Mock Adapter。

- 精确固定 `@earendil-works/pi-*` `0.84.1` 同发行线依赖。
- DeepSeek Key 只从用户授权的本地 YAML 读入进程内存，不复制到仓库、不打印、不持久化。
- `models.json` 只写入每次运行创建的临时 agent 目录，不包含 Key，结束后删除。
- Agent 写入仅允许发生在脚本创建的临时 Git 工作区，不使用当前产品仓库。
- 原始事件只能在脱敏和范围校验后成为测试夹具。

当前命令：

```bash
npm run check
npm run probe
npm run run
npm run control
npm run session
```

- `npm run probe` 只验证 Pi 本地模型目录与运行时凭证注入，不发起模型推理。
- `npm run run` 在临时 Git 仓库执行真实 `read → edit → bash → 独立测试 → Git Diff` 闭环。
- `npm run control` 用真实流验证 steer、follow-up、队列快照、清队列和 abort/settled。
- `npm run session` 验证 `AgentSessionRuntime` 的新建、恢复、fork、重订阅和 generation。

运行前必须让 `FF_CREDENTIAL_FILE` 指向用户明确授权的本地 YAML；路径不写入仓库。后三个命令会调用 DeepSeek API 并可能产生费用，只能在用户明确授权后执行。脚本读取 YAML 后会删除该环境变量，且不会把 Key 放入环境变量，因为 Pi 启动的 Bash 子进程会继承环境；Key 仅通过 `InMemoryCredentialStore` 进入模型运行时。

真实运行的脱敏协议样本见 `fixtures/pi-0.84.1-deepseek-events.json`。夹具只保留事件种类、计数、更新语义和由脚本生成的 allowlist 路径，不保存模型文本、推理、原始载荷、绝对路径或凭证。
