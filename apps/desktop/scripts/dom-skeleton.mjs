/**
 * Dump the shell's class/testid skeleton from a live mock session.
 * Used while rewriting region CSS so selectors match what actually renders.
 *
 *   node scripts/dom-skeleton.mjs [maxDepth]
 */
import { chromium } from '@playwright/test';

const maxDepth = Number(process.argv[2] ?? 6);
const baseURL = process.env.SHOT_BASE_URL ?? 'http://127.0.0.1:1466';
const PROJECT_PATH = '/Users/yorickjue/Developer/piwin';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1560, height: 940 }, colorScheme: 'dark' });
await page.addInitScript(() => {
  localStorage.setItem('piwin.desktop.host-launch-mode', 'sidecar');
});
await page.goto(baseURL);
await page.getByTestId('app-shell').waitFor({ state: 'visible', timeout: 30_000 });

await page.getByTestId('open-workspace-btn').click();
await page.getByRole('menuitem', { name: /打开工作区文件夹|open workspace folder/i }).click();
await page.getByTestId('project-path-input').fill(PROJECT_PATH);
await page.getByTestId('open-project-btn').click();
await page.getByTestId('composer-input').waitFor({ state: 'visible' });
await page.getByTestId('composer-input').fill('hello');
await page.getByTestId('send-btn').click();
await page
  .locator('[data-testid="message-bubble"][data-role="assistant"]')
  .first()
  .waitFor({ state: 'visible', timeout: 30_000 });

const tree = await page.evaluate((depth) => {
  const describe = (el) => {
    const cls = el.className && typeof el.className === 'string' ? el.className.trim() : '';
    const tid = el.getAttribute('data-testid');
    const parts = [el.tagName.toLowerCase()];
    if (cls) parts.push(`.${cls.split(/\s+/).join('.')}`);
    if (tid) parts.push(`[${tid}]`);
    return parts.join(' ');
  };
  const walk = (el, level, out) => {
    if (level > depth) return out;
    out.push(`${'  '.repeat(level)}${describe(el)}`);
    for (const child of Array.from(el.children)) {
      if (child.tagName === 'SCRIPT' || child.tagName === 'STYLE') continue;
      walk(child, level + 1, out);
    }
    return out;
  };
  const shell = document.querySelector('[data-testid="app-shell"]');
  return walk(shell ?? document.body, 0, []).join('\n');
}, maxDepth);

console.log(tree);
await browser.close();
