import { expect, test, type Page } from '@playwright/test';

/**
 * Catches the "字叠字" failure: absolute virtualizer slots under-measure while
 * streaming, so the next turn's translateY lands on top of the previous turn.
 */

async function waitForHostReady(page: Page): Promise<void> {
  // Shell-only builds may land on the Host chooser before the workbench.
  const chooser = page.getByTestId('host-launch-chooser');
  const shell = page.getByTestId('app-shell');
  await expect(chooser.or(shell)).toBeVisible({ timeout: 30_000 });
  if (await chooser.isVisible()) {
    await page.getByTestId('host-gate-choose-sidecar').click();
  }
  await expect(shell).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('agent-mode-pill')).toHaveText('mock', { timeout: 30_000 });
  await expect(page.getByTestId('composer-input')).toBeVisible();
}

type SlotGeometry = {
  turnId: string;
  top: number;
  bottom: number;
  height: number;
};

async function readMountedTurnSlots(page: Page): Promise<SlotGeometry[]> {
  return page.evaluate(() => {
    const slots = [
      ...document.querySelectorAll<HTMLElement>('[data-testid="transcript-turn-window-item"]'),
    ];
    return slots.map((slot) => {
      const body = slot.querySelector<HTMLElement>('[data-turn-id]');
      const bounds = slot.getBoundingClientRect();
      return {
        turnId: body?.dataset.turnId ?? '',
        top: bounds.top,
        bottom: bounds.bottom,
        height: bounds.height,
      };
    });
  });
}

test('mounted turn slots do not overlap while a long reply streams', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 840 });
  await page.goto('/');
  await waitForHostReady(page);

  // Seed one completed turn so the next stream has history under it.
  await page.getByTestId('composer-input').fill('seed history turn for overlap check');
  await page.getByTestId('send-btn').click();
  await expect(
    page.locator('[data-testid="message-bubble"][data-role="assistant"]', {
      hasText: 'piwin desktop mock reply',
    }),
  ).toBeVisible();

  const longPrompt =
    'Stream a long reply so virtualizer heights must grow. ' +
    'overlap regression token batch '.repeat(48);
  await page.getByTestId('composer-input').fill(longPrompt);
  await page.getByTestId('send-btn').click();

  // Optimistic user bubble must appear immediately (not only after settle).
  await expect(
    page.locator('[data-testid="message-bubble"][data-role="user"]', { hasText: longPrompt }),
  ).toBeVisible({ timeout: 3_000 });

  await expect(page.getByTestId('pause-btn')).toBeVisible({ timeout: 5_000 });

  // While streaming, absolute slots must not share Y ranges.
  await expect
    .poll(async () => {
      const slots = await readMountedTurnSlots(page);
      if (slots.length < 2) {
        return 'need-two-slots';
      }
      const ordered = [...slots].sort((left, right) => left.top - right.top);
      for (let index = 1; index < ordered.length; index += 1) {
        const previous = ordered[index - 1];
        const current = ordered[index];
        if (!previous || !current) continue;
        if (current.top < previous.bottom - 1) {
          return `overlap:${previous.turnId}->${current.turnId}`;
        }
      }
      return 'ok';
    })
    .toBe('ok');

  await expect(
    page
      .locator('[data-testid="message-bubble"][data-role="assistant"]', {
        hasText: 'piwin desktop mock reply',
      })
      .last(),
  ).toBeVisible({ timeout: 30_000 });
});

test('second send in the same session shows the user bubble without switching sessions', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 840 });
  await page.goto('/');
  await waitForHostReady(page);

  await page.getByTestId('composer-input').fill('first turn same session');
  await page.getByTestId('send-btn').click();
  await expect(
    page
      .locator('[data-testid="message-bubble"][data-role="assistant"]', {
        hasText: 'piwin desktop mock reply',
      })
      .first(),
  ).toBeVisible();

  const second = 'second turn without session switch';
  await page.getByTestId('composer-input').fill(second);
  await page.getByTestId('send-btn').click();
  // Optimistic paint must land immediately — this is the "side bar running,
  // transcript empty" regression.
  await expect(
    page.locator('[data-testid="message-bubble"][data-role="user"]', { hasText: second }),
  ).toBeVisible({ timeout: 3_000 });
  await expect(
    page
      .locator('[data-testid="message-bubble"][data-role="assistant"]', {
        hasText: 'piwin desktop mock reply',
      })
      .nth(1),
  ).toBeVisible({ timeout: 30_000 });
});
