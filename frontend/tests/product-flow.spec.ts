import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ request }) => {
  const response = await request.post("/api/runtime/select", { data: { adapterId: "pi" } });
  expect(response.ok()).toBeTruthy();
});

test("真实首次配置、DeepSeek 任务、Diff、产物与验收记录", async ({ page }) => {
  test.setTimeout(360_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/setup");
  await expect(page.getByAltText("FF - DeepSeek Harness Web Logo")).toBeVisible();
  await expect(page.getByRole("heading", { name: "DeepSeek Harness 可视化开发工作台" })).toBeVisible();
  await expect(page.getByRole("link", { name: "打开 DeepSeek Harness Web GitHub 仓库" })).toHaveAttribute("href", "https://github.com/fufankeji/DeepSeekHarnessWeb");
  await expect(page.getByText("@赋范空间 独家研发")).toBeVisible();

  const reconfigure = page.getByRole("button", { name: "重新配置" });
  await reconfigure.or(page.getByRole("button", { name: /^(开始|重新)检查$/ })).first().waitFor();
  if (await reconfigure.isVisible().catch(() => false)) {
    await reconfigure.click();
    await expectSetupProgress(page, ["1", "2", "3", "4"]);
  }
  await page.getByRole("button", { name: /^(开始|重新)检查$/ }).click();
  await expect(page.getByText("开发环境已就绪")).toBeVisible();
  await page.getByRole("button", { name: "下一步" }).click();
  await expectSetupProgress(page, ["完成", "2", "3", "4"]);
  await expect(page.getByRole("button", { name: "上一步" })).toBeVisible();
  await page.getByRole("button", { name: "上一步" }).click();
  await expectSetupProgress(page, ["1", "2", "3", "4"]);
  await expect(page.getByRole("heading", { name: "选择 Harness 运行方式" })).toBeVisible();
  await expect(page.getByRole("radio", { name: /DeepSeek Harness/ })).toContainText("官方 DSH · 0.1.0-rc.6");
  await page.getByRole("radio", { name: /DeepSeek Harness/ }).click();
  await expect(page.getByRole("radio", { name: /DeepSeek Harness/ })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("radio", { name: /Pi \+ DeepSeek/ }).click();
  await page.getByRole("button", { name: /^(开始|重新)检查$/ }).click();
  await expect(page.getByText("开发环境已就绪")).toBeVisible();
  await expect(page.getByRole("button", { name: "重新检查" })).toBeVisible();
  await page.getByRole("button", { name: "下一步" }).click();
  await expect(page.getByLabel("思考强度")).toContainText("高 · 标准推理强度");
  await expect(page.getByRole("button", { name: "使用本机已配置凭证" })).toBeVisible();
  await page.getByRole("button", { name: "使用本机已配置凭证" }).click();
  await expect(page.getByText("DeepSeek 已就绪")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/高思考强度/)).toBeVisible();
  await page.getByRole("button", { name: "下一步" }).click();
  await expect(page.getByRole("button", { name: "选择目录" })).toBeEnabled();
  await expect(page.getByLabel("Git 仓库地址 选填")).toHaveValue("");
  await expect(page.getByRole("button", { name: "导入仓库" })).toBeDisabled();
  const acceptanceWorkspace = await page.request.post("/api/workspaces/acceptance", { data: { templateVersion: "counter-v1" } });
  expect(acceptanceWorkspace.ok()).toBeTruthy();
  await page.reload();
  await page.getByRole("button", { name: "重新配置" }).click();
  await page.getByRole("button", { name: /重新检查/ }).click();
  await expect(page.getByText("开发环境已就绪")).toBeVisible();
  await page.getByRole("button", { name: "下一步" }).click();
  await page.getByRole("button", { name: "下一步" }).click();
  await expect(page.getByText(/内置验收 \/ counter-v1/)).toBeVisible();
  await expect(page.getByRole("button", { name: "创建内置验收工作区" })).toHaveCount(0);
  await page.getByRole("button", { name: "下一步" }).click();
  await page.getByRole("button", { name: /受限模式/ }).click();
  await page.getByRole("button", { name: "完成设置并进入工作台" }).click();

  await expect(page).toHaveURL(/\/workbench$/);
  await expect(page.getByRole("heading", { name: /新的开发任务 编辑任务标题/ })).toBeVisible();
  const dockTabs = page.locator("button[aria-pressed]").filter({ hasText: /^(会话|文件)$/ });
  await expect(dockTabs).toHaveText(["会话", "文件"]);
  await expect(page.getByRole("button", { name: "会话", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "新建会话" })).toBeVisible();
  const initialComposer = page.getByPlaceholder("描述你希望 Harness 完成的开发任务…");
  await initialComposer.fill([
    "修复当前工作区里的计数器错误。",
    "必须先分别使用 read 工具读取 src/counter.js 与 test.mjs，",
    "然后必须使用 edit 工具修复 src/counter.js 中的 increment，",
    "最后必须使用 bash 工具运行精确命令 node test.mjs。",
    "不要读取或修改其他文件，不要运行其他命令；测试通过后用一句中文说明结果。"
  ].join("\n"));
  await initialComposer.press("Enter");
  await page.getByRole("button", { name: "文件", exact: true }).click();
  const fileTree = page.getByRole("tree", { name: "代码文件树" });
  const firstTreeItem = fileTree.getByRole("treeitem").first();
  await firstTreeItem.focus();
  await page.keyboard.press("ArrowDown");
  await expect(fileTree.getByRole("treeitem").nth(1)).toBeFocused();
  const completedExecution = page.getByRole("group", { name: "本轮执行过程" });
  await expect(completedExecution.getByRole("button", { name: /已完成 · \d+ 项操作 · 1 个文件变化/ })).toBeVisible({ timeout: 180_000 });
  await completedExecution.getByRole("button", { name: /已完成 · \d+ 项操作 · 1 个文件变化/ }).click();
  await expect(completedExecution.getByRole("button", { name: /^Read 已完成/ }).first()).toBeVisible();
  await expect(completedExecution.getByRole("button", { name: /^Edit 已完成/ }).first()).toBeVisible();
  await expect(completedExecution.getByRole("button", { name: /^Bash 已完成/ }).first()).toBeVisible();
  await expect(page.getByText("src/counter.js").first()).toBeVisible();
  await page.screenshot({ path: "test-results/desktop-workbench-real-run.png", fullPage: true });

  await page.getByRole("link", { name: "查看结果" }).click();
  await expect(page.getByRole("heading", { name: "任务结果核对" })).toBeVisible();
  await expect(page.getByText("独立验证通过", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: /验证输出/ }).click();
  await expect(page.getByText("counter acceptance passed")).toBeVisible();
  await page.getByRole("button", { name: /产物预览/ }).click();
  await expect(page.getByText("为什么是产物候选？")).toBeVisible();
  await page.getByRole("button", { name: /counter\.js/ }).click();
  await expect(page.getByText(/当前已选择 1 个/)).toBeVisible();
  await page.getByRole("link", { name: "返回会话" }).click();
  await expect(page.getByRole("heading", { name: /新的开发任务/ })).toBeVisible();
  await page.getByRole("treeitem", { name: /README\.md/ }).click();
  await expect(page.getByRole("heading", { name: "README.md" })).toBeVisible();
  await page.getByRole("button", { name: "Diff" }).click();
  await expect(page.getByText("本轮代码变化 · 只读")).toBeVisible();
  await page.goto("/results");
  await expect(page.getByRole("heading", { name: "任务结果核对" })).toBeVisible();
  await page.screenshot({ path: "test-results/desktop-results-real-run.png", fullPage: true });

  await page.goto("/diagnostics?view=acceptance");
  await expect(page.getByText("内置验收记录")).toBeVisible();
  await expect(page.getByText(/pi 0\.84\.1 · Adapter 接入/)).toBeVisible();
  await expect(page.getByText("counter-v1").first()).toBeVisible();
  await expect(page.getByText(/read、edit、bash|bash、edit、read/)).toBeVisible();
  await assertNoHorizontalOverflow(page);
  await page.screenshot({ path: "test-results/desktop-diagnostics-acceptance.png", fullPage: true });
  await page.getByRole("button", { name: "能力矩阵" }).click();
  await expect(page.getByRole("heading", { name: "当前能力矩阵" })).toBeVisible();
  await expect(page.getByText("当前权限", { exact: true })).toBeVisible();
  await expect(page.getByText("逐命令审批", { exact: true })).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("主题化选择器、模态框与 Tooltip 不再使用系统黑底弹层", async ({ page }) => {
  await page.goto("/setup");
  await page.waitForLoadState("networkidle");
  const reconfigure = page.getByRole("button", { name: "重新配置" });
  if (await reconfigure.isVisible().catch(() => false)) await reconfigure.click();
  await expect(page.getByRole("heading", { name: "选择 Harness 运行方式" })).toBeVisible();
  await page.getByRole("button", { name: /^(开始|重新)检查$/ }).click();
  await expect(page.getByText("开发环境已就绪")).toBeVisible();
  await page.getByRole("button", { name: "下一步" }).click();

  const modelSelect = page.getByLabel("模型");
  await modelSelect.click();
  const listbox = page.getByRole("listbox");
  await expect(listbox).toBeVisible();
  await expect(page.getByRole("option", { name: "DeepSeek V4 Flash" })).toBeVisible();
  await expect(page.getByRole("option", { name: "DeepSeek V4 Pro" })).toBeVisible();
  await page.waitForTimeout(200);
  await page.screenshot({ path: "test-results/desktop-themed-select.png", fullPage: true });
  await page.keyboard.press("Escape");
  await expect(listbox).toBeHidden();

  await page.goto("/workbench");
  const workbenchTabs = page.locator("button[aria-pressed]").filter({ hasText: /^(会话|文件)$/ });
  await expect(workbenchTabs).toHaveText(["会话", "文件"]);
  await expect(page.getByRole("button", { name: "会话", exact: true })).toHaveAttribute("aria-pressed", "true");
  const dockTabFontSize = await page.getByRole("button", { name: "会话", exact: true }).evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
  expect(dockTabFontSize).toBeGreaterThanOrEqual(15);
  const newSessionBox = await page.getByRole("button", { name: "新建会话" }).boundingBox();
  expect(newSessionBox?.width).toBeLessThan(140);
  const executionGroup = page.getByRole("group", { name: "本轮执行过程" });
  await expect(executionGroup).toBeVisible();
  const executionBox = await executionGroup.boundingBox();
  expect(executionBox?.width).toBeLessThanOrEqual(622);
  const executionToggle = executionGroup.getByRole("button").first();
  if (await executionToggle.getAttribute("aria-expanded") === "false") await executionToggle.click();
  await expect(executionGroup.getByRole("button").nth(1)).toBeVisible();
  await expect(executionGroup.getByRole("link", { name: "查看结果" })).toBeVisible();
  await page.getByRole("button", { name: "编辑任务标题" }).click();
  const dialog = page.getByRole("dialog", { name: "修改会话标题" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("会话标题")).toBeFocused();
  await expect(dialog.getByRole("button", { name: "保存标题" })).toBeVisible();
  await page.waitForTimeout(220);
  await page.screenshot({ path: "test-results/desktop-themed-dialog.png", fullPage: true });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await page.getByRole("link", { name: "环境设置" }).hover();
  await expect(page.getByRole("tooltip")).toHaveText("环境设置");
  await page.screenshot({ path: "test-results/desktop-themed-tooltip.png", fullPage: true });

  await page.goto("/diagnostics");
  await page.getByRole("button", { name: "原始事件" }).click();
  await page.getByLabel("事件类型").click();
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.getByRole("option", { name: "run.settled", exact: true }).click();
  await expect(page.getByRole("button", { name: /run\.settled/ }).first()).toBeVisible();
});

test("会话经二次确认后真实删除，并安全切换到下一会话", async ({ page, request }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const modelResponse = await request.post("/api/model/connect", { data: { credentialSource: "configured-file", verify: true } });
  expect(modelResponse.ok()).toBeTruthy();
  const workspaceResponse = await request.post("/api/workspaces/acceptance", { data: { templateVersion: "counter-v1" } });
  expect(workspaceResponse.ok()).toBeTruthy();
  const keepResponse = await request.post("/api/sessions", { data: { name: "浏览器验收 · 删除后保留" } });
  expect(keepResponse.ok()).toBeTruthy();
  const keepSession = await keepResponse.json() as { id: string };
  await runAndWait(request, keepSession.id, [
    "修复当前工作区里的计数器错误。",
    "必须先分别使用 read 工具读取 src/counter.js 与 test.mjs，",
    "然后必须使用 edit 工具修复 src/counter.js 中的 increment，",
    "最后必须使用 bash 工具运行精确命令 node test.mjs。",
    "不要读取或修改其他文件，不要运行其他命令；测试通过后用一句中文说明结果。"
  ].join("\n"), "completed");
  const recordsBeforeDelete = await request.get("/api/acceptance-records");
  const beforeBody = await recordsBeforeDelete.json() as { records: Array<{ sessionId: string }> };
  expect(beforeBody.records.some((record) => record.sessionId === keepSession.id)).toBeTruthy();
  const deleteResponse = await request.post("/api/sessions", { data: { name: "浏览器验收 · 待删除会话" } });
  expect(deleteResponse.ok()).toBeTruthy();
  const deleteSession = await deleteResponse.json() as { id: string };

  await page.goto("/workbench");
  await expect(page.getByRole("heading", { name: "浏览器验收 · 待删除会话" })).toBeVisible();
  await page.getByRole("button", { name: "删除会话：浏览器验收 · 待删除会话" }).click();
  const dialog = page.getByRole("dialog", { name: "删除“浏览器验收 · 待删除会话”？" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("此操作无法撤销。", { exact: false })).toBeVisible();
  await dialog.getByRole("button", { name: "取消" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: /浏览器验收 · 待删除会话/ }).first()).toBeVisible();

  await page.getByRole("button", { name: "删除会话：浏览器验收 · 待删除会话" }).click();
  await dialog.getByRole("button", { name: "永久删除" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(/会话已永久删除/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "浏览器验收 · 删除后保留" })).toBeVisible();
  await expect(page.getByRole("button", { name: "删除会话：浏览器验收 · 待删除会话" })).toHaveCount(0);

  const sessionsResponse = await request.get("/api/sessions");
  expect(sessionsResponse.ok()).toBeTruthy();
  const { sessions, activeSessionId } = await sessionsResponse.json() as { sessions: Array<{ id: string }>; activeSessionId: string | null };
  expect(sessions.some((session) => session.id === deleteSession.id)).toBeFalsy();
  expect(sessions.some((session) => session.id === keepSession.id)).toBeTruthy();
  expect(activeSessionId).toBe(keepSession.id);
  const recordsAfterDelete = await request.get("/api/acceptance-records");
  const afterBody = await recordsAfterDelete.json() as { records: Array<{ sessionId: string }> };
  expect(afterBody.records.some((record) => record.sessionId === keepSession.id)).toBeTruthy();
  await assertNoHorizontalOverflow(page);
  expect(pageErrors).toEqual([]);
});

test("真实控制链、队列、中断、分叉、结束与重新打开", async ({ page, request }) => {
  const modelResponse = await request.post("/api/model/connect", { data: { credentialSource: "configured-file", verify: true } });
  expect(modelResponse.ok()).toBeTruthy();
  const response = await request.post("/api/workspaces/acceptance", { data: { templateVersion: "control-v1" } });
  expect(response.ok()).toBeTruthy();
  const sessionResponse = await request.post("/api/sessions", { data: { name: "浏览器验收 · 运行控制" } });
  expect(sessionResponse.ok()).toBeTruthy();
  const session = await sessionResponse.json() as { id: string };

  await page.goto("/workbench");
  const composer = page.getByPlaceholder("描述你希望 Harness 完成的开发任务…");
  await composer.fill("请先用 read 读取 wait.mjs，然后必须用 bash 运行精确命令 node wait.mjs。命令结束前不要做其他事。");
  await page.getByRole("button", { name: "发送任务" }).click();
  await expect(page.getByText("node wait.mjs", { exact: true }).first()).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole("button", { name: "删除会话：浏览器验收 · 运行控制" })).toBeDisabled();
  await page.getByRole("button", { name: "文件", exact: true }).click();
  await expect(page.getByRole("button", { name: "任务执行中不可切换工作区" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "任务执行中不可更改环境设置" })).toBeDisabled();

  await page.getByRole("button", { name: "发送引导" }).first().click();
  const activeComposer = page.getByPlaceholder("发送引导，指导 DeepSeek 继续推进任务…");
  await activeComposer.fill("保持当前命令运行，结束后只汇报真实结果。");
  await page.getByRole("button", { name: "发送引导" }).last().click();
  await expect(page.getByText("引导已发送")).toBeVisible();

  await page.getByRole("button", { name: "排队后续" }).click();
  await page.getByPlaceholder("排队一个完成后执行的后续任务…").fill("如果没有中断，说明调用过的工具。");
  await page.getByRole("button", { name: "排队", exact: true }).click();
  await expect(page.getByText("后续任务已排队")).toBeVisible();
  await page.getByRole("button", { name: "中断" }).click();
  const cancelledExecution = page.getByRole("group", { name: "本轮执行过程" });
  await expect(cancelledExecution.getByRole("button", { name: /已取消 · \d+ 项操作/ })).toBeVisible({ timeout: 60_000 });

  await page.getByRole("button", { name: "会话", exact: true }).click();
  await page.getByRole("button", { name: "从最近用户消息分叉" }).click();
  await expect(page.getByRole("heading", { name: /分叉/ })).toBeVisible();
  await page.getByRole("button", { name: "结束当前会话" }).click();
  await expect(page.getByText("会话已结束，历史仍保留并可重新打开")).toBeVisible();
  await page.getByRole("button", { name: /浏览器验收 · 运行控制 deepseek/ }).click();
  await expect(page.getByRole("heading", { name: "浏览器验收 · 运行控制" })).toBeVisible();

  const eventsResponse = await request.get(`/api/sessions/${encodeURIComponent(session.id)}/events`);
  const { events } = await eventsResponse.json() as { events: Array<{ kind: string; payload: Record<string, unknown> }> };
  expect(events.some((event) => event.kind === "queue.updated" && event.payload.clearedSteeringCount === 1 && event.payload.clearedFollowUpCount === 1)).toBeTruthy();
});

test("刷新恢复、事件筛选与诊断脱敏", async ({ page }) => {
  await page.goto("/workbench");
  await expect(page.getByRole("heading", { name: "浏览器验收 · 运行控制" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "浏览器验收 · 运行控制" })).toBeVisible();
  await page.goto("/diagnostics");
  await expect(page.getByRole("heading", { name: "运行诊断" })).toBeVisible();
  await page.getByRole("button", { name: "原始事件" }).click();
  await page.getByLabel("事件类型").click();
  await page.getByRole("option", { name: "run.settled", exact: true }).click();
  await expect(page.getByRole("button", { name: /run\.settled/ }).first()).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/sk-[A-Za-z0-9_-]{8,}/);
  await page.getByRole("button", { name: "复制脱敏诊断" }).click();
  await expect(page.getByRole("button", { name: /已复制|复制失败/ })).toBeVisible();
  await assertNoHorizontalOverflow(page);
});

test("同一会话多轮任务会恢复较早历史", async ({ page, request }) => {
  const modelResponse = await request.post("/api/model/connect", { data: { credentialSource: "configured-file", verify: true } });
  expect(modelResponse.ok()).toBeTruthy();
  const workspaceResponse = await request.post("/api/workspaces/acceptance", { data: { templateVersion: "counter-v1" } });
  expect(workspaceResponse.ok()).toBeTruthy();
  const sessionResponse = await request.post("/api/sessions", { data: { name: "浏览器验收 · 会话历史" } });
  expect(sessionResponse.ok()).toBeTruthy();
  const session = await sessionResponse.json() as { id: string };

  await runAndWait(request, session.id, "第一轮：只回复‘第一轮完成’，不要调用工具。", "completed");
  await runAndWait(request, session.id, "第二轮：只回复‘第二轮完成’，不要调用工具。", "completed");

  await page.goto("/workbench");
  await expect(page.getByRole("heading", { name: "浏览器验收 · 会话历史" })).toBeVisible();
  await expect(page.getByText("较早的任务")).toBeVisible();
  await expect(page.getByText(/第一轮：只回复/)).toBeVisible();
  await page.reload();
  await expect(page.getByText("较早的任务")).toBeVisible();
  await expect(page.getByText(/第二轮：只回复/)).toBeVisible();
  await assertNoHorizontalOverflow(page);
});

test("真实长输出截断后可从工具检查器取回完整内容", async ({ page, request }) => {
  const modelResponse = await request.post("/api/model/connect", { data: { credentialSource: "configured-file", verify: true } });
  expect(modelResponse.ok()).toBeTruthy();
  const workspaceResponse = await request.post("/api/workspaces/acceptance", { data: { templateVersion: "long-output-v1" } });
  expect(workspaceResponse.ok()).toBeTruthy();
  const sessionResponse = await request.post("/api/sessions", { data: { name: "浏览器验收 · 长输出取回" } });
  expect(sessionResponse.ok()).toBeTruthy();

  await page.goto("/workbench");
  await page.getByPlaceholder("描述你希望 Harness 完成的开发任务…").fill([
    "先使用 read 读取 long-output.mjs，",
    "然后必须使用 bash 运行精确命令 node long-output.mjs。",
    "不要访问其他文件或运行其他命令，结束后只说明命令已完成。"
  ].join("\n"));
  await page.getByRole("button", { name: "发送任务" }).click();
  const longOutputExecution = page.getByRole("group", { name: "本轮执行过程" });
  const longOutputToggle = longOutputExecution.getByRole("button", { name: /已完成 · \d+ 项操作/ });
  await expect(longOutputToggle).toBeVisible({ timeout: 180_000 });
  await longOutputToggle.click();

  const bashCard = longOutputExecution.getByRole("button", { name: /Bash 已完成.*node long-output\.mjs/ }).first();
  await expect(bashCard).toBeVisible();
  await bashCard.click();
  const fullOutputLink = page.getByRole("link", { name: /完整输出/ });
  await expect(fullOutputLink).toBeVisible();
  await expect(page.getByText(/输出 · 已截断/)).toBeVisible();
  const outputHref = await fullOutputLink.getAttribute("href");
  expect(outputHref).toMatch(/^\/api\/tool-outputs\/[0-9a-f-]+$/);
  const outputResponse = await request.get(outputHref!);
  expect(outputResponse.ok()).toBeTruthy();
  const output = await outputResponse.text();
  expect(output).toContain("FF-LONG-OUTPUT-0001");
  expect(output).toContain("FF-LONG-OUTPUT-END");
  expect(output).not.toMatch(/Full output:\s*\//i);
  await assertNoHorizontalOverflow(page);
});

test("错误 DeepSeek 凭证显示模型层错误并可用本机凭证恢复", async ({ page }) => {
  await page.goto("/setup");
  await page.waitForLoadState("networkidle");
  const reconfigure = page.getByRole("button", { name: "重新配置" });
  if (await reconfigure.isVisible().catch(() => false)) await reconfigure.click();
  await expect(page.getByRole("heading", { name: "选择 Harness 运行方式" })).toBeVisible();
  await page.getByRole("button", { name: /^(开始|重新)检查$/ }).click();
  await expect(page.getByText("开发环境已就绪")).toBeVisible();
  await page.getByRole("button", { name: "下一步" }).click();
  await page.getByPlaceholder("输入 DeepSeek API Key").fill("definitely-invalid-key");
  await page.getByRole("button", { name: "检查模型连接" }).click();
  await expect(page.getByText("DeepSeek 凭证验证失败。")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByPlaceholder("输入 DeepSeek API Key")).toHaveValue("");
  await page.screenshot({ path: "test-results/desktop-model-auth-error.png", fullPage: true });
  await page.getByRole("button", { name: "使用本机已配置凭证" }).click();
  await expect(page.getByText("DeepSeek 已就绪")).toBeVisible({ timeout: 60_000 });
  await assertNoHorizontalOverflow(page);
});

async function assertNoHorizontalOverflow(page: import("@playwright/test").Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function expectSetupProgress(page: import("@playwright/test").Page, expected: string[]) {
  const steps = page.getByRole("navigation", { name: "配置步骤" }).getByRole("button");
  await expect(steps).toHaveCount(4);
  const actual = await steps.evaluateAll((buttons) => buttons.map((button) => {
    const icon = button.firstElementChild;
    return icon?.querySelector("svg") ? "完成" : icon?.textContent?.trim() ?? "";
  }));
  expect(actual).toEqual(expected);
}

async function runAndWait(request: import("@playwright/test").APIRequestContext, sessionId: string, text: string, expected: string) {
  const runResponse = await request.post(`/api/sessions/${encodeURIComponent(sessionId)}/runs`, {
    data: { requestId: crypto.randomUUID(), text }
  });
  expect(runResponse.ok()).toBeTruthy();
  const receipt = await runResponse.json() as { runId: string };
  await expect.poll(async () => {
    const response = await request.get(`/api/sessions/${encodeURIComponent(sessionId)}/events`);
    const { events } = await response.json() as { events: Array<{ runId?: string; kind: string; payload: Record<string, unknown> }> };
    return events.findLast((event) => event.runId === receipt.runId && event.kind === "run.settled")?.payload.status;
  }, { timeout: 180_000 }).toBe(expected);
}
