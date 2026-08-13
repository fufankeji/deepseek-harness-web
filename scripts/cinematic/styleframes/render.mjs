#!/usr/bin/env node
import {createRequire} from 'node:module';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..', '..', '..');
const require = createRequire(import.meta.url);
const {chromium} = require(path.join(projectRoot, 'frontend', 'node_modules', 'playwright'));
const outputRoot = path.resolve(projectRoot, 'artifacts', 'cinematic', 'preproduction', 'styleframes');
mkdirSync(outputRoot, {recursive: true});

const browser = await chromium.launch({headless: true});
const page = await browser.newPage({viewport: {width: 1920, height: 1080}, deviceScaleFactor: 1});
const frames = [
  ['opening', 'frame-opening.png'],
  ['execution', 'frame-execution.png'],
  ['proof', 'frame-proof.png'],
];

try {
  for (const [key, filename] of frames) {
    const url = `${pathToFileURL(path.join(here, 'index.html')).href}?frame=${key}`;
    await page.goto(url, {waitUntil: 'load'});
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({path: path.join(outputRoot, filename), animations: 'disabled'});
    console.log(`Rendered ${filename}`);
  }
} finally {
  await browser.close();
}
