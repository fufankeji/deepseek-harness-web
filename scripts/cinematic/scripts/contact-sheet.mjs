#!/usr/bin/env node
import {spawnSync} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const value = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
};

if (args.includes('--help') || !value('--input')) {
  console.log('Usage: node scripts/contact-sheet.mjs --input <video.mp4> [--output <sheet.png>] [--interval 2] [--cols 4] [--rows 3]');
  process.exit(args.includes('--help') ? 0 : 2);
}

const input = path.resolve(value('--input'));
const output = path.resolve(value('--output', 'out/qa/contact-sheet.png'));
const interval = Number(value('--interval', '2'));
const cols = Number(value('--cols', '4'));
const rows = Number(value('--rows', '3'));

if (![interval, cols, rows].every(Number.isFinite) || interval <= 0 || cols < 1 || rows < 1) {
  throw new Error('interval, cols and rows must be positive numbers');
}

mkdirSync(path.dirname(output), {recursive: true});
const filter = `fps=1/${interval},scale=480:-2:flags=lanczos,tile=${Math.floor(cols)}x${Math.floor(rows)}:padding=8:margin=8:color=black`;
const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-vf', filter, '-frames:v', '1', output], {
  stdio: 'inherit',
});

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`Contact sheet: ${output}`);
