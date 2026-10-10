/**
 * A streaming reply only ever grows. Text the reader has already seen does not
 * move up under them while later tokens arrive or when the reply completes.
 *
 * Requires VITE_PIWIN_E2E_FIXTURES=true (see artifact-rendering.spec.ts).
 */
import { expect, test, type Page } from '@playwright/test';

type HeightDrop = { from: number; to: number; progress: string };

/** One line of text; anything larger is a block collapsing or reflowing. */
const MAX_HEIGHT_DROP_PX = 4;

async function installHeightProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const drops: HeightDrop[] = [];
    (window as unknown as { __replyHeightDrops: HeightDrop[] }).__replyHeightDrops = drops;
    let last = 0;
    const tick = (): void => {
      const root = document.querySelector('[data-testid="markdown-stream-body"] .prose.markdown');
      if (root) {
        const height = root.getBoundingClientRect().height;
        if (height < last - 0.5) {
          drops.push({
            from: Math.round(last),
            to: Math.round(height),
            progress:
              document.querySelector('[data-testid="markdown-stream-progress"]')?.textContent ?? '',
          });
        }
        last = height;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function replay(page: Page, source?: string): Promise<void> {
  await installHeightProbe(page);
  if (source !== undefined) {
    await page.addInitScript((value) => {
      (window as unknown as { __piwinE2eMarkdownSource?: string }).__piwinE2eMarkdownSource = value;
    }, source);
  }
  await page.setViewportSize({ width: 900, height: 1000 });
  await page.goto('/#/e2e/artifacts?id=markdown-stream&tps=120&chunk=8');
  await expect(page.getByTestId('markdown-stream-progress')).toHaveAttribute('data-done', 'true', {
    timeout: 60_000,
  });
  // Completion effects (highlighting, diagrams) settle after the last token.
  await page.waitForTimeout(1_500);
}

async function heightDrops(page: Page): Promise<HeightDrop[]> {
  const drops = await page.evaluate(
    () => (window as unknown as { __replyHeightDrops: HeightDrop[] }).__replyHeightDrops,
  );
  return drops.filter((drop) => drop.from - drop.to > MAX_HEIGHT_DROP_PX);
}

test.describe('streaming reply stability', () => {
  test('a reply with a wide table, a long code block and a list tail never shrinks', async ({
    page,
  }) => {
    await replay(page);
    expect(await heightDrops(page)).toEqual([]);
  });

  test('a code block written live stays open when the reply completes', async ({ page }) => {
    await replay(page);
    const block = page.getByTestId('markdown-stream-body').locator('.md-code-block');
    await expect(block.locator('.collapsible-content-block')).toHaveClass(/is-expanded/);
    await expect(block.locator('.md-code-line')).toHaveCount(24);
  });

  test('a wide table keeps tokens whole and scrolls sideways instead of crushing columns', async ({
    page,
  }) => {
    await replay(page);
    const metrics = await page.evaluate(() => {
      const wrapper = document.querySelector('.md-table-wrapper');
      const table = wrapper?.querySelector('table');
      const pathCell = table?.rows[1]?.cells[1];
      return {
        scrolls: (wrapper?.scrollWidth ?? 0) > (wrapper?.clientWidth ?? 0),
        pathColumnWidth: Math.round(pathCell?.getBoundingClientRect().width ?? 0),
        rowHeight: Math.round(table?.rows[1]?.getBoundingClientRect().height ?? 0),
      };
    });
    expect(metrics.scrolls).toBe(true);
    // A crushed column was ~80px and its rows ran past 200px.
    expect(metrics.pathColumnWidth).toBeGreaterThan(150);
    expect(metrics.rowHeight).toBeLessThan(140);
  });

  test('the caret trails the last text instead of taking a line under a list', async ({ page }) => {
    const source = 'Intro paragraph.\n\n- first item\n- second item';
    await page.addInitScript((value) => {
      (window as unknown as { __piwinE2eMarkdownSource?: string }).__piwinE2eMarkdownSource = value;
    }, source);
    await page.setViewportSize({ width: 900, height: 1000 });
    // Held one character short of the end, so the reply is still streaming.
    await page.goto(`/#/e2e/artifacts?id=markdown-stream&chunk=0&from=${source.length - 1}`);
    const anchor = page.locator('[data-stream-caret]');
    await expect(anchor).toHaveCount(1);
    await expect(anchor).toHaveText('second ite');
    const slack = await page.evaluate(() => {
      const list = document.querySelector('[data-testid="markdown-stream-body"] ul');
      const lastItem = list?.lastElementChild;
      if (!list || !lastItem) return Number.NaN;
      return list.getBoundingClientRect().bottom - lastItem.getBoundingClientRect().bottom;
    });
    // No caret line below the last item.
    expect(slack).toBeLessThan(4);
  });

  test('an inline Artifact keeps its height when the stream hands over to the static renderer', async ({
    page,
  }) => {
    const source = [
      'Summary card:',
      '',
      '```artifact-html title="Summary"',
      '<style>',
      '.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}',
      // A literal color: the gallery passes no theme to the static renderer.
      '.card{border:1px solid gray;border-radius:10px;padding:16px}',
      '</style>',
      '<div class="grid">',
      ...Array.from(
        { length: 6 },
        (_unused, index) =>
          `<div class="card"><h3>Item ${index + 1}</h3><p>${'Detail text. '.repeat(8)}</p></div>`,
      ),
      '</div>',
      '```',
      '',
      'Text after the card.',
    ].join('\n');
    await replay(page, source);
    // No script, so the finished card is static markup in the transcript.
    await expect(page.getByTestId('artifact-static')).toBeVisible();
    expect(await heightDrops(page)).toEqual([]);
  });

  test('an inline Report Kit document keeps its styling in the static renderer', async ({ page }) => {
    const source = [
      'Report:',
      '',
      '```artifact-html title="Kit"',
      '<main class="piwin-report">',
      '<h1>Inline report</h1>',
      '<p class="piwin-meta">scope</p>',
      '<div class="piwin-grid"><div class="piwin-stat"><span>Files</span><strong>4</strong></div></div>',
      '</main>',
      '```',
      '',
      'After.',
    ].join('\n');
    await replay(page, source);
    const styles = await page.getByTestId('artifact-static').evaluate((host) => {
      const main = host.shadowRoot?.querySelector('main.piwin-report');
      const stat = host.shadowRoot?.querySelector('.piwin-stat');
      return {
        padding: main ? getComputedStyle(main).padding : null,
        statRadius: stat ? getComputedStyle(stat).borderTopLeftRadius : null,
      };
    });
    // The Inline measure, not the Canvas page gutter; kit components styled.
    expect(styles.padding).toBe('2px 0px 6px');
    expect(styles.statRadius).toBe('12px');
    expect(await heightDrops(page)).toEqual([]);
  });

  test('a diagram is drawn at its own size, not stretched to the column', async ({ page }) => {
    const source = [
      'Flow:',
      '',
      '```mermaid',
      'flowchart TD',
      '  A[Send] --> B{Online}',
      '  B -- yes --> C[Compile]',
      '  B -- no --> D[Reconnect]',
      '  C --> E[Done]',
      '```',
      '',
      'After the diagram.',
    ].join('\n');
    await replay(page, source);
    const diagram = page.getByTestId('mermaid-diagram');
    await expect(diagram).toBeVisible({ timeout: 15_000 });
    const sizes = await diagram.evaluate((element) => {
      const svg = element.querySelector('svg');
      const viewBox = svg?.getAttribute('viewBox')?.split(/[\s,]+/).map(Number) ?? [];
      return {
        rendered: Math.round(svg?.getBoundingClientRect().width ?? 0),
        natural: Math.ceil(viewBox[2] ?? 0),
        column: Math.round(element.getBoundingClientRect().width),
      };
    });
    expect(sizes.natural).toBeGreaterThan(0);
    expect(sizes.natural).toBeLessThan(sizes.column);
    expect(Math.abs(sizes.rendered - sizes.natural)).toBeLessThanOrEqual(1);
    // The source block is replaced by the drawing in one step, never by a
    // shorter placeholder in between.
    expect(await heightDrops(page)).toEqual([]);
  });
});
