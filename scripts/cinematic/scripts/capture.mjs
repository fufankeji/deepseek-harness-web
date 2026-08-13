#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspace = path.resolve(scriptDir, '..');
const configPath = path.resolve(workspace, process.argv[2] ?? 'capture.config.json');

if (!existsSync(configPath)) throw new Error(`Capture config not found: ${configPath}`);
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const allowedClasses = new Set(['public-demo', 'synthetic', 'sanitized']);

if (!config.dataPolicy?.approved || !String(config.dataPolicy?.approvalEvidence ?? '').trim()) {
  throw new Error('Capture blocked: dataPolicy.approved=true and approvalEvidence are required.');
}
if (!allowedClasses.has(config.dataPolicy.classification)) {
  throw new Error(`Capture blocked: unsupported data classification ${config.dataPolicy.classification}.`);
}
if (!Array.isArray(config.pages) || config.pages.length === 0) {
  throw new Error('Capture config requires at least one page.');
}

const outputRoot = path.resolve(workspace, config.outputDir ?? 'public/textures');
if (outputRoot !== workspace && !outputRoot.startsWith(`${workspace}${path.sep}`)) {
  throw new Error('outputDir must stay inside scripts/cinematic.');
}
mkdirSync(outputRoot, {recursive: true});

const viewport = config.viewport ?? {};
const width = Number(viewport.width ?? 1920);
const height = Number(viewport.height ?? 1080);
const deviceScaleFactor = Number(viewport.deviceScaleFactor ?? 2);
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const safeKey = (value, field) => {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) throw new Error(`${field} must be kebab-case: ${value}`);
  return value;
};

const browser = await chromium.launch({headless: true});
const context = await browser.newContext({viewport: {width, height}, deviceScaleFactor});
const page = await context.newPage();
const manifest = {
  capturedAt: new Date().toISOString(),
  config: path.relative(workspace, configPath),
  viewport: {width, height, deviceScaleFactor},
  dataPolicy: config.dataPolicy,
  pages: [],
};

try {
  for (const pageConfig of config.pages) {
    const pageKey = safeKey(pageConfig.key, 'page.key');
    const pageDir = path.join(outputRoot, pageKey);
    mkdirSync(pageDir, {recursive: true});
    const url = new URL(pageConfig.path ?? '/', config.baseUrl).toString();
    await page.goto(url, {waitUntil: 'domcontentloaded'});
    if (pageConfig.waitFor) await page.locator(pageConfig.waitFor).first().waitFor({state: 'visible'});
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(Number(pageConfig.settleMs ?? 600));

    const masks = (pageConfig.maskSelectors ?? []).map((selector) => page.locator(selector));
    const pageH = await page.evaluate(() => Math.max(document.body.scrollHeight, document.documentElement.scrollHeight));
    const fullPagePath = path.join(pageDir, 'full-page.png');
    await page.screenshot({path: fullPagePath, fullPage: true, mask: masks});

    const pageRecord = {
      key: pageKey,
      url,
      pageH,
      fullPage: {file: path.relative(workspace, fullPagePath), sha256: sha256(fullPagePath)},
      elements: [],
      backplates: [],
    };

    for (const element of pageConfig.elements ?? []) {
      const elementKey = safeKey(element.key, 'element.key');
      const locator = page.locator(element.selector).first();
      await locator.waitFor({state: 'visible'});
      const box = await locator.boundingBox();
      if (!box) throw new Error(`No bounding box for ${pageKey}/${elementKey}`);
      const file = path.join(pageDir, `${elementKey}.png`);
      await locator.screenshot({path: file, omitBackground: Boolean(element.omitBackground)});
      pageRecord.elements.push({
        key: elementKey,
        selector: element.selector,
        box,
        file: path.relative(workspace, file),
        sha256: sha256(file),
      });
    }

    for (const backplate of pageConfig.backplates ?? []) {
      const backplateKey = safeKey(backplate.key, 'backplate.key');
      const selectors = backplate.hideSelectors ?? [];
      if (selectors.length === 0) throw new Error(`Backplate ${backplateKey} requires hideSelectors.`);
      await page.evaluate((items) => {
        for (const selector of items) {
          for (const node of document.querySelectorAll(selector)) {
            node.dataset.cinematicPreviousVisibility = node.style.visibility;
            node.style.visibility = 'hidden';
          }
        }
      }, selectors);
      const file = path.join(pageDir, `${backplateKey}.png`);
      await page.screenshot({path: file, fullPage: true, mask: masks});
      await page.evaluate((items) => {
        for (const selector of items) {
          for (const node of document.querySelectorAll(selector)) {
            node.style.visibility = node.dataset.cinematicPreviousVisibility ?? '';
            delete node.dataset.cinematicPreviousVisibility;
          }
        }
      }, selectors);
      pageRecord.backplates.push({
        key: backplateKey,
        hiddenSelectors: selectors,
        file: path.relative(workspace, file),
        sha256: sha256(file),
      });
    }

    manifest.pages.push(pageRecord);
  }
} finally {
  await browser.close();
}

const layoutPath = path.join(outputRoot, 'layout.json');
writeFileSync(layoutPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Captured ${manifest.pages.length} page(s): ${layoutPath}`);
