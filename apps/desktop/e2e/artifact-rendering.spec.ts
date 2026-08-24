/**
 * Requires Vite compiled with VITE_PIWIN_E2E_FIXTURES=true (playwright.config
 * webServer). A leftover `pnpm dev` on the default port without that flag will
 * hide `#/e2e/artifacts`; use PIWIN_E2E_PORT to start a dedicated server.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { MAX_ARTIFACT_INLINE_FLOW_HEIGHT } from '@piwin/artifact';
import { ARTIFACT_TRAILING_MARKDOWN } from '@piwin/artifact/fixtures';

const GALLERY = '/#/e2e/artifacts';
const MAX_TRAILING_GAP_PX = 120;
const INLINE_FLOW_CAP_PX = `${String(MAX_ARTIFACT_INLINE_FLOW_HEIGHT)}px`;

async function openFixture(page: Page, id: string): Promise<Locator> {
  await page.setViewportSize({ width: 1280, height: 840 });
  await page.goto(`${GALLERY}?id=${id}`);
  await expect(page.getByTestId('artifact-gallery')).toBeVisible();
  const section = page.locator(`[data-testid="artifact-gallery-case"][data-fixture-id="${id}"]`);
  await expect(section).toBeVisible();
  return section;
}

function iframeCss(fixtureId: string, canvas: boolean): string {
  const section = `[data-testid="artifact-gallery-case"][data-fixture-id="${fixtureId}"]`;
  return canvas
    ? `${section} [data-testid="artifact-gallery-canvas-stage"] iframe.artifact-iframe`
    : `${section} iframe.artifact-iframe`;
}

async function waitForSandboxFrame(section: Locator): Promise<Locator> {
  const frame = section.getByTestId('artifact-frame');
  await expect(frame).toBeVisible();
  await expect(frame).toHaveAttribute('data-artifact-renderer', 'sandbox');
  await expect(frame).toHaveAttribute('data-artifact-height-status', 'ready', { timeout: 15_000 });
  const iframe = section.locator('iframe.artifact-iframe');
  await expect(iframe).toBeVisible();
  return iframe;
}

async function trailingGapPx(section: Locator, artifact: Locator): Promise<number> {
  const after = section.getByText(ARTIFACT_TRAILING_MARKDOWN, { exact: true });
  await after.scrollIntoViewIfNeeded();
  await expect(after).toBeVisible();
  const artifactBox = await artifact.boundingBox();
  const afterBox = await after.boundingBox();
  if (!artifactBox || !afterBox) {
    throw new Error('missing bounding boxes for trailing Markdown');
  }
  return afterBox.y - (artifactBox.y + artifactBox.height);
}

async function userScrollIframeToBottom(
  page: Page,
  css: string,
): Promise<{ overflowY: string; scrollTop: number }> {
  return page.frameLocator(css).locator(':root').evaluate(() => {
    const scrolling = document.scrollingElement ?? document.documentElement;
    scrolling.scrollTop = scrolling.scrollHeight;
    return {
      overflowY: getComputedStyle(scrolling).overflowY,
      scrollTop: scrolling.scrollTop,
    };
  });
}

async function markerIntersectsIframeViewport(
  page: Page,
  css: string,
  endSelector: string,
): Promise<boolean> {
  const iframeBox = await page.locator(css).boundingBox();
  if (!iframeBox || iframeBox.width < 1 || iframeBox.height < 1) return false;
  const markerBox = await page.frameLocator(css).locator(endSelector).boundingBox();
  if (!markerBox) return false;
  const overlapY =
    Math.min(iframeBox.y + iframeBox.height, markerBox.y + markerBox.height) -
    Math.max(iframeBox.y, markerBox.y);
  const overlapX =
    Math.min(iframeBox.x + iframeBox.width, markerBox.x + markerBox.width) -
    Math.max(iframeBox.x, markerBox.x);
  return overlapY > 1 && overlapX > 1;
}

async function openGalleryCanvasStage(section: Locator): Promise<Locator> {
  await section.getByTestId('artifact-preview-toggle').click();
  const stage = section.getByTestId('artifact-gallery-canvas-stage');
  await expect(stage).toBeVisible();
  await expect(stage.getByTestId('artifact-frame')).toHaveAttribute('data-artifact-layout', 'canvas');
  await expect(stage.locator('iframe.artifact-iframe')).toBeVisible({ timeout: 15_000 });
  return stage;
}

test('artifact gallery mounts behind the e2e fixture gate', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 840 });
  await page.goto(GALLERY);
  await expect(page.getByTestId('artifact-gallery')).toBeVisible();
  await expect(page.getByTestId('artifact-gallery-case')).toHaveCount(13);
});

test('script fragment mounts a sandboxed iframe without allow-same-origin', async ({ page }) => {
  const section = await openFixture(page, 'script-fragment');
  const iframe = await waitForSandboxFrame(section);
  await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts');
  const after = section.getByText(ARTIFACT_TRAILING_MARKDOWN, { exact: true });
  await after.scrollIntoViewIfNeeded();
  await expect(after).toBeVisible();
});

test('inert fragment uses static flow and keeps trailing Markdown visible', async ({ page }) => {
  const section = await openFixture(page, 'inert-fragment');
  await expect(section.getByTestId('artifact-static')).toBeVisible();
  await expect(section.locator('iframe.artifact-iframe')).toHaveCount(0);
  const end = section.locator('[data-artifact-end="inert-fragment"]');
  await end.scrollIntoViewIfNeeded();
  await expect(end).toBeVisible();
  const gap = await trailingGapPx(section, section.getByTestId('artifact-frame'));
  expect(gap).toBeGreaterThanOrEqual(0);
  expect(gap).toBeLessThan(MAX_TRAILING_GAP_PX);
});

test('6,000px flow: iframe last marker is reachable and trailing Markdown is continuous', async ({
  page,
}) => {
  const section = await openFixture(page, 'flow-6000');
  await waitForSandboxFrame(section);
  const css = iframeCss('flow-6000', false);
  await page.locator(css).evaluate((node) => {
    node.scrollIntoView({ block: 'end' });
  });
  expect(await markerIntersectsIframeViewport(page, css, '[data-artifact-end="flow-6000"]')).toBe(
    true,
  );
  const gap = await trailingGapPx(section, section.getByTestId('artifact-frame'));
  expect(gap).toBeGreaterThanOrEqual(0);
  expect(gap).toBeLessThan(MAX_TRAILING_GAP_PX);
});

test('20,000px overflow clamps the Inline stage at 16384px with overflow hidden', async ({
  page,
}) => {
  const section = await openFixture(page, 'overflow-20000');
  await waitForSandboxFrame(section);
  const stage = section.locator('.artifact-iframe-stage');
  await expect(stage).toHaveCSS('overflow', 'hidden');
  await expect(stage).toHaveCSS('height', INLINE_FLOW_CAP_PX);
  await expect(stage).toHaveCSS('max-height', INLINE_FLOW_CAP_PX);
  const gap = await trailingGapPx(section, section.getByTestId('artifact-frame'));
  expect(gap).toBeGreaterThanOrEqual(0);
  expect(gap).toBeLessThan(MAX_TRAILING_GAP_PX);
});

test.fail(
  '20,000px overflow: end marker intersects the iframe viewport after a user-like scroll',
  async ({ page }) => {
    const section = await openFixture(page, 'overflow-20000');
    await waitForSandboxFrame(section);
    const css = iframeCss('overflow-20000', false);
    const scroll = await userScrollIframeToBottom(page, css);
    expect(scroll.overflowY).toBe('auto');
    expect(
      await markerIntersectsIframeViewport(page, css, '[data-artifact-end="overflow-20000"]'),
    ).toBe(true);
  },
);

test('full HTML document stays source-first with trailing Markdown visible', async ({ page }) => {
  const section = await openFixture(page, 'full-html-document');
  await expect(section.getByTestId('code-fence-source')).toBeVisible();
  await expect(section.locator('iframe.artifact-iframe')).toHaveCount(0);
  await expect(section.getByTestId('artifact-preview-toggle')).toContainText('Preview in Canvas');
  const after = section.getByText(ARTIFACT_TRAILING_MARKDOWN, { exact: true });
  await after.scrollIntoViewIfNeeded();
  await expect(after).toBeVisible();
});

test(
  'full HTML document Canvas stage: end marker intersects the iframe viewport after a user-like scroll',
  async ({ page }) => {
    const section = await openFixture(page, 'full-html-document');
    await openGalleryCanvasStage(section);
    const css = iframeCss('full-html-document', true);
    const scroll = await userScrollIframeToBottom(page, css);
    expect(scroll.overflowY).toBe('auto');
    expect(
      await markerIntersectsIframeViewport(page, css, '[data-artifact-end="full-html-document"]'),
    ).toBe(true);
  },
);

test('viewport-100vh stays source-first instead of inventing an Inline iframe', async ({
  page,
}) => {
  const section = await openFixture(page, 'viewport-100vh');
  await expect(section.getByTestId('code-fence-source')).toBeVisible();
  await expect(section.locator('iframe.artifact-iframe')).toHaveCount(0);
  const after = section.getByText(ARTIFACT_TRAILING_MARKDOWN, { exact: true });
  await after.scrollIntoViewIfNeeded();
  await expect(after).toBeVisible();
});

test(
  'viewport-100vh Canvas stage: end marker intersects the iframe viewport after a user-like scroll',
  async ({ page }) => {
    const section = await openFixture(page, 'viewport-100vh');
    await openGalleryCanvasStage(section);
    const css = iframeCss('viewport-100vh', true);
    const scroll = await userScrollIframeToBottom(page, css);
    expect(scroll.overflowY).toBe('auto');
    expect(
      await markerIntersectsIframeViewport(page, css, '[data-artifact-end="viewport-100vh"]'),
    ).toBe(true);
  },
);

test('explicit Canvas hosts a canvas-sized stage whose last marker is reachable', async ({
  page,
}) => {
  const section = await openFixture(page, 'explicit-canvas');
  const stage = section.getByTestId('artifact-gallery-canvas-stage');
  await expect(stage).toBeVisible();
  await expect(stage.getByTestId('artifact-frame')).toHaveAttribute('data-artifact-layout', 'canvas');
  const css = iframeCss('explicit-canvas', true);
  await expect(page.locator(css)).toBeVisible({ timeout: 15_000 });
  await userScrollIframeToBottom(page, css);
  expect(
    await markerIntersectsIframeViewport(page, css, '[data-artifact-end="explicit-canvas"]'),
  ).toBe(true);
});

test('streaming gallery records a stable channel across deltas', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 840 });
  await page.goto(`${GALLERY}?id=streaming`);
  const section = page.locator('[data-testid="artifact-gallery-case"][data-fixture-id="streaming"]');
  await expect(section).toBeVisible();
  const live = section.getByTestId('artifact-stream-live');
  await expect(live).toBeVisible();
  const firstId = await live.getAttribute('data-artifact-id');
  await section.getByTestId('artifact-gallery-stream-next').click();
  await expect(section.getByTestId('artifact-stream-live')).toHaveAttribute(
    'data-artifact-id',
    firstId ?? '',
  );
  await section.getByTestId('artifact-gallery-stream-next').click();
  await expect(section.getByText(ARTIFACT_TRAILING_MARKDOWN, { exact: true })).toBeVisible();
});
