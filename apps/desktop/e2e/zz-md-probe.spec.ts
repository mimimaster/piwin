import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { test } from '@playwright/test';

const DIR = process.env.MD_DIR ?? '';
const OUT = process.env.MD_OUT ?? '/tmp/md-probe';
const ONLY = process.env.MD_ONLY ?? '';
const TPS = process.env.MD_TPS ?? '80';
const CHUNK = process.env.MD_CHUNK ?? '8';

test('markdown stream probe', async ({ browser }) => {
  test.setTimeout(900_000);
  mkdirSync(OUT, { recursive: true });
  const files = readdirSync(DIR).filter((name) => name.endsWith('.md') && name.includes(ONLY)).sort();
  const summary: Record<string, unknown> = {};
  for (const name of files) {
    const context = await browser.newContext({ viewport: { width: 900, height: 1000 }, colorScheme: 'dark' });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message.slice(0, 200)));
    page.on('console', (message) => { if (message.type() === 'error' || message.type() === 'warning') errors.push(`[${message.type()}] ${message.text().slice(0, 200)}`); });
    const source = readFileSync(`${DIR}/${name}`, 'utf8');
    await page.addInitScript((value) => {
      (window as unknown as { __piwinE2eMarkdownSource?: string }).__piwinE2eMarkdownSource = value;
      const probe = {
        removed: [] as Array<{ t: number; tag: string; cls: string; fromEnd: number; text: string; chars: string }>,
        shrink: [] as Array<{ t: number; from: number; to: number; chars: string }>,
        shifts: [] as Array<{ t: number; tag: string; delta: number; chars: string; text: string }>,
        samples: 0,
        longTasks: [] as number[],
        start: 0,
      };
      (window as unknown as { __mdProbe: typeof probe }).__mdProbe = probe;
      const progress = (): string => document.querySelector('[data-testid="markdown-stream-progress"]')?.textContent?.split(' ')[0] ?? '';
      const install = (): void => {
        const body = document.querySelector('[data-testid="markdown-stream-body"]');
        if (!body) { requestAnimationFrame(install); return; }
        probe.start = performance.now();
        try {
          new PerformanceObserver((list) => { for (const entry of list.getEntries()) probe.longTasks.push(Math.round(entry.duration)); }).observe({ entryTypes: ['longtask'] });
        } catch { /* unsupported */ }
        const blockIndexFromEnd = (node: Node): number => {
          const root = body.querySelector('.prose.markdown');
          if (!root) return -1;
          const blocks = Array.from(root.children);
          for (let index = 0; index < blocks.length; index += 1) {
            if (blocks[index] === node || blocks[index]!.contains(node)) return blocks.length - 1 - index;
          }
          return -1;
        };
        new MutationObserver((records) => {
          for (const record of records) {
            const fromEnd = blockIndexFromEnd(record.target);
            record.removedNodes.forEach((node) => {
              if (!(node instanceof HTMLElement)) return;
              probe.removed.push({ t: Math.round(performance.now() - probe.start), tag: node.tagName, cls: String(node.className).slice(0, 50), fromEnd, text: (node.textContent ?? '').slice(0, 40), chars: progress() });
            });
          }
        }).observe(body, { childList: true, subtree: true });
        let lastHeight = 0;
        const tops = new WeakMap<Element, number>();
        const tick = (): void => {
          probe.samples += 1;
          const root = body.querySelector('.prose.markdown');
          if (root) {
            const height = root.getBoundingClientRect().height;
            if (height < lastHeight - 0.5) probe.shrink.push({ t: Math.round(performance.now() - probe.start), from: Math.round(lastHeight), to: Math.round(height), chars: progress() });
            lastHeight = height;
            const rootTop = root.getBoundingClientRect().top;
            const blocks = Array.from(root.children);
            // Everything but the last two blocks is settled text: it must not move.
            for (const block of blocks.slice(0, -2)) {
              const elements = [block, ...Array.from(block.querySelectorAll(':scope > *, :scope > * > *'))];
              for (const element of elements) {
                const top = element.getBoundingClientRect().top - rootTop;
                const previous = tops.get(element);
                if (previous !== undefined && Math.abs(previous - top) > 1) {
                  probe.shifts.push({ t: Math.round(performance.now() - probe.start), tag: element.tagName, delta: Math.round(top - previous), chars: progress(), text: (element.textContent ?? '').slice(0, 30) });
                }
                tops.set(element, top);
              }
            }
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      };
      document.addEventListener('DOMContentLoaded', install);
    }, source);
    await page.goto(`/#/e2e/artifacts?id=markdown-stream&tps=${TPS}&chunk=${CHUNK}`);
    await page.waitForSelector('[data-testid="markdown-stream-progress"][data-done="true"]', { timeout: 600_000 });
    await page.waitForTimeout(1500);
    const result = await page.evaluate(() => (window as unknown as { __mdProbe: unknown }).__mdProbe);
    writeFileSync(`${OUT}/${name}.json`, JSON.stringify({ errors, result }, null, 1));
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
    summary[name] = errors.length;
    await context.close();
  }
  console.log(JSON.stringify(summary));
});
