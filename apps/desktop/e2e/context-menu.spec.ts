import { expect, test, type Page } from '@playwright/test';

/**
 * Context-menu surfaces e2e (CM §11.3, P0 slice).
 * Browser shell with HostClient mock: right-click file tree → Add to Chat chip,
 * code-preview selection → Explain auto-sends a preset turn.
 */

async function waitForHostReady(page: Page): Promise<void> {
  const chooseSidecar = page.getByTestId('host-gate-choose-sidecar');
  if (await chooseSidecar.isVisible()) {
    await chooseSidecar.click();
  }
  await expect(page.getByTestId('app-shell')).toBeVisible();
  // This branch's StatusBar no longer exposes host-status-pill; shell ready is
  // proven by the workspace picker entry point being interactive.
  await expect(page.getByTestId('open-workspace-btn')).toBeVisible();
}

async function openTrustedSession(page: Page, projectPath: string): Promise<void> {
  await page.getByTestId('open-workspace-btn').click();
  await expect(page.getByTestId('workspace-path-dialog')).toBeVisible();
  await page.getByTestId('project-path-input').fill(projectPath);
  await page.getByTestId('open-project-btn').click();
  await expect(page.getByTestId('workspace-path-dialog')).toHaveCount(0);
  await expect(page.getByTestId('trust-dialog')).toHaveCount(0);
  // Explicit open auto-trusts; the composer is the readiness signal (session
  // rows render through the project rail on this branch).
  await expect(page.getByTestId('composer-input')).toBeEnabled();
}

async function openFilesTab(page: Page): Promise<void> {
  // Open the right panel, then add the Files tab via the plus menu.
  await page.getByTestId('right-panel-open-btn').first().click();
  await page.getByTestId('right-panel-tab-add').click();
  await page.getByTestId('right-panel-plus-files').click();
  await expect(page.getByTestId('file-tree-panel')).toBeVisible();
  await expect(page.locator('button.file-tree-row[title="README.md"]')).toBeVisible();
}

test.describe('context-menu surfaces (vite + host mock)', () => {
  test('file-add-to-chat: right-click file row -> Add to Chat -> context chip', async ({
    page,
  }) => {
    await page.goto('/');
    await waitForHostReady(page);
    await openTrustedSession(page, '/tmp/piwin-e2e-cm-files');
    await openFilesTab(page);

    const readmeRow = page.locator('button.file-tree-row[title="README.md"]');
    await readmeRow.click({ button: 'right' });
    await expect(page.getByTestId('context-menu-add-to-chat')).toBeVisible();
    await page.getByTestId('context-menu-add-to-chat').click();

    const chip = page.getByTestId('composer-context-chip');
    await expect(chip).toBeVisible();
    await expect(chip).toHaveAttribute('data-context-kind', 'file');
    await expect(chip).toContainText('README.md');
  });

  test('message-menu: right-click an assistant bubble offers the message surface menu', async ({
    page,
  }) => {
    await page.goto('/');
    await waitForHostReady(page);
    await openTrustedSession(page, '/tmp/piwin-e2e-cm-message');

    // Send a prompt so the mock host produces an assistant bubble.
    await page.getByTestId('composer-input').fill('hello');
    await page.keyboard.press('Enter');
    await expect(
      page.locator('[data-testid="message-bubble"][data-role="assistant"]', {
        hasText: 'piwin desktop mock reply',
      }),
    ).toBeVisible();

    // Right-click the assistant bubble -> message surface catalog menu.
    const assistantBubble = page.locator('[data-testid="message-bubble"][data-role="assistant"]');
    await assistantBubble.click({ button: 'right' });
    await expect(page.getByTestId('context-menu-copy')).toBeVisible();
    await expect(page.getByTestId('context-menu-add-to-chat')).toBeVisible();
  });

  test('selection-explain: preview select -> Explain -> prompt/stream starts', async ({ page }) => {
    await page.goto('/');
    await waitForHostReady(page);
    await openTrustedSession(page, '/tmp/piwin-e2e-cm-selection');
    await openFilesTab(page);

    // Open the code preview (package.json renders through CodePreviewView).
    const packageRow = page.locator('button.file-tree-row[title="package.json"]');
    await packageRow.click();
    const preview = page.getByTestId('code-preview-view');
    await expect(preview).toBeVisible();

    // Select a word on the first preview row, then right-click the selection.
    const firstRowText = preview.locator('.code-preview-text').first();
    // Wait for highlight/content to settle before measuring a box for the click.
    await expect(firstRowText).toContainText(/mock preview|export|piwin/);
    await firstRowText.dblclick();
    const box = await firstRowText.boundingBox();
    if (!box) {
      throw new Error('preview row has no bounding box');
    }
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, {
      button: 'right',
    });

    await expect(page.getByTestId('context-menu-explain')).toBeVisible();
    await page.getByTestId('context-menu-explain').click();

    // Preset turn starts: user bubble with the Explain template, then mock reply.
    await expect(
      page.locator('[data-testid="message-bubble"][data-role="user"]', {
        hasText: 'Explain the attached context',
      }),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="message-bubble"][data-role="assistant"]', {
        hasText: 'piwin desktop mock reply',
      }),
    ).toBeVisible();
  });
});
