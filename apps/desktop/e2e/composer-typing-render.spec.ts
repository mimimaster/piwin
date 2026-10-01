import { expect, test } from '@playwright/test';

/**
 * Composer typing must not re-render the transcript. The draft text lives in
 * the composer props; any leak of it (or of a per-keystroke handler) into
 * ChatThread's props or a context rows consume re-renders every mounted row
 * per character, which made typing lag in long sessions.
 *
 * Uses the 55-step live-chain fixture (it installs the render probe) with the
 * stream frozen, so every sample below comes from typing alone.
 */
const TITLE = '运行中 · 55 步调用链';
const TYPED = 'hello world typing test';

type ProbeSample = { id: string; phase: 'mount' | 'update' | 'nested-update' };

test('typing in the composer re-renders no transcript rows', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/?e2eLiveChain=1');
  await page.getByRole('button', { name: '使用本机', exact: true }).click();
  await page.getByTestId('sidebar-mode-code').click();
  await page.getByTestId('open-workspace-btn').click();
  await page.getByTestId('project-path-input').fill('/mock/piwin');
  await page.getByTestId('open-project-btn').click();
  await page.getByTestId('empty-stage-landing-row').filter({ hasText: TITLE }).click();
  await expect(page.getByTestId('transcript-opening-state')).toBeHidden();
  const trigger = page.getByTestId('turn-work-disclosure-trigger');
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') {
    await trigger.click();
  }
  await expect(page.locator('[id^="msg-live-a"]').first()).toBeAttached();
  await page.evaluate(() => {
    (
      window as unknown as { __piwinLiveChain?: { driver: { stop: () => void } } }
    ).__piwinLiveChain?.driver.stop();
  });

  const input = page.getByTestId('composer-input');
  await input.click();
  const cursor = await page.evaluate(() => {
    const probe = (window as unknown as { __piwinRenderProbe?: { mark: () => number } })
      .__piwinRenderProbe;
    if (!probe) throw new Error('render probe was not installed');
    return probe.mark();
  });
  await input.pressSequentially(TYPED);
  await expect(input).toHaveValue(TYPED);

  const rowRenders = await page.evaluate((from) => {
    const probe = (window as unknown as { __piwinRenderProbe?: { samples: ProbeSample[] } })
      .__piwinRenderProbe;
    return (probe?.samples ?? [])
      .slice(from)
      .filter((sample) => sample.id.startsWith('row:')).length;
  }, cursor);
  console.log(`[composer-typing-render] ${JSON.stringify({ keys: TYPED.length, rowRenders })}`);
  expect(rowRenders).toBe(0);
});
