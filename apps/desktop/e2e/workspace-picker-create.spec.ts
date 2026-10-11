import { expect, test, type Page } from '@playwright/test';

async function selectFileAction(page: Page, testId: string): Promise<void> {
  await page.getByTestId('host-workspace-file-actions').click();
  await page.getByTestId(testId).click();
}

test('creates folders and files with Enter, keeps collision errors, and cancels with Escape', async ({
  page,
}) => {
  await page.goto('/');
  const chooseSidecar = page.getByTestId('host-gate-choose-sidecar');
  if (await chooseSidecar.isVisible()) await chooseSidecar.click();
  await expect(page.getByTestId('composer-input')).toBeVisible();
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.press(`${modifier}+KeyK`);
  await page.getByTestId('command-open-workspace').click();
  const picker = page.getByTestId('workspace-path-dialog');
  await expect(picker).toBeVisible();
  await expect(page.getByTestId('host-workspace-file-actions')).toBeEnabled();
  await expect(page.locator('.host-workspace-footer button')).toHaveCount(2);
  await expect(page.getByTestId('host-workspace-new-folder')).toHaveCount(0);
  await page.screenshot({
    path: '/private/tmp/piwin-workspace-picker-actions.png',
    animations: 'disabled',
  });

  await page.getByTestId('host-workspace-file-actions').click();
  await page.screenshot({
    path: '/private/tmp/piwin-workspace-picker-toolbar-menu.png',
    animations: 'disabled',
  });
  await page.getByTestId('host-workspace-new-folder').click();
  const name = page.getByTestId('host-workspace-create-name');
  await expect(name).toBeFocused();
  await name.fill('资料');
  await name.press('Enter');
  await expect(page.getByTestId('host-workspace-create-dialog')).toHaveCount(0);
  await expect(page.getByTestId('project-path-input')).toHaveValue('/Users/mock/资料');
  await expect(page.locator('.host-workspace-row.is-selected')).toContainText('资料');

  await selectFileAction(page, 'host-workspace-new-file');
  await name.fill('notes.md');
  await name.press('Enter');
  await expect(page.getByTestId('host-workspace-create-dialog')).toHaveCount(0);
  await expect(page.locator('.host-workspace-row.is-selected').last()).toContainText('notes.md');

  await selectFileAction(page, 'host-workspace-new-file');
  await name.fill('notes.md');
  await name.press('Enter');
  const createDialog = page.getByTestId('host-workspace-create-dialog');
  await expect(createDialog).toContainText(/同名|already exists/);
  await expect(name).toHaveValue('notes.md');
  await page.screenshot({
    path: '/private/tmp/piwin-workspace-picker-collision.png',
    animations: 'disabled',
  });
  await name.press('Escape');
  await expect(createDialog).toHaveCount(0);
  await expect(picker).toBeVisible();
  await selectFileAction(page, 'host-workspace-refresh');
  await expect(page.locator('.host-workspace-row.is-selected').last()).toContainText('notes.md');
  // Right-clicking a folder creates inside it, even when its row belongs to an ancestor column.
  const homeColumn = page.locator(
    '[data-testid="host-workspace-column"][aria-label="/Users/mock"]',
  );
  await homeColumn.getByRole('option', { name: '资料', exact: true }).click({ button: 'right' });
  await expect(page.getByTestId('host-workspace-context-menu')).toContainText('资料');
  await page.screenshot({
    path: '/private/tmp/piwin-workspace-picker-menu.png',
    animations: 'disabled',
  });
  await page.getByTestId('host-workspace-new-file').click();
  await expect(name).toBeFocused();
  await expect(createDialog).toContainText('/Users/mock/资料');
  await name.fill('inside.txt');
  await name.press('Enter');
  await expect(page.locator('.host-workspace-row.is-selected').last()).toContainText('inside.txt');
  await expect(page.getByTestId('project-path-input')).toHaveValue('/Users/mock/资料');

  // Blank space in an ancestor column creates in that column's own directory.
  await homeColumn.click({ button: 'right', position: { x: 80, y: 350 } });
  await expect(page.getByTestId('host-workspace-context-menu')).toContainText('mock');
  await page.getByTestId('host-workspace-new-file').click();
  await name.fill('parent.txt');
  await name.press('Enter');
  await expect(page.locator('.host-workspace-row.is-selected').last()).toContainText('parent.txt');
  await expect(page.getByTestId('project-path-input')).toHaveValue('/Users/mock');
  await page.getByTestId('host-workspace-back').click();
  await expect(page.getByTestId('project-path-input')).toHaveValue('/Users/mock/资料');

  // The discoverable menu also works using only the keyboard.
  await page.getByTestId('host-workspace-file-actions').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('host-workspace-file-menu')).toBeVisible();
  await expect(page.getByTestId('host-workspace-new-folder')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('host-workspace-new-file')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(name).toBeFocused();
  await name.press('Escape');
  await expect(picker).toBeVisible();
  await page.setViewportSize({ width: 600, height: 600 });
  await expect(page.getByTestId('host-workspace-file-actions')).toBeVisible();
  await expect(page.getByTestId('open-project-btn')).toBeVisible();
  await page.screenshot({
    path: '/private/tmp/piwin-workspace-picker-compact.png',
    animations: 'disabled',
  });
});
