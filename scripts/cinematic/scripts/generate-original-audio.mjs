#!/usr/bin/env node

import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const audioDir = resolve(root, 'public/audio');
mkdirSync(audioDir, {recursive: true});

const duration = 102.1;
const score = resolve(audioDir, 'original-score.wav');
const sfx = resolve(audioDir, 'original-sfx.wav');

const run = (args) => {
  const result = spawnSync('ffmpeg', args, {stdio: 'inherit'});
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};

const lavfiExpression = (expression) => expression.replaceAll(',', '\\,');

// Slow cobalt pad with restrained one-second pulses. Every oscillator is
// deterministic and generated locally; no third-party samples are involved.
const pad = [
  '0.105*sin(2*PI*43.65*t)',
  '0.070*sin(2*PI*65.41*t+0.35)',
  '0.048*sin(2*PI*98.00*t+0.9)',
  '0.026*sin(2*PI*155.56*t+1.2)',
  '0.014*sin(2*PI*261.63*t+0.4)*pow(abs(sin(PI*t)),10)',
  '0.010*sin(2*PI*329.63*t+1.4)*pow(abs(sin(PI*t+0.35)),14)',
].join('+');
const scoreEnergy = '(0.78+0.13*sin(2*PI*t/31)+0.09*sin(2*PI*t/13)+0.10*pow(abs(sin(PI*t/42)),4))';

run([
  '-hide_banner', '-loglevel', 'error', '-y',
  '-f', 'lavfi', '-i', `aevalsrc=${lavfiExpression(`(${pad})*${scoreEnergy}`)}:s=48000:d=${duration}`,
  '-af', 'highpass=f=30,lowpass=f=1800,aecho=0.8:0.72:110|240:0.11|0.07,afade=t=in:st=0:d=2.2,afade=t=out:st=98.2:d=3.8,volume=1.35,alimiter=limit=0.72:level=false,pan=stereo|c0=c0|c1=c0',
  '-ar', '48000', '-c:a', 'pcm_s24le', score,
]);

const impactTimes = [5.0, 17.9, 26.5, 46.5, 56.5, 64.5, 74.0, 80.2, 88.0, 97.0];
const impacts = impactTimes.map((at, index) => {
  const weight = index === 2 || index === 6 || index === 9 ? 0.72 : 0.43;
  return `${weight}*between(t,${at},${at + 0.8})*exp(-6.2*max(0,t-${at}))*sin(2*PI*(48+34*(t-${at}))*(t-${at}))`;
}).join('+');
const sweeps = [17.9, 26.5, 46.5, 64.5, 74.0, 88.0, 97.0].map((at) => {
  const start = at - 0.62;
  return `0.16*between(t,${start},${at})*pow((t-${start})/0.62,2)*sin(2*PI*(180+620*(t-${start}))*(t-${start}))`;
}).join('+');
const ticks = [20.4, 21.15, 21.82, 31.2, 32.0, 32.74, 34.0, 35.0].map((at) => (
  `0.12*between(t,${at},${at + 0.16})*exp(-24*max(0,t-${at}))*sin(2*PI*940*(t-${at}))`
)).join('+');

run([
  '-hide_banner', '-loglevel', 'error', '-y',
  '-f', 'lavfi', '-i', `aevalsrc=${lavfiExpression(`${impacts}+${sweeps}+${ticks}`)}:s=48000:d=${duration}`,
  '-af', 'highpass=f=35,lowpass=f=2600,aecho=0.8:0.64:70|160:0.10|0.06,volume=0.78,alimiter=limit=0.82:level=false,pan=stereo|c0=c0|c1=c0',
  '-ar', '48000', '-c:a', 'pcm_s24le', sfx,
]);

console.log(`AUDIO_PASS ${score}`);
console.log(`AUDIO_PASS ${sfx}`);
