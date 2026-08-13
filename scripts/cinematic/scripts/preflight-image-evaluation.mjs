#!/usr/bin/env node

import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";

const baseUrl = "http://127.0.0.1:3001";
const prompt = "一座未来东方图书馆悬浮在云海之上，钴蓝玻璃与暖金木构，清晨体积光，广角建筑摄影，电影级细节，无文字。";
const output = resolve(import.meta.dirname, "../../../artifacts/cinematic/review/image-evaluation-preflight.png");
mkdirSync(dirname(output), { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
page.setDefaultTimeout(30_000);

try {
  await page.goto(`${baseUrl}/#/arena`, { waitUntil: "domcontentloaded" });
  await page.locator(".arena-v2-page").waitFor({ state: "visible" });
  console.log("PRECHECK_OK 评测工作台");

  await page.getByRole("button", { name: /公平评测说明/ }).click();
  await page.locator("[role='region'][aria-label='公平评测说明']").waitFor({ state: "visible" });
  await page.getByRole("button", { name: /公平评测说明/ }).click();
  console.log("PRECHECK_OK 公平评测说明");

  await page.getByRole("button", { name: "选择模型", exact: true }).click();
  const picker = page.locator("[role='group'][aria-label='选择参与评测的模型']");
  await picker.waitFor({ state: "visible" });
  const currentModel = picker.locator("button").filter({ hasText: "openai/gpt-5.4-image-2" });
  const targetModel = picker.locator("button").filter({ hasText: "openai/gpt-image-2" });
  await currentModel.click();
  await targetModel.click();
  console.log("PRECHECK_OK Gemini 3 Pro Image + GPT Image 2");

  await page.getByRole("button", { name: "选择模型", exact: true }).click();
  await page.locator("textarea[aria-label='共享提示词']").fill(prompt);

  const runButton = page.getByRole("button", { name: "发起评测" });
  await runButton.waitFor({ state: "visible" });
  if (await runButton.isDisabled()) throw new Error("发起评测仍不可用");
  await page.screenshot({ path: output, animations: "disabled" });
  console.log(`PRECHECK_PASS no-generation ${output}`);
} finally {
  await browser.close();
}
