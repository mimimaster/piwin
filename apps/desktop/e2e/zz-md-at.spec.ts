import { readFileSync, mkdirSync } from 'node:fs';
import { test } from '@playwright/test';
test('markdown at offsets', async ({ page }) => {
  test.setTimeout(300_000);
  const out = process.env.MD_OUT ?? '/tmp/x';
  mkdirSync(out, { recursive: true });
  const source = readFileSync(process.env.MD_FILE ?? '', 'utf8');
  const offsets = (process.env.MD_OFFSETS ?? '').split(',').map(Number);
  await page.addInitScript((value) => {
    (window as unknown as { __piwinE2eMarkdownSource?: string }).__piwinE2eMarkdownSource = value;
  }, source);
  await page.setViewportSize({ width: 900, height: 1000 });
  for (const offset of offsets) {
    await page.goto('about:blank');
    await page.goto(`/#/e2e/artifacts?id=markdown-stream&chunk=0&from=${offset}`);
    await page.waitForSelector('.prose.markdown');
    await page.waitForTimeout(700);
    const info = await page.evaluate(() => {
      const root = document.querySelector('.prose.markdown')!;
      const last = root.lastElementChild as HTMLElement | null;
      const tables = Array.from(root.querySelectorAll('table'));
      const table = tables.at(-1);
      return {
        height: Math.round(root.getBoundingClientRect().height),
        blocks: root.children.length,
        lastTag: last?.firstElementChild?.tagName + '.' + last?.firstElementChild?.className,
        lastHeight: Math.round(last?.getBoundingClientRect().height ?? 0),
        tableRows: table?.rows.length,
        tableWidth: Math.round(table?.getBoundingClientRect().width ?? 0),
        tableScrollWidth: table?.parentElement?.scrollWidth,
        cols: table ? Array.from(table.rows[0]?.cells ?? []).map((cell) => Math.round(cell.getBoundingClientRect().width)) : [],
        lastRowCells: table ? Array.from(table.rows[table.rows.length - 1]?.cells ?? []).map((cell) => (cell.textContent ?? '').slice(0, 24)) : [],
        tail: (root.textContent ?? '').slice(-60),
      };
    });
    console.log(offset, JSON.stringify(info));
    if (process.env.MD_SHOT) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.screenshot({ path: `${out}/at-${offset}.png` });
    }
  }
});
