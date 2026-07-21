import { expect, test, type Page } from '@playwright/test';

/**
 * Browser-shell e2e (HostClient transport=mock outside Tauri).
 * Covers residual D-M2-05b local slice: shell ready, settings, session list, mock chat.
 */

async function waitForHostReady(page: Page): Promise<void> {
  await expect(page.getByTestId('app-shell')).toBeVisible();
  await expect(page.getByTestId('host-status-pill')).toContainText('ready');
  await expect(page.getByTestId('transport-pill')).toContainText('mock');
}

/**
 * Open project → trust dialog → Trust auto-creates a session (composer ready).
 */
async function openTrustedSession(page: Page, projectPath: string): Promise<void> {
  await page.getByTestId('project-path-input').fill(projectPath);
  await page.getByTestId('open-project-btn').click();
  await expect(page.getByTestId('project-trust-pill')).toContainText('Untrusted');
  await expect(page.getByTestId('trust-dialog')).toBeVisible();
  await page.getByTestId('trust-confirm-btn').click();
  await expect(page.getByTestId('trust-dialog')).toHaveCount(0);
  await expect(page.getByTestId('project-trust-pill')).toContainText('Trusted');
  // Trust path auto-creates a chat so the composer is enabled.
  await expect(page.getByTestId('session-item')).toHaveCount(1);
  await expect(page.getByTestId('composer-input')).toBeEnabled();
}

test.describe('desktop shell (vite + host mock)', () => {
  test('loads shell with host ready and mock transport', async ({ page }) => {
    await page.goto('/');
    await waitForHostReady(page);
    await expect(page.getByTestId('sessions-empty')).toBeVisible();
    await expect(page.getByTestId('chat-empty-state')).toBeVisible();
  });

  test('opens and closes Settings panel', async ({ page }) => {
    await page.goto('/');
    await waitForHostReady(page);

    await page.getByTestId('settings-open-btn').click();
    await expect(page.getByTestId('settings-panel')).toBeVisible();
    await expect(page.getByTestId('settings-config-root')).toContainText('Config root:');

    await page.getByTestId('settings-panel').getByRole('button', { name: 'Appearance' }).click();
    await page.getByTestId('tool-density-slider').fill('2');
    await expect(page.getByTestId('tool-density-value')).toContainText('detailed');

    await page.getByTestId('settings-close-btn').click();
    await expect(page.getByTestId('settings-panel')).toHaveCount(0);
  });

  test('opens Extensions settings from rail and toggles path-guard', async ({ page }) => {
    await page.goto('/');
    await waitForHostReady(page);

    await page.getByTestId('extensions-open-btn').click();
    await expect(page.getByTestId('extensions-panel')).toBeVisible();
    await expect(page.getByTestId('settings-panel')).toBeVisible();
    await expect(page.getByTestId('extensions-security-banner')).toBeVisible();
    await expect(page.getByTestId('extension-item').filter({ hasText: 'path-guard' })).toBeVisible();

    await page
      .getByTestId('extension-item')
      .filter({ hasText: 'path-guard' })
      .getByTestId('extension-toggle-btn')
      .click();
    await expect(page.getByTestId('extension-item').filter({ hasText: 'path-guard' })).toContainText(
      'off',
    );

    await page.getByTestId('settings-close-btn').click();
    await expect(page.getByTestId('settings-panel')).toHaveCount(0);
  });

  test('Models settings can add a provider preset', async ({ page }) => {
    await page.goto('/');
    await waitForHostReady(page);
    await page.getByTestId('settings-open-btn').click();
    await page.getByTestId('settings-panel').getByRole('button', { name: 'Models', exact: true }).click();
    await expect(page.getByTestId('provider-settings')).toBeVisible();
    await page.locator('[data-testid="provider-preset"][data-preset-id="openai"]').click();
    await expect(page.getByTestId('provider-list-item').filter({ hasText: 'OpenAI' })).toBeVisible();
    await expect(page.getByTestId('provider-baseurl-input')).toHaveValue(/api\.openai\.com/);
    await page.getByTestId('settings-close-btn').click();
  });

  test('Models settings can add Gemini OpenAI-compatible preset', async ({ page }) => {
    await page.goto('/');
    await waitForHostReady(page);
    await page.getByTestId('settings-open-btn').click();
    await page.getByTestId('settings-panel').getByRole('button', { name: 'Models', exact: true }).click();
    await expect(page.getByTestId('provider-settings')).toBeVisible();
    await page.locator('[data-testid="provider-preset"][data-preset-id="gemini"]').click();
    await expect(page.getByTestId('provider-list-item').filter({ hasText: 'Google Gemini' })).toBeVisible();
    await expect(page.getByTestId('provider-baseurl-input')).toHaveValue(
      /generativelanguage\.googleapis\.com/,
    );
    await page.getByTestId('provider-apikey-ref-input').fill('keychain:gemini');
    await page.getByTestId('provider-save-btn').click();
    await expect(page.getByTestId('provider-apikey-ref-input')).toHaveValue('keychain:gemini');
    await page.getByTestId('settings-close-btn').click();
  });

  test('open project → trust → session ready for chat', async ({ page }) => {
    await page.goto('/');
    await waitForHostReady(page);

    await openTrustedSession(page, '/tmp/piwin-e2e-desktop');
    await expect(page.getByTestId('session-item').first()).toBeVisible();
    await expect(page.getByTestId('composer-input')).toBeEnabled();
  });

  test('keeps the project picker compact after opening a project', async ({ page }) => {
    await page.goto('/');
    await waitForHostReady(page);

    await page.getByTestId('project-path-input').fill('/tmp/piwin-e2e-sidebar');
    await page.getByTestId('open-project-btn').click();
    await expect(page.getByTestId('project-trust-pill')).toHaveCount(1);
    await expect(page.locator('.project-card')).toHaveCount(0);

    await expect(page.getByTestId('trust-dialog')).toBeVisible();
    await page.getByTestId('trust-deny-btn').click();
    await expect(page.getByTestId('trust-dialog')).toHaveCount(0);

    await page.getByTitle('Project').click();
    await expect(page.locator('.project-card')).toBeVisible();
    await expect(page.getByLabel('Search conversations')).toBeVisible();
    await expect(page.getByTestId('new-session-btn')).toContainText('New conversation');
  });

  test('mock chat: send prompt and see assistant reply', async ({ page }) => {
    await page.goto('/');
    await waitForHostReady(page);
    await openTrustedSession(page, '/tmp/piwin-e2e-chat');

    const prompt = 'hello desktop e2e';
    await page.getByTestId('composer-input').fill(prompt);
    await page.getByTestId('send-btn').click();

    await expect(
      page.locator('[data-testid="message-bubble"][data-role="user"]', { hasText: prompt }),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="message-bubble"][data-role="assistant"]', {
        hasText: 'piwin desktop mock reply',
      }),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="message-bubble"][data-role="assistant"]', {
        hasText: `You said: ${prompt}`,
      }),
    ).toBeVisible();
  });

  test('composer plus menu selects Plan mode', async ({ page }) => {
    await page.goto('/');
    await waitForHostReady(page);
    await page.getByTestId('composer-plus-btn').click();
    await expect(page.getByTestId('composer-plus-menu')).toBeVisible();
    await page.getByRole('menuitem', { name: 'Plan' }).click();
    await expect(page.getByTestId('agent-mode-chip')).toContainText('Plan');
    await expect(page.getByTestId('agent-mode-banner')).toContainText('Plan Mode');
  });

  test('terminal dock opens on demand', async ({ page }) => {
    await page.goto('/');
    await waitForHostReady(page);
    await expect(page.getByTestId('terminal-dock')).toHaveClass(/collapsed/);
    await page.getByTestId('terminal-dock-title-btn').click();
    await expect(page.getByTestId('terminal-dock')).toHaveClass(/open/);
    await page.getByTestId('terminal-dock-title-btn').click();
    await expect(page.getByTestId('terminal-dock')).toHaveClass(/collapsed/);
  });

  test('execution inspector is on-demand and shows activity after chat', async ({ page }) => {
    await page.goto('/');
    await waitForHostReady(page);
    await expect(page.getByTestId('right-panel')).toHaveCount(0);
    await expect(page.getByTestId('app-shell')).not.toHaveClass(/has-right-panel/);

    await page.getByTestId('right-panel-tools-btn').click();
    await expect(page.getByTestId('right-panel')).toBeVisible();
    await expect(page.getByTestId('right-panel')).toContainText('Tool activity');

    await openTrustedSession(page, '/tmp/piwin-e2e-tools');
    await page.getByTestId('composer-input').fill('tool card smoke');
    await page.getByTestId('send-btn').click();

    await expect(page.getByTestId('tool-call-card').first()).toBeVisible();
    await expect(page.getByTestId('right-panel')).toContainText('mock_echo');
  });

  test('message copy action appears after assistant reply', async ({ page }) => {
    await page.goto('/');
    await waitForHostReady(page);
    await openTrustedSession(page, '/tmp/piwin-e2e-copy');
    await page.getByTestId('composer-input').fill('copy me please');
    await page.getByTestId('send-btn').click();
    await expect(
      page.locator('[data-testid="message-bubble"][data-role="assistant"]'),
    ).toBeVisible();
    await page.locator('[data-testid="message-bubble"][data-role="user"]').hover();
    await expect(page.getByTestId('message-copy-btn').first()).toBeVisible();
    await expect(page.getByTestId('message-retry-btn')).toBeVisible();
  });
});
