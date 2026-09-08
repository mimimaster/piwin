import { expect, test, type Page } from '@playwright/test';

async function readGeometry(page: Page) {
  return page.getByRole('log').evaluate((element) => ({
    top: element.scrollTop,
    height: element.scrollHeight,
    gap: Math.max(0, element.scrollHeight - element.clientHeight - element.scrollTop),
    slotErrors: Array.from(element.querySelectorAll('.transcript-turn-window-item')).map((slot) =>
      Math.abs(
        slot.getBoundingClientRect().height -
          (slot.firstElementChild?.getBoundingClientRect().height ?? 0),
      ),
    ),
  }));
}

test('covers delayed first-open reflows and reveals only the stable tail', async ({ page }) => {
  await page.goto('/#/e2e/transcript-scroll');
  await page.getByRole('button', { name: 'Open with delayed layout', exact: true }).click();
  await expect(page.getByTestId('transcript-opening-state')).toBeVisible();
  // Covered content must still mount and measure; display:none cannot pass.
  await expect(page.getByTestId('chat-stream')).toHaveAttribute('inert', '');
  await expect(page.getByTestId('transcript-opening-state')).toBeHidden();
  await expect(page.getByRole('log')).toBeVisible();
  await expect
    .poll(async () => {
      const report = await page.getByTestId('scroll-frame-report').textContent();
      const frames = JSON.parse(report ?? '[]') as Array<{
        top: number;
        height: number;
        gap: number;
        visible: boolean;
        phase: number;
      }>;
      const shown = frames.filter((frame) => frame.visible);
      return (
        frames.length === 90 &&
        frames.some((frame) => !frame.visible) &&
        shown.length > 0 &&
        shown.every(
          (frame) =>
            frame.phase === 3 &&
            frame.gap <= 1 &&
            frame.top === shown[0]?.top &&
            frame.height === shown[0]?.height,
        )
      );
    })
    .toBe(true);
});

async function expectStableFrames(page: Page, expected: { top: number; height: number }) {
  await expect
    .poll(async () => {
      const report = await page.getByTestId('scroll-frame-report').textContent();
      const frames = JSON.parse(report ?? '[]') as Array<{
        top: number;
        height: number;
        gap: number;
      }>;
      return (
        frames.length === 30 &&
        frames.every(
          (frame) =>
            frame.top === expected.top && frame.height === expected.height && frame.gap <= 1,
        )
      );
    })
    .toBe(true);
}

for (const scenario of ['Open two heavy turns', 'Open long history']) {
  test(`${scenario}: opens at the tail and preserves geometry on status hydration`, async ({
    page,
  }) => {
    await page.goto('/#/e2e/transcript-scroll');
    await page.getByRole('button', { name: scenario, exact: true }).click();
    await page.getByRole('button', { name: 'Load transcript', exact: true }).click();
    await expect.poll(async () => (await readGeometry(page)).height).toBeGreaterThan(6_000);
    await expect.poll(async () => (await readGeometry(page)).gap).toBeLessThanOrEqual(1);
    const initial = await readGeometry(page);
    await expectStableFrames(page, initial);

    await page.getByRole('button', { name: 'Update status', exact: true }).click();
    await expect.poll(() => readGeometry(page)).toEqual(initial);
    expect(initial.slotErrors.every((error) => error <= 1)).toBe(true);

    // Fixture samples the scrollport once per frame, starting with the first
    // frame after the action, so eventual settling alone cannot pass.
    await expectStableFrames(page, initial);

    // Warm opens mount the scroll root and populated list in the same commit.
    await page.getByRole('button', { name: 'Reopen transcript', exact: true }).click();
    await expect.poll(async () => (await readGeometry(page)).height).toBeGreaterThan(6_000);
    const reopened = await readGeometry(page);
    await expectStableFrames(page, reopened);

    const viewport = page.getByRole('log');
    await viewport.hover();
    await page.mouse.wheel(0, -450);
    await expect.poll(async () => (await readGeometry(page)).gap).toBeGreaterThan(100);
    const detached = await readGeometry(page);
    await page.getByRole('button', { name: 'Update status', exact: true }).click();
    await expect.poll(() => readGeometry(page)).toEqual(detached);
  });
}
