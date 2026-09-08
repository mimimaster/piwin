import { chromium } from '/Users/yorickjue/Developer/piwin/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';

const BASE = 'http://localhost:1420';
const OUT = '/Volumes/BigDisk/Projects/Projects/piwin/docs/design/inkstone-v3/shots';
mkdirSync(OUT, { recursive: true });

const shot = async (page, name) => {
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('shot:', name);
};

const run = async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);

  const connectBtn = page.getByRole('button', { name: '连接', exact: true }).first();
  if (await connectBtn.count()) { try { await connectBtn.click({ timeout: 3000 }); } catch (e) { console.log('connect skip'); } }
  await page.waitForTimeout(1800);

  const themeId = () => page.evaluate(() => document.documentElement.getAttribute('data-theme-id'));
  console.log('theme after connect:', await themeId());

  const setFace = async (label) => {
    const btn = page.locator('button').filter({ hasText: new RegExp('^' + label + '$') }).first();
    if (await btn.count()) { try { await btn.click({ timeout: 2500 }); } catch (e) { console.log('face click fail', label); } }
    await page.waitForTimeout(500);
  };

  await setFace('纸');
  console.log('theme after paper:', await themeId());
  await shot(page, '01-home-paper');

  const row = page.locator('.empty-stage-landing-row, [data-testid="empty-stage-landing-row"]').first();
  if (await row.count()) { try { await row.click({ timeout: 3000 }); } catch (e) { console.log('row click fail'); } }
  await page.waitForTimeout(1500);
  await shot(page, '02-transcript-paper');

  const side = page.locator('[aria-label="展开左边栏"]').first();
  if (await side.count()) { try { await side.click({ timeout: 2500 }); } catch (e) {} }
  await shot(page, '03-sidebar-paper');

  await setFace('墨');
  console.log('theme after ink:', await themeId());
  await shot(page, '04-transcript-ink');
  await shot(page, '05-sidebar-ink');

  await browser.close();
  console.log('DONE');
};
run().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
