import { expect, test } from '@playwright/test';

const PARAGRAPH_MARKDOWN = 'Read `AGENTS.md` first, then **run** the checks and *report* back.';

test.beforeEach(async ({ page }) => {
  await page.goto('/#/e2e/artifacts?id=doc-selection');
  await expect(page.getByTestId('enhanced-markdown')).toBeVisible();
});

test('rendered Markdown can be selected and copies as Markdown source', async ({ page }) => {
  const article = page.getByTestId('enhanced-markdown');
  // The shell is unselectable by default; the document surface must opt back in.
  await expect(article).toHaveCSS('user-select', 'text');

  await article.locator('.enhanced-paragraph').first().click({ clickCount: 3 });
  await expect(page.getByTestId('transcript-selection-toolbar')).toBeVisible();

  await page.getByTestId('selection-toolbar-copy').click();
  const copied = await page.evaluate(() => window.__docSelectionGallery?.copied ?? []);
  expect(copied).toEqual([PARAGRAPH_MARKDOWN]);
});

test('a native copy carries Markdown, without line numbers or block chrome', async ({ page }) => {
  await page.evaluate(() => {
    const probe: { plain: string; prevented: boolean }[] = [];
    (window as unknown as { __copyProbe: typeof probe }).__copyProbe = probe;
    document.addEventListener('copy', (event) => {
      probe.push({
        plain: event.clipboardData?.getData('text/plain') ?? '',
        prevented: event.defaultPrevented,
      });
    });
  });
  const lines = page.locator('.enhanced-code-block .code-line-text');
  const first = await lines.nth(0).boundingBox();
  const second = await lines.nth(1).boundingBox();
  if (!first || !second) throw new Error('code lines are not laid out');
  await page.mouse.move(first.x + 1, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(second.x + second.width - 2, second.y + second.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.press('ControlOrMeta+C');

  const probe = await page.evaluate(
    () =>
      (window as unknown as { __copyProbe: { plain: string; prevented: boolean }[] }).__copyProbe,
  );
  expect(probe).toHaveLength(1);
  expect(probe[0]?.prevented).toBe(true);
  expect(probe[0]?.plain).toBe('pnpm typecheck\npnpm test');
});

test('a selection comment anchors to its block and lights it up', async ({ page }) => {
  const quote = page.locator('.enhanced-blockquote .enhanced-paragraph');
  await quote.click({ clickCount: 3 });
  await page.getByTestId('selection-toolbar-comment').click();
  await page.getByTestId('selection-toolbar-comment-input').fill('anchor check');
  await page.getByTestId('selection-toolbar-comment-submit').click();

  await expect(page.getByTestId('transcript-selection-toolbar')).toHaveCount(0);
  await expect(page.locator('.doc-comment-badge')).toContainText('1');
  await expect(
    page.locator('.enhanced-line-wrapper.has-comment[data-line-id^="paragraph-"]'),
  ).toHaveCount(1);
});

test('copy-block sits beside the comment button and copies that block', async ({ page }) => {
  const paragraph = page.locator('.enhanced-paragraph-row').first();
  await paragraph.hover();
  await paragraph.locator('> .line-copy-btn').click();
  const copied = await page.evaluate(() => window.__docSelectionGallery?.copied ?? []);
  expect(copied).toEqual([PARAGRAPH_MARKDOWN]);
});
