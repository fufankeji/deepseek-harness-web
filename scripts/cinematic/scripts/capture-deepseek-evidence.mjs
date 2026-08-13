#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { chromium } from "playwright";

const projectRoot = resolve(import.meta.dirname, "../../..");
const publicRoot = resolve(projectRoot, "scripts/cinematic/public");
const baseUrl = "http://127.0.0.1:4337";
const evidence = [];

function hash(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

async function save(locatorOrPage, output, options = {}) {
  const absolute = resolve(publicRoot, output);
  mkdirSync(dirname(absolute), { recursive: true });
  await locatorOrPage.screenshot({ path: absolute, animations: "disabled", ...options });
  evidence.push({ output: relative(projectRoot, absolute), sha256: hash(absolute) });
  console.log(`CAPTURED ${output}`);
}

const browser = await chromium.launch({
  headless: true,
  args: ["--disable-blink-features=AutomationControlled"]
});
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 2
});
await context.addInitScript(() => {
  class SnapshotEventSource {
    constructor() {
      this.readyState = 1;
      setTimeout(() => this.onopen?.(new Event("open")), 0);
    }
    close() {
      this.readyState = 2;
    }
    addEventListener() {}
    removeEventListener() {}
    dispatchEvent() { return true; }
  }
  Object.defineProperty(window, "EventSource", { value: SnapshotEventSource, configurable: true });
});
const page = await context.newPage();
page.setDefaultTimeout(60_000);

try {
  await page.goto(`${baseUrl}/setup`, { waitUntil: "domcontentloaded" });
  await page.locator("h2:has-text('当前环境已配置')").first().waitFor({ state: "visible" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(800);
  await save(page, "textures/setup/summary.png");

  await page.locator("button:has-text('重新配置')").first().click();
  await page.locator("button[role='radio']:has-text('DeepSeek Harness')").first().waitFor({ state: "visible" });
  await page.waitForTimeout(500);
  await save(page, "textures/setup/environment.png");

  await page.goto(`${baseUrl}/setup?step=model`, { waitUntil: "domcontentloaded" });
  await page.locator("#model").first().waitFor({ state: "visible" });
  await page.locator("text=DeepSeek 已就绪").first().waitFor({ state: "visible" });
  await page.waitForTimeout(500);
  await save(page, "textures/setup/model-v4-pro.png");

  await page.goto(`${baseUrl}/setup?step=workspace`, { waitUntil: "domcontentloaded" });
  await page.locator("#workspace-path").first().waitFor({ state: "visible" });
  await page.waitForTimeout(700);
  await save(page, "textures/setup/workspace.png");

  await page.goto(`${baseUrl}/setup?step=trust`, { waitUntil: "domcontentloaded" });
  await page.locator("button:has-text('信任项目资源')").first().waitFor({ state: "visible" });
  await page.waitForTimeout(500);
  await save(page, "textures/setup/trust.png");

  await page.goto(`${baseUrl}/workbench`, { waitUntil: "domcontentloaded" });
  await page.locator("textarea").first().waitFor({ state: "visible", timeout: 180_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(12_000);
  await save(page, "textures/development/execution-complete.png", { animations: "allow", timeout: 180_000 });

  const execution = page.locator("[role='group'][aria-label='本轮执行过程']").first();
  await execution.waitFor({ state: "visible" });
  const executionToggle = execution.locator("button").first();
  if (await executionToggle.getAttribute("aria-expanded") === "false") {
    await executionToggle.click();
    await page.waitForTimeout(500);
  }
  await save(execution, "textures/development/execution-read.png");
  for (const [tool, output] of [
    ["Edit", "textures/development/execution-edit.png"],
    ["Bash", "textures/development/execution-bash.png"]
  ]) {
    const card = execution.locator("button").filter({ hasText: tool }).last();
    if (await card.count()) await save(card, output);
  }

  await page.getByRole("button", { name: "文件" }).first().click();
  const search = page.locator("input[placeholder='搜索文件或目录']").first();
  await search.waitFor({ state: "visible" });
  await search.fill("WorkbenchPage.tsx");
  const changedFile = page.locator("[role='treeitem']").filter({ hasText: "WorkbenchPage.tsx" }).first();
  await changedFile.waitFor({ state: "visible" });
  await save(page, "textures/development/local-file-fact.png", { animations: "allow", timeout: 180_000 });
  await changedFile.click();
  await page.locator("[aria-label='代码 Diff']").first().waitFor({ state: "visible" });
  await page.waitForTimeout(900);
  await save(page, "textures/development/diff-page.png", { animations: "allow", timeout: 180_000 });
  await save(page.locator("[aria-label='代码 Diff']").first(), "textures/development/code-after.png");

  await page.locator("a[href='/results']").last().click();
  await page.locator("h1:has-text('任务结果核对')").first().waitFor({ state: "visible", timeout: 120_000 });
  await page.waitForTimeout(900);
  await save(page, "textures/development/results-page.png", { animations: "allow", timeout: 180_000 });
  await page.getByRole("button", { name: /验证输出/ }).first().click();
  await page.waitForTimeout(700);
  await save(page, "textures/development/verification-output.png", { animations: "allow", timeout: 180_000 });

  await page.getByRole("link", { name: "返回会话" }).click();
  await page.locator("textarea").first().waitFor({ state: "visible", timeout: 120_000 });
  await page.locator("textarea").first().fill("/");
  await page.locator("[role='listbox'][aria-label='Harness 斜杠命令']").first().waitFor({ state: "visible" });
  await page.waitForTimeout(600);
  await save(page, "textures/commands/official-palette.png", { animations: "allow", timeout: 180_000 });
} finally {
  await browser.close();
}

const evidencePath = resolve(projectRoot, "artifacts/cinematic/evidence/deepseek-capture-evidence.json");
mkdirSync(dirname(evidencePath), { recursive: true });
writeFileSync(evidencePath, `${JSON.stringify({
  capturedAt: new Date().toISOString(),
  baseUrl,
  classification: "sanitized",
  approvalEvidence: "用户授权电影宣传片采集；本脚本只读取已完成会话，不提交任务、不执行命令。",
  files: evidence
}, null, 2)}\n`);
console.log(`CAPTURE_PASS ${relative(projectRoot, evidencePath)}`);
