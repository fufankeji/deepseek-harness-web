#!/usr/bin/env node

import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {chromium} from 'playwright';

const outputRoot = resolve(import.meta.dirname, '../public/textures/product');
mkdirSync(outputRoot, {recursive: true});

const browser = await chromium.launch({headless: true});
const context = await browser.newContext({
  viewport: {width: 1920, height: 1080},
  deviceScaleFactor: 2,
});
const page = await context.newPage();
page.setDefaultTimeout(30_000);

try {
  await page.goto('http://127.0.0.1:3001/#/arena', {waitUntil: 'domcontentloaded'});
  await page.locator('.arena-v2-page').waitFor({state: 'visible'});
  await page.locator("textarea[aria-label='共享提示词']").fill('一座未来东方图书馆悬浮在云海之上，钴蓝玻璃与暖金木构，清晨体积光，广角建筑摄影，电影级细节，无文字。');
  const fairnessButton = page.getByRole('button', {name: '公平评测说明'});
  if (await fairnessButton.getAttribute('aria-expanded') === 'true') await fairnessButton.click();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
  await page.screenshot({path: resolve(outputRoot, 'arena-preflight-2x.png'), animations: 'disabled'});
  await page.locator('.arena-v2-prompt').screenshot({path: resolve(outputRoot, 'fairness-prompt.png'), animations: 'disabled'});
  await fairnessButton.click();
  await page.locator('.arena-v2-fairness__panel').waitFor({state: 'visible'});
  await page.locator('.arena-v2-fairness__panel').screenshot({path: resolve(outputRoot, 'fairness-panel.png'), animations: 'disabled'});
} finally {
  await browser.close();
}

console.log('PRODUCT_TEXTURE_CAPTURE_PASS');
