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

/** Message index of the first turn in the rail segment covering a 1-based turn. */
async function segmentHeadFor(page: Page, turn: number): Promise<number> {
  const testId = await page.locator('.border-tick-line').evaluateAll((ticks, wanted) => {
    for (const tick of ticks) {
      const match = /message (\d+)(?:–(\d+))? \//.exec(tick.getAttribute('aria-label') ?? '');
      if (!match) continue;
      const start = Number(match[1]);
      const end = Number(match[2] ?? match[1]);
      if (start <= wanted && wanted <= end) return tick.getAttribute('data-testid');
    }
    return null;
  }, turn);
  const head = Number(testId?.replace('history-tick-page-', ''));
  if (!Number.isInteger(head)) throw new Error(`No rail segment holds turn ${turn}`);
  return head;
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
  // 1,200 turns do not fit the rail one tick per turn: it merges segments
  // and a segment jumps to its first turn. Use the segment holding turn 121.
  await expect(page.getByTestId('history-ticks-drawer')).toHaveAttribute(
    'data-history-segmented',
    'true',
  );
  const head = await segmentHeadFor(page, 121);
  await page.getByTestId(`history-tick-page-${head}`).press('Enter');
  await expect.poll(() => range(page)).toBe(`page-${head - 8}:page-${head + 41}:50`);
  await scrollEdge(page, 'newer');
  await expect.poll(() => range(page)).toContain(`:page-${head + 90}:`);
  await scrollEdge(page, 'older');
  await expect.poll(() => range(page)).toMatch(new RegExp(`^page-${head - 57}:`));
});

test('keeps full history ticks during a new live turn', async ({ page }) => {
  await page.goto('/#/e2e/transcript-scroll');
  await page.getByRole('button', { name: 'Open paged history', exact: true }).click();
  await expect(page.getByTestId('transcript-opening-state')).toBeHidden();
  const drawer = page.getByTestId('history-ticks-drawer');
  // The rail covers the Host's 1,200 turns, not the 160 resident rows, and
  // merges them into segments that fit instead of scrolling.
  await expect(drawer).toHaveAttribute('data-history-total-user-messages', '1200');
  const ticks = page.locator('.border-tick-line');
  const count = await ticks.count();
  expect(count).toBeLessThan(160);
  const rail = page.getByTestId('history-drawer-handle');
  expect(await rail.evaluate((element) => element.scrollHeight <= element.clientHeight)).toBe(true);
  await page.getByRole('button', { name: 'Send while index refreshes', exact: true }).click();
  await expect(drawer).toHaveAttribute('data-history-total-user-messages', '1201');
  await expect(ticks).toHaveCount(count);
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
