import { test, expect, type Page } from '@playwright/test';

async function scrollEdge(page: Page, direction: 'older' | 'newer') {
  await page.getByRole('log').evaluate((element, direction) => {
    element.dispatchEvent(
      new WheelEvent('wheel', { deltaY: direction === 'older' ? -10 : 10, bubbles: true }),
    );
    element.scrollTop = direction === 'older' ? 0 : element.scrollHeight;
    element.dispatchEvent(new Event('scroll'));
  }, direction);
}
async function range(page: Page) {
  return (await page.getByTestId('paging-range').textContent()) ?? '';
}

/** Gallery: 1200 messages, live tail = last 160, history view keeps ≤ 600. */
test('scrolls past the cache limit to the beginning and back to the real end', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/#/e2e/transcript-scroll');
  await page.getByRole('button', { name: 'Open paged history', exact: true }).click();
  await expect(page.getByTestId('transcript-opening-state')).toBeHidden();
  for (let step = 0; step < 40 && !(await range(page)).startsWith('page-0:'); step++) {
    const before = await range(page);
    await scrollEdge(page, 'older');
    await expect.poll(() => range(page)).not.toBe(before);
  }
  expect(await range(page)).toMatch(/^page-0:page-599:600$/);
  for (let step = 0; step < 40 && !(await range(page)).includes(':page-1199:'); step++) {
    const before = await range(page);
    await scrollEdge(page, 'newer');
    await expect.poll(() => range(page)).not.toBe(before);
  }
  expect(await range(page)).toMatch(/^page-600:page-1199:600$/);
  await page.getByTestId('history-tick-page-120').press('Enter');
  await expect.poll(() => range(page)).toMatch(/^page-112:page-161:50$/);
  await scrollEdge(page, 'newer');
  await expect.poll(() => range(page)).toContain(':page-210:');
  await scrollEdge(page, 'older');
  await expect.poll(() => range(page)).toMatch(/^page-63:/);
});

test('keeps full history ticks during a new live turn', async ({ page }) => {
  await page.goto('/#/e2e/transcript-scroll');
  await page.getByRole('button', { name: 'Open paged history', exact: true }).click();
  await expect(page.getByTestId('transcript-opening-state')).toBeHidden();
  const ticks = page.locator('.border-tick-line');
  const count = await ticks.count();
  expect(count).toBeGreaterThan(160);
  await page.getByRole('button', { name: 'Send while index refreshes', exact: true }).click();
  await expect(ticks).toHaveCount(count + 1);
});

test('keeps the visible boundary in place while evicting the opposite cache edge', async ({
  page,
}) => {
  await page.goto('/#/e2e/transcript-scroll');
  await page.getByRole('button', { name: 'Open paged history', exact: true }).click();
  await expect(page.getByTestId('transcript-opening-state')).toBeHidden();
  const before = await page.getByRole('log').evaluate((element) => {
    element.dispatchEvent(new WheelEvent('wheel', { deltaY: -1, bubbles: true }));
    element.scrollTop = 10;
    element.dispatchEvent(new Event('scroll'));
    const boundary = element.querySelector('[data-message-id="page-1040"]');
    if (!boundary) throw new Error('Missing visible boundary');
    return boundary.getBoundingClientRect().top - element.getBoundingClientRect().top;
  });
  await expect.poll(() => range(page)).toMatch(/^page-991:/);
  await expect
    .poll(() =>
      page.getByRole('log').evaluate((element) => {
        const boundary = element.querySelector('[data-message-id="page-1040"]');
        return boundary
          ? boundary.getBoundingClientRect().top - element.getBoundingClientRect().top
          : -999;
      }),
    )
    .toBeCloseTo(before, 0);
});
