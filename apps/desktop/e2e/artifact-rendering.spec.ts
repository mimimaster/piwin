/**
 * Requires Vite compiled with VITE_PIWIN_E2E_FIXTURES=true (playwright.config
 * webServer). A leftover `pnpm dev` on the default port without that flag will
 * hide `#/e2e/artifacts`; use PIWIN_E2E_PORT to start a dedicated server.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { ARTIFACT_TRAILING_MARKDOWN } from '@piwin/artifact/fixtures';

const GALLERY = '/#/e2e/artifacts';
const MAX_TRAILING_GAP_PX = 120;

async function openFixture(page: Page, id: string): Promise<Locator> {
  await page.setViewportSize({ width: 1280, height: 840 });
  await page.goto(`${GALLERY}?id=${id}`);
  await expect(page.getByTestId('artifact-gallery')).toBeVisible();
  const section = page.locator(`[data-testid="artifact-gallery-case"][data-fixture-id="${id}"]`);
  await expect(section).toBeVisible();
  return section;
}

async function waitForSandboxFrame(section: Locator): Promise<Locator> {
  const frame = section.getByTestId('artifact-frame');
  await expect(frame).toBeVisible();
  await expect(frame).toHaveAttribute('data-artifact-renderer', 'sandbox');
  const iframe = section.locator('iframe.artifact-iframe');
  await expect(iframe).toBeVisible({ timeout: 15_000 });
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
  const frame = page.frameLocator(
    '[data-testid="artifact-gallery-case"][data-fixture-id="flow-6000"] iframe.artifact-iframe',
  );
  const end = frame.locator('[data-artifact-end="flow-6000"]');
  await end.scrollIntoViewIfNeeded();
  await expect(end).toBeVisible();
  const gap = await trailingGapPx(section, section.getByTestId('artifact-frame'));
  expect(gap).toBeGreaterThanOrEqual(0);
  expect(gap).toBeLessThan(MAX_TRAILING_GAP_PX);
});

test('20,000px overflow: last marker is reachable inside the iframe', async ({ page }) => {
  const section = await openFixture(page, 'overflow-20000');
  await waitForSandboxFrame(section);
  const frame = page.frameLocator(
    '[data-testid="artifact-gallery-case"][data-fixture-id="overflow-20000"] iframe.artifact-iframe',
  );
  const end = frame.locator('[data-artifact-end="overflow-20000"]');
  await end.scrollIntoViewIfNeeded();
  await expect(end).toBeVisible();
  const gap = await trailingGapPx(section, section.getByTestId('artifact-frame'));
  expect(gap).toBeGreaterThanOrEqual(0);
  expect(gap).toBeLessThan(MAX_TRAILING_GAP_PX);
});

test('full HTML document stays source-first with trailing Markdown visible', async ({ page }) => {
  const section = await openFixture(page, 'full-html-document');
  await expect(section.getByTestId('code-fence-source')).toBeVisible();
  await expect(section.locator('iframe.artifact-iframe')).toHaveCount(0);
  await expect(section.getByTestId('artifact-preview-toggle')).toContainText('Preview in Canvas');
  const after = section.getByText(ARTIFACT_TRAILING_MARKDOWN, { exact: true });
  await after.scrollIntoViewIfNeeded();
  await expect(after).toBeVisible();
});

test.fail(
  'full HTML document / viewport-height can be scrolled to [data-artifact-end]',
  async ({ page }) => {
    const section = await openFixture(page, 'full-html-document');
    await waitForSandboxFrame(section);
    const frame = page.frameLocator(
      '[data-testid="artifact-gallery-case"][data-fixture-id="full-html-document"] iframe.artifact-iframe',
    );
    await frame.locator('[data-artifact-end="full-html-document"]').scrollIntoViewIfNeeded();
    await expect(frame.locator('[data-artifact-end="full-html-document"]')).toBeVisible();
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

test.fail('viewport-100vh last marker is reachable inside an iframe', async ({ page }) => {
  const section = await openFixture(page, 'viewport-100vh');
  await waitForSandboxFrame(section);
  const frame = page.frameLocator(
    '[data-testid="artifact-gallery-case"][data-fixture-id="viewport-100vh"] iframe.artifact-iframe',
  );
  await frame.locator('[data-artifact-end="viewport-100vh"]').scrollIntoViewIfNeeded();
  await expect(frame.locator('[data-artifact-end="viewport-100vh"]')).toBeVisible();
});

test('explicit Canvas hosts a canvas-sized stage whose last marker is reachable', async ({
  page,
}) => {
  const section = await openFixture(page, 'explicit-canvas');
  const stage = section.getByTestId('artifact-gallery-canvas-stage');
  await expect(stage).toBeVisible();
  await expect(stage.getByTestId('artifact-frame')).toHaveAttribute('data-artifact-layout', 'canvas');
  const iframe = stage.locator('iframe.artifact-iframe');
  await expect(iframe).toBeVisible({ timeout: 15_000 });
  const frame = page.frameLocator(
    '[data-testid="artifact-gallery-canvas-stage"] iframe.artifact-iframe',
  );
  await frame.locator('[data-artifact-end="explicit-canvas"]').scrollIntoViewIfNeeded();
  await expect(frame.locator('[data-artifact-end="explicit-canvas"]')).toBeVisible();
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
