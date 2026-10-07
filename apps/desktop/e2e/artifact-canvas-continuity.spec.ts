/**
 * Canvas document continuity: a report paints while it is written, and the
 * swap from the stream shell to the final document keeps the reading position
 * without a blank frame.
 *
 * Requires VITE_PIWIN_E2E_FIXTURES=true (see artifact-rendering.spec.ts).
 */
import { expect, test, type Frame, type Page } from '@playwright/test';

const CURRENT_IFRAME = 'iframe.artifact-iframe:not(.artifact-iframe--outgoing)';

/** A document that brings its own stylesheet and its own scroll stage. */
const AUTHORED_DOCUMENT = [
  '<!doctype html>',
  '<html lang="en"><head><meta charset="utf-8" />',
  '<style>',
  '  html, body { margin: 0; height: 100%; }',
  '  .stage { width: 100%; height: 100%; overflow-y: auto; padding: 24px; box-sizing: border-box; }',
  '  .card { border: 1px solid var(--piwin-artifact-border); border-radius: 10px; padding: 16px; margin: 0 0 16px; }',
  '</style></head><body><div class="stage">',
  '<h1>Authored report</h1>',
  ...Array.from(
    { length: 24 },
    (_unused, index) =>
      `<section class="card"><h2>Finding ${index + 1}</h2><p>${'Evidence line. '.repeat(20)}</p></section>`,
  ),
  '</div></body></html>',
].join('\n');

function artifactFrames(page: Page): Frame[] {
  return page
    .frames()
    .filter((frame) => frame !== page.mainFrame() && frame.parentFrame() === page.mainFrame());
}

/** Offset and extent of whichever element the document scrolls in. */
async function readScroll(frame: Frame): Promise<{ top: number; range: number; nodes: number }> {
  return frame.evaluate(() => {
    const candidates = [document.body, ...Array.from(document.body.children)];
    let top = 0;
    let range = 0;
    for (const element of candidates) {
      top = Math.max(top, element.scrollTop);
      range = Math.max(range, element.scrollHeight - element.clientHeight);
    }
    return { top, range, nodes: document.querySelectorAll('body *').length };
  });
}

async function scrollPrimary(frame: Frame, top: number): Promise<void> {
  await frame.evaluate((target) => {
    const candidates = [document.body, ...Array.from(document.body.children)];
    let scroller: Element = document.body;
    for (const element of candidates) {
      if (
        element.scrollHeight - element.clientHeight >
        scroller.scrollHeight - scroller.clientHeight
      ) {
        scroller = element;
      }
    }
    scroller.scrollTop = target;
  }, top);
}

async function openCanvasStream(page: Page, source?: string): Promise<void> {
  if (source !== undefined) {
    await page.addInitScript((value) => {
      (window as unknown as { __piwinE2eCanvasSource?: string }).__piwinE2eCanvasSource = value;
    }, source);
  }
  await page.setViewportSize({ width: 1180, height: 900 });
  await page.goto('/#/e2e/artifacts?id=canvas-stream&tps=120&hold=1');
  await expect(page.getByTestId('artifact-gallery')).toBeVisible();
}

async function waitForStreamEnd(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        const label = (await page.getByTestId('canvas-stream-progress').textContent()) ?? '';
        const [current, total] = label.split(' ')[0]?.split('/') ?? [];
        return current !== undefined && current === total;
      },
      { timeout: 60_000 },
    )
    .toBe(true);
}

async function finishAndSettle(page: Page): Promise<Frame> {
  await page.getByTestId('canvas-stream-finish').click();
  await expect(page.locator('[data-testid="canvas-stream-progress"]')).toHaveAttribute(
    'data-done',
    'true',
  );
  await expect(page.getByTestId('artifact-frame')).toHaveAttribute(
    'data-artifact-lifecycle',
    'ready',
  );
  await expect(page.getByTestId('artifact-iframe-outgoing')).toHaveCount(0);
  await expect(page.locator(CURRENT_IFRAME)).toHaveCount(1);
  await expect.poll(() => artifactFrames(page).length).toBe(1);
  const frame = artifactFrames(page)[0];
  if (!frame) throw new Error('final artifact frame missing');
  return frame;
}

test.describe('Canvas document continuity', () => {
  test('a Report Kit document paints from its first words', async ({ page }) => {
    await openCanvasStream(page);
    // Well before the stream ends the reader already sees the title: there is
    // no author stylesheet to wait for.
    await expect
      .poll(async () => {
        const frame = artifactFrames(page).at(-1);
        if (!frame) return '';
        return frame.evaluate(() => document.querySelector('h1')?.textContent ?? '').catch(() => '');
      })
      .toBe('Canvas stream report');
    await expect(page.getByTestId('artifact-stream-preparing')).toHaveCount(0);
    const progress = (await page.getByTestId('canvas-stream-progress').textContent()) ?? '';
    const [current, total] = progress.split(' ')[0]?.split('/').map(Number) ?? [];
    expect(current ?? 0).toBeLessThan((total ?? 0) * 0.6);
  });

  test('completion keeps the reading position and the page geometry of a kit report', async ({
    page,
  }) => {
    await openCanvasStream(page);
    await waitForStreamEnd(page);
    const streamFrame = artifactFrames(page).at(-1);
    if (!streamFrame) throw new Error('stream artifact frame missing');
    const before = await readScroll(streamFrame);
    expect(before.range).toBeGreaterThan(400);
    const target = Math.round(before.range * 0.6);
    await scrollPrimary(streamFrame, target);
    // The frame reports its offset on a short delay before the host can carry it.
    await page.waitForTimeout(250);

    const finalFrame = await finishAndSettle(page);
    const after = await readScroll(finalFrame);
    expect(Math.abs(after.top - target)).toBeLessThanOrEqual(2);
    // Same document height: the stream shell and the final page lay out alike.
    expect(Math.abs(after.range - before.range)).toBeLessThanOrEqual(2);
  });

  test('completion restores the offset into a document that scrolls in its own stage', async ({
    page,
  }) => {
    await openCanvasStream(page, AUTHORED_DOCUMENT);
    await waitForStreamEnd(page);
    const streamFrame = artifactFrames(page).at(-1);
    if (!streamFrame) throw new Error('stream artifact frame missing');
    const before = await readScroll(streamFrame);
    expect(before.range).toBeGreaterThan(400);
    const target = Math.round(before.range * 0.5);
    await scrollPrimary(streamFrame, target);
    await page.waitForTimeout(250);

    const finalFrame = await finishAndSettle(page);
    // The stream shell scrolls in body; the final document scrolls in `.stage`.
    const stageTop = await finalFrame.evaluate(
      () => document.querySelector('.stage')?.scrollTop ?? -1,
    );
    expect(Math.abs(stageTop - target)).toBeLessThanOrEqual(24);
  });
});
