import { expect, test } from "@playwright/test";

test("移动端核心页面不横向溢出且入口可达", async ({ page }) => {
  for (const path of ["/setup", "/workbench", "/results", "/diagnostics?view=acceptance"]) {
    await page.goto(path);
    await expect(page.getByAltText("FF - DeepSeek Harness Web Logo")).toBeVisible();
    if (path === "/workbench") {
      await expect(page.getByRole("heading", { level: 1 })).not.toHaveText("尚未创建会话");
      await expect(page.getByRole("button", { name: "会话", exact: true })).toHaveAttribute("aria-pressed", "true");
      await page.getByRole("button", { name: "文件", exact: true }).click();
      await expect(page.getByRole("tree", { name: "代码文件树" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "执行过程", level: 3 })).toBeVisible();
      await expect(page.getByText("这里展示来自统一事件的真实运行状态；未识别载荷保留在“诊断 / 原始事件”。")).toBeVisible();
      await page.getByRole("button", { name: "编辑任务标题" }).click();
      const dialog = page.getByRole("dialog", { name: "修改会话标题" });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByLabel("会话标题")).toBeFocused();
      const dialogOverflow = await dialog.evaluate((element) => element.scrollWidth - element.clientWidth);
      expect(dialogOverflow, "移动端主题模态框横向溢出").toBeLessThanOrEqual(1);
      await page.screenshot({ path: "test-results/mobile-themed-dialog.png", fullPage: true });
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
    } else if (path === "/results") {
      await expect(page.getByRole("heading", { name: "任务结果核对" })).toBeVisible();
      await expect(page.getByText("本次没有文件变化")).toBeVisible();
    } else if (path.startsWith("/diagnostics")) {
      await expect(page.getByText("内置验收记录")).toBeVisible();
      await expect(page.getByText(/pi 0\.84\.1 · Adapter 接入/)).toBeVisible();
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${path} 横向溢出`).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `test-results/mobile-${path.replace(/[^a-z]+/gi, "-")}.png`, fullPage: true });
  }
});
