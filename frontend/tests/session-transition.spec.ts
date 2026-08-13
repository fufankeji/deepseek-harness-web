import { expect, test } from "@playwright/test";
import { mkdir, stat } from "node:fs/promises";
import { resolve } from "node:path";

test.beforeEach(async ({ request }) => {
  const response = await request.post("/api/runtime/select", { data: { adapterId: "pi" } });
  expect(response.ok()).toBeTruthy();
});

test("新建会话只切换局部内容，不显示全局重连横幅", async ({ page, request }) => {
  const model = await request.post("/api/model/connect", { data: { credentialSource: "configured-file", modelId: "deepseek-v4-pro", thinkingLevel: "max", verify: true } });
  expect(model.ok()).toBeTruthy();
  const workspace = await request.post("/api/workspaces/acceptance", { data: { templateVersion: "counter-v1" } });
  expect(workspace.ok()).toBeTruthy();
  const initialSession = await request.post("/api/sessions", { data: { name: "会话切换验收" } });
  expect(initialSession.ok()).toBeTruthy();

  await page.goto("/workbench");
  await expect(page.getByRole("heading", { name: "会话切换验收" })).toBeVisible();
  const panel = page.locator('[class*="panels"]').first();
  const before = await panel.boundingBox();

  await page.getByRole("button", { name: "新建会话" }).click();
  await expect(page.getByRole("heading", { name: /^新的开发任务/ })).toBeVisible();
  await expect(page.getByText("正在重新连接，当前内容可能已过期")).toHaveCount(0);
  const after = await panel.boundingBox();
  expect(after).toEqual(before);
});

test("被工作区策略拦截的终端工具不会误报任务完成", async ({ page, request }) => {
  const model = await request.post("/api/model/connect", { data: { credentialSource: "configured-file", modelId: "deepseek-v4-pro", thinkingLevel: "max", verify: true } });
  expect(model.ok()).toBeTruthy();
  const workspace = await request.post("/api/workspaces/acceptance", { data: { templateVersion: "counter-v1" } });
  expect(workspace.ok()).toBeTruthy();
  const sessionResponse = await request.post("/api/sessions", { data: { name: "工具拦截状态验收" } });
  expect(sessionResponse.ok()).toBeTruthy();
  const session = await sessionResponse.json() as { id: string };

  const runResponse = await request.post(`/api/sessions/${encodeURIComponent(session.id)}/runs`, {
    data: {
      requestId: crypto.randomUUID(),
      text: "只使用 bash 工具执行精确命令 mkdir -p blocked-project，调用后立即结束，不要改用其他工具，也不要继续解释。"
    }
  });
  expect(runResponse.ok()).toBeTruthy();
  const receipt = await runResponse.json() as { runId: string };
  await expect.poll(async () => {
    const response = await request.get(`/api/sessions/${encodeURIComponent(session.id)}/events`);
    const { events } = await response.json() as { events: Array<{ runId?: string; kind: string; payload: Record<string, unknown> }> };
    return events.findLast((event) => event.runId === receipt.runId && event.kind === "run.settled")?.payload.status;
  }, { timeout: 120_000 }).toBe("failed");

  await page.goto("/workbench");
  const failedExecution = page.getByRole("group", { name: "本轮执行过程" });
  await expect(failedExecution.getByRole("button", { name: /失败 · 1 项操作 · 0 个文件变化/ })).toBeVisible();
  await failedExecution.getByRole("button", { name: /失败 · 1 项操作 · 0 个文件变化/ }).click();
  await expect(failedExecution.getByText("任务执行失败", { exact: true })).toBeVisible();
  await expect(failedExecution.getByTitle("验收工作区只允许运行当前模板的精确命令。")).toBeVisible();
});

test("普通可信工作区真实执行建目录命令", async ({ request }) => {
  const workspacePath = resolve("data/e2e/user-workspaces", crypto.randomUUID());
  await mkdir(workspacePath, { recursive: true });
  const model = await request.post("/api/model/connect", { data: { credentialSource: "configured-file", modelId: "deepseek-v4-pro", thinkingLevel: "max", verify: true } });
  expect(model.ok()).toBeTruthy();
  const workspace = await request.post("/api/workspaces/select", { data: { path: workspacePath, projectTrusted: true } });
  expect(workspace.ok()).toBeTruthy();
  expect(await workspace.json()).toMatchObject({ projectTrusted: true, displayPath: expect.not.stringContaining("内置验收") });
  const sessionResponse = await request.post("/api/sessions", { data: { name: "普通可信工作区命令验收" } });
  expect(sessionResponse.ok()).toBeTruthy();
  const session = await sessionResponse.json() as { id: string };

  const command = "mkdir -p DeepSeekHarnessProject/backend DeepSeekHarnessProject/docs DeepSeekHarnessProject/frontend && find DeepSeekHarnessProject -type d";
  const runResponse = await request.post(`/api/sessions/${encodeURIComponent(session.id)}/runs`, {
    data: {
      requestId: crypto.randomUUID(),
      text: `只使用 bash 工具执行以下精确命令，成功后用一句中文说明结果，不要执行其他命令：${command}`
    }
  });
  expect(runResponse.ok()).toBeTruthy();
  const receipt = await runResponse.json() as { runId: string };
  await expect.poll(async () => {
    const response = await request.get(`/api/sessions/${encodeURIComponent(session.id)}/events`);
    const body = await response.json() as { events: Array<{ runId?: string; kind: string; payload: Record<string, unknown> }> };
    const runEvents = body.events.filter((event) => event.runId === receipt.runId);
    return runEvents.findLast((event) => event.kind === "run.settled")?.payload.status;
  }, { timeout: 120_000 }).toBe("completed");
  const persisted = await (await request.get(`/api/sessions/${encodeURIComponent(session.id)}/events`)).json() as { events: Array<{ runId?: string; kind: string; payload: Record<string, unknown> }> };
  const runEvents = persisted.events.filter((event) => event.runId === receipt.runId);
  expect(runEvents.findLast((event) => event.kind === "run.settled")?.payload.status).toBe("completed");
  expect(runEvents.find((event) => event.kind === "tool.completed" && event.payload.toolName === "bash")?.payload).toMatchObject({ isError: false, exitCode: 0 });
  expect((await stat(resolve(workspacePath, "DeepSeekHarnessProject/backend"))).isDirectory()).toBe(true);
  expect((await stat(resolve(workspacePath, "DeepSeekHarnessProject/docs"))).isDirectory()).toBe(true);
  expect((await stat(resolve(workspacePath, "DeepSeekHarnessProject/frontend"))).isDirectory()).toBe(true);
});

test("E2E 运行在独立 Bridge 和数据目录", async ({ request }) => {
  const diagnostics = await request.get("/api/diagnostics");
  expect(diagnostics.ok()).toBeTruthy();
  const body = await diagnostics.json() as { bridge: { testInstance?: boolean } };
  expect(body.bridge.testInstance).toBe(true);
});
