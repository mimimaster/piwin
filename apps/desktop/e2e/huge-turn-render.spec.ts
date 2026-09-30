import { expect, test, type Page } from '@playwright/test';

/**
 * Huge settled turn (?e2eHugeTurn=1): 620 steps, ~880 tool calls, every edit
 * carrying an inline patch. Opening 已工作 used to mount every resident row
 * with an auto-expanded, highlighted DiffCard per edit (~7.7k nodes and
 * ~390ms of long tasks for a 43-row tail page on an M-series Chrome).
 *
 * The gate is structural — node and diff counts — so it holds in CI; the
 * timing is printed only.
 */
const TITLE = '巨型单轮 · 620 步 / 880 工具';

async function openHugeTurn(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/?e2eHugeTurn=1');
  await page.getByRole('button', { name: '使用本机', exact: true }).click();
  await page.getByTestId('sidebar-mode-code').click();
  await page.getByTestId('open-workspace-btn').click();
  await page.getByTestId('project-path-input').fill('/mock/piwin');
  await page.getByTestId('open-project-btn').click();
  await page.getByTestId('empty-stage-landing-row').filter({ hasText: TITLE }).click();
  await expect(page.getByTestId('transcript-opening-state')).toBeHidden();
  await expect(page.getByTestId('turn-work-disclosure-trigger')).toBeVisible();
}

function threadNodeCount(page: Page): Promise<number> {
  return page.evaluate(
    () => document.querySelector('[data-testid="chat-thread"]')?.querySelectorAll('*').length ?? 0,
  );
}

test('opening a huge turn lists segments instead of mounting the chain', async ({ page }) => {
  test.setTimeout(120_000);
  await openHugeTurn(page);

  const openMs = await page.evaluate(async () => {
    const trigger = document.querySelector<HTMLElement>(
      '[data-testid="turn-work-disclosure-trigger"]',
    );
    const start = performance.now();
    trigger?.click();
    await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
    return Math.round(performance.now() - start);
  });
  await expect(page.getByTestId('turn-work-segment').first()).toBeVisible();

  const nodes = await threadNodeCount(page);
  const openSegments = await page
    .locator('[data-testid="turn-work-segment"][data-open="true"]')
    .count();
  console.log(`[huge-turn-render] ${JSON.stringify({ openMs, nodes, openSegments })}`);

  expect(openSegments).toBe(1);
  expect(await page.locator('[data-testid="diff-card"]').count()).toBe(0);
  expect(nodes).toBeLessThan(1_500);

  // Opening a segment mounts its rows; an edit's diff still waits for a click.
  await page.getByTestId('turn-work-segment-header').first().click();
  await expect(page.locator('[data-testid="turn-work-segment"][data-open="true"]')).toHaveCount(2);
  expect(await page.locator('[data-testid="diff-card"]').count()).toBe(0);

  // 精简 folds every segment back to its title, keeping the one opened by hand.
  await page.getByTestId('work-chain-compact-toggle').click();
  await expect(page.locator('[data-testid="turn-work-segment"][data-open="true"]')).toHaveCount(1);
  await page.getByTestId('work-chain-compact-toggle').click();
});
