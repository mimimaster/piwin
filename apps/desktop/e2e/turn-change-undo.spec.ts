import { expect, test, type Page } from '@playwright/test';

/**
 * Per-turn undo on the real Desktop renderer (?e2eTurnChanges=1): the card
 * under the answer, one-click undo and 恢复改动, a refused undo with
 * 查看冲突 in the right panel, and 重新检查 once the outside edit is gone.
 * The Host side is the fixture in src/e2e/turn-changes-fixture.ts.
 */
const TITLE = '登录校验 · 本轮撤销';

async function openFixture(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/?e2eTurnChanges=1');
  await page.getByRole('button', { name: '使用本机', exact: true }).click();
  await page.getByTestId('sidebar-mode-code').click();
  await page.getByTestId('open-workspace-btn').click();
  await page.getByTestId('project-path-input').fill('/mock/piwin');
  await page.getByTestId('open-project-btn').click();
  await page.getByTestId('empty-stage-landing-row').filter({ hasText: TITLE }).click();
  await expect(page.getByTestId('transcript-opening-state')).toBeHidden();
}

function transcriptCard(page: Page) {
  // The panel reuses the same card; the transcript one is outside it.
  return page.locator('[data-testid="turn-change-bar"]:not([data-testid="turn-change-panel"] *)').first();
}

test.describe('turn-change undo', () => {
  test('undo, restore, then a refused undo explained and rechecked', async ({ page }) => {
    await openFixture(page);
    const card = transcriptCard(page);
    await expect(card.getByTestId('turn-change-bar-title')).toHaveText('本轮改动');
    await expect(card.getByTestId('turn-change-bar-meta')).toHaveText('2 个文件');
    await expect(card.getByTestId('turn-change-bar-file')).toHaveCount(2);

    // One click, no dialog.
    await card.getByTestId('turn-change-bar-undo').click();
    await expect(card.getByTestId('turn-change-bar-title')).toHaveText('本轮已撤销');
    await expect(card).toHaveAttribute('data-state', 'undone');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await card.getByTestId('turn-change-bar-redo').click();
    await expect(card.getByTestId('turn-change-bar-title')).toHaveText('本轮改动');

    // Someone edits a file after the turn: undo is refused and nothing changes.
    await page.evaluate(() =>
      (window as unknown as { __piwinTurnChanges: { editAfterTurn: () => void } }).__piwinTurnChanges.editAfterTurn(),
    );
    await card.getByTestId('turn-change-bar-undo').click();
    const conflict = card.getByTestId('turn-change-bar-conflict');
    await expect(conflict).toContainText('1 个文件在本轮结束后又被修改');
    await expect(conflict).toContainText('本次未修改任何文件');
    await expect(card).toHaveAttribute('data-state', 'conflict');
    await expect(card.getByTestId('turn-change-bar-undo')).toHaveCount(0);

    // 查看冲突 opens the right panel on this turn's blocked path.
    await conflict.getByTestId('turn-change-bar-view-conflict').click();
    const panel = page.getByTestId('turn-change-panel');
    await expect(panel.getByTestId('turn-change-conflicts')).toBeVisible();
    await expect(panel.getByTestId('turn-change-conflict-source')).toContainText('来源未知');
    await panel.getByTestId('turn-change-conflict-current').click();
    await expect(panel.locator('.diff-card')).toContainText('user.trim()');

    // Once the outside edit is gone, 重新检查 brings undo back.
    await page.evaluate(() =>
      (window as unknown as { __piwinTurnChanges: { clear: () => void } }).__piwinTurnChanges.clear(),
    );
    await card.getByTestId('turn-change-bar-recheck').click();
    await expect(card.getByTestId('turn-change-bar-conflict')).toHaveCount(0);
    await expect(card.getByTestId('turn-change-bar-undo')).toBeVisible();
  });

  test('undo and restore are reachable from the keyboard', async ({ page }) => {
    await openFixture(page);
    const card = transcriptCard(page);
    const undo = card.getByTestId('turn-change-bar-undo');
    await undo.focus();
    await expect(undo).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(card.getByTestId('turn-change-bar-title')).toHaveText('本轮已撤销');
    const redo = card.getByTestId('turn-change-bar-redo');
    await redo.focus();
    await page.keyboard.press('Space');
    await expect(card.getByTestId('turn-change-bar-title')).toHaveText('本轮改动');
  });
});
