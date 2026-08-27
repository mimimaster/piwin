import { expect, test, type Page } from '@playwright/test';

type ResponseViewportGeometry = {
  currentResponseMinHeight: number;
  latestToOutputFloorGap: number;
  scrollTop: number;
  maximumScrollTop: number;
  viewportHeight: number;
};

async function waitForHostReady(page: Page): Promise<void> {
  await expect(page.getByTestId('app-shell')).toBeVisible();
  await expect(page.getByTestId('agent-mode-pill')).toHaveText('mock');
  await expect(page.getByTestId('composer-input')).toBeVisible();
}

async function openTrustedSession(page: Page): Promise<void> {
  await page.getByTestId('open-workspace-btn').click();
  await page.getByRole('menuitem', { name: /打开工作区文件夹|open workspace folder/i }).click();
  await page.getByTestId('project-path-input').fill('/tmp/piwin-e2e-response-viewport');
  await page.getByTestId('open-project-btn').click();
  await expect(page.getByTestId('composer-input')).toBeEnabled();

  await page.getByTestId('composer-input').fill('initialize response viewport');
  await page.getByTestId('send-btn').click();
  await expect(
    page.locator('[data-testid="message-bubble"][data-role="assistant"]', {
      hasText: 'piwin desktop mock reply',
    }),
  ).toBeVisible();
}

async function readResponseViewportGeometry(page: Page): Promise<ResponseViewportGeometry> {
  return page.evaluate(() => {
    const stream = document.querySelector('[data-testid="chat-stream"]');
    const currentTurn = document.querySelector('[data-testid="current-response-turn"]');
    const responseRows = currentTurn?.querySelectorAll(
      '[data-testid="message-bubble"][data-role="assistant"]',
    );
    const latestResponse = responseRows?.item((responseRows.length ?? 0) - 1);
    if (
      !(stream instanceof HTMLElement) ||
      !(currentTurn instanceof HTMLElement) ||
      !(latestResponse instanceof HTMLElement)
    ) {
      throw new Error('Expected current response viewport geometry');
    }

    const streamBounds = stream.getBoundingClientRect();
    const responseBounds = latestResponse.getBoundingClientRect();
    const streamStyle = getComputedStyle(stream);
    const outputFloor = streamBounds.bottom - Number.parseFloat(streamStyle.paddingBottom);
    return {
      currentResponseMinHeight: Number.parseFloat(
        stream.style.getPropertyValue('--transcript-current-response-min-height'),
      ),
      latestToOutputFloorGap: outputFloor - responseBounds.bottom,
      scrollTop: stream.scrollTop,
      maximumScrollTop: stream.scrollHeight - stream.clientHeight,
      viewportHeight: stream.clientHeight,
    };
  });
}

test('streaming response locks to an output floor without stealing manual history scroll', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 840 });
  await page.goto('/');
  await waitForHostReady(page);
  await openTrustedSession(page);

  const longPrompt =
    'Please produce a fairly long reply while I test the locked streaming viewport. ' +
    'locked viewport manual scroll control '.repeat(32);
  await page.getByTestId('composer-input').fill(longPrompt);
  await page.getByTestId('send-btn').click();
  await expect(page.getByTestId('pause-btn')).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId('current-response-turn')).toBeVisible();

  await expect
    .poll(async () => {
      const geometry = await readResponseViewportGeometry(page);
      return Math.abs(geometry.latestToOutputFloorGap);
    })
    .toBeLessThanOrEqual(2);

  const followingGeometry = await readResponseViewportGeometry(page);
  expect(followingGeometry.currentResponseMinHeight).toBeGreaterThanOrEqual(
    followingGeometry.viewportHeight * 0.74,
  );

  const streamBounds = await page.getByTestId('chat-stream').boundingBox();
  if (streamBounds === null) {
    throw new Error('Expected transcript bounds');
  }
  await page.mouse.move(
    streamBounds.x + streamBounds.width / 2,
    streamBounds.y + streamBounds.height / 2,
  );
  await page.mouse.wheel(0, -360);
  await expect(page.getByTestId('jump-to-latest-btn')).toBeVisible();

  const detachedGeometry = await readResponseViewportGeometry(page);
  await page.waitForTimeout(300);
  const detachedAfterGrowth = await readResponseViewportGeometry(page);
  expect(Math.abs(detachedAfterGrowth.scrollTop - detachedGeometry.scrollTop)).toBeLessThanOrEqual(
    1,
  );

  await page.getByTestId('jump-to-latest-btn').click();
  await expect(page.getByTestId('jump-to-latest-btn')).toHaveCount(0);
  await expect
    .poll(async () => {
      const geometry = await readResponseViewportGeometry(page);
      return Math.abs(geometry.maximumScrollTop - geometry.scrollTop);
    })
    .toBeLessThanOrEqual(2);
  await expect
    .poll(async () => {
      const geometry = await readResponseViewportGeometry(page);
      return Math.abs(geometry.latestToOutputFloorGap);
    })
    .toBeLessThanOrEqual(2);
});
