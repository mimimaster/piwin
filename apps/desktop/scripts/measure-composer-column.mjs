#!/usr/bin/env node
import { chromium } from '@playwright/test';

const html = `<!doctype html>
<style>
  :root {
    --conversation-width: 720px;
    --chat-inline-pad: 28px;
    --gut: 160px;
  }
  body { margin: 0; }
  .stage {
    width: 1800px;
    display: flex;
    flex-direction: column;
    align-items: stretch;
  }
  .stream { padding: 0 var(--chat-inline-pad); }
  .turn {
    display: grid;
    grid-template-columns: minmax(0, var(--gut)) minmax(0, var(--conversation-width)) minmax(0, var(--gut));
    width: 100%;
    max-width: calc(var(--gut) * 2 + var(--conversation-width));
    margin: 0 auto;
  }
  .thinking { grid-column: 2; height: 20px; }
  .composer-dock {
    align-self: center;
    min-width: 0;
    width: min(var(--conversation-width), calc(100% - 2 * var(--chat-inline-pad)));
    max-width: var(--conversation-width);
    margin-inline: auto;
  }
  .slab { width: 100%; height: 20px; }
</style>
<div class="stage">
  <div class="stream"><div class="turn"><div class="thinking"></div></div></div>
  <div class="composer-dock"><div class="slab"></div></div>
</div>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1900, height: 900 } });
await page.setContent(html);
const widths = await page.evaluate(() => {
  const thinking = document.querySelector('.thinking');
  const slab = document.querySelector('.slab');
  if (!thinking || !slab) throw new Error('missing');
  const a = thinking.getBoundingClientRect();
  const b = slab.getBoundingClientRect();
  return { thinkW: a.width, thinkX: a.x, slabW: b.width, slabX: b.x };
});
await browser.close();
const dx = Math.abs(widths.thinkX - widths.slabX);
const dw = Math.abs(widths.thinkW - widths.slabW);
console.log(JSON.stringify({ ...widths, dx, dw }));
if (dw > 1 || dx > 1) {
  console.error('composer does not match thinking column');
  process.exit(1);
}
