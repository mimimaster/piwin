// Renders the promo to MP4 (or a few stills) by stepping the page clock frame by frame.
//   node docs/marketing/promo/export.mjs --stills 2.4,19,25        → PNG stills
//   node docs/marketing/promo/export.mjs --out piwin-promo.mp4       → full film with soundtrack
// Needs: python3 http server on :8802 serving the repo root, system Chrome, ffmpeg.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(path.resolve('node_modules/.pnpm/playwright-core@1.61.1/node_modules/playwright-core/package.json'));
const { chromium } = require('playwright-core');

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const URL = opt('url', 'http://127.0.0.1:8802/docs/marketing/promo/index.html?export');
const FPS = Number(opt('fps', '30'));
const outDir = opt('dir', 'dist/promo');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => window.__promo.ready());
await page.waitForTimeout(500);

const stills = opt('stills');
if (stills) {
  for (const t of stills.split(',').map(Number)) {
    await page.evaluate((time) => window.__promo.frame(time), t);
    await page.screenshot({ path: path.join(outDir, `still-${t.toFixed(2)}.png`) });
  }
  await browser.close();
  process.exit(0);
}

const wavPath = path.join(outDir, 'soundtrack.wav');
if (!args.includes('--no-audio')) {
  const wav = await page.evaluate(() => window.__promo.renderAudio(48000));
  writeFileSync(wavPath, Buffer.from(wav, 'base64'));
  console.log('audio →', wavPath);
}
if (args.includes('--audio-only')) {
  await browser.close();
  process.exit(0);
}

const duration = await page.evaluate(() => window.__promo.duration);
const out = opt('out', path.join(outDir, 'piwin-promo.mp4'));
const ffmpeg = spawn('ffmpeg', [
  '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
  '-i', wavPath,
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
  '-c:a', 'aac', '-b:a', '256k', '-shortest', out,
], { stdio: ['pipe', 'inherit', 'inherit'] });

const frames = Math.round(duration * FPS);
const started = Date.now();
for (let i = 0; i < frames; i += 1) {
  await page.evaluate((time) => window.__promo.frame(time), i / FPS);
  const jpeg = await page.screenshot({ type: 'jpeg', quality: 95 });
  if (!ffmpeg.stdin.write(jpeg)) await new Promise((resolve) => ffmpeg.stdin.once('drain', resolve));
  if (i % 150 === 0) console.log(`frame ${i}/${frames} · ${((Date.now() - started) / 1000).toFixed(0)}s`);
}
ffmpeg.stdin.end();
await new Promise((resolve) => ffmpeg.on('close', resolve));
await browser.close();
console.log('video →', out);
