#!/usr/bin/env node

import { chromium } from "playwright";

const baseUrl = "http://127.0.0.1:4337";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

async function visible(selector, label) {
  const locator = page.locator(selector).first();
  await locator.waitFor({ state: "visible", timeout: 20_000 });
  console.log(`PRECHECK_OK ${label}`);
  return locator;
}

try {
  await page.goto(`${baseUrl}/setup`, { waitUntil: "domcontentloaded" });
  await visible("h2:has-text('当前环境已配置')", "配置摘要");
  await (await visible("button:has-text('重新配置')", "重新配置入口")).click();
  await visible("button[role='radio']:has-text('DeepSeek Harness')", "官方 Harness 选项");
  await visible("button:has-text('重新检查')", "环境检查按钮");

  await page.goto(`${baseUrl}/setup?step=model`, { waitUntil: "domcontentloaded" });
  await (await visible("#model", "模型选择器")).click();
  await (await visible("[role='option']:has-text('DeepSeek V4 Pro')", "V4 Pro 选项")).click();
  await visible("button:has-text('使用本机已配置凭证'), button:has-text('重新验证本机凭证')", "本机凭证入口");

  await page.goto(`${baseUrl}/setup?step=workspace`, { waitUntil: "domcontentloaded" });
  const workspace = await visible("#workspace-path", "工作区输入");
  await workspace.fill("/tmp/ff-deepseek-film/ImageModelArena");
  await visible("button:has-text('打开已填写路径')", "打开路径入口");

  await page.goto(`${baseUrl}/setup?step=trust`, { waitUntil: "domcontentloaded" });
  await visible("button:has-text('信任项目资源')", "信任项目入口");
  await visible("button:has-text('完成设置并进入工作台')", "完成设置入口");

  await page.goto(`${baseUrl}/workbench`, { waitUntil: "domcontentloaded" });
  await visible("button:has-text('新建会话')", "新建会话入口");
  await visible("textarea", "任务输入");
  await visible("button:has-text('发送任务'), button:has-text('继续任务')", "任务提交入口");
  console.log("PRECHECK_PASS no-paid-actions");
} finally {
  await browser.close();
}
