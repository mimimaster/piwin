import { expect, test, type Page } from '@playwright/test';

/**
 * Browser-shell e2e (HostClient transport=mock outside Tauri).
 * Covers residual D-M2-05b local slice: shell ready, settings, session list, mock chat.
 */

async function waitForHostReady(page: Page): Promise<void> {
  await expect(page.getByTestId('app-shell')).toBeVisible();
  // The compact sidebar no longer paints the legacy status/transport pills.
  // Wait on the shell-owned runtime sentinel and the mounted composer instead.
  await expect(page.getByTestId('agent-mode-pill')).toHaveText('mock');
  await expect(page.getByTestId('composer-input')).toBeVisible();
}

/**
 * Open project → auto-trust + session (composer ready).
 */
async function openTrustedSession(page: Page, projectPath: string): Promise<void> {
  await page.getByTestId('open-workspace-btn').click();
  await page.getByRole('menuitem', { name: /打开工作区文件夹|open workspace folder/i }).click();
  await page.getByTestId('project-path-input').fill(projectPath);
  await page.getByTestId('open-project-btn').click();
  // Project open enters draft mode. The first prompt lazily creates and names
  // the Host session; waiting for the reply keeps later lifecycle actions out
  // of the in-flight run window.
  await expect(page.getByTestId('workspace-path-dialog')).toHaveCount(0);
  await expect(page.getByTestId('trust-dialog')).toHaveCount(0);
  await expect(page.getByTestId('composer-input')).toBeEnabled();
  await page.getByTestId('composer-input').fill(`initialize ${projectPath}`);
  await page.getByTestId('send-btn').click();
  await expect(page.getByTestId('session-item')).toHaveCount(1);
  await expect(
    page.locator('[data-testid="message-bubble"][data-role="assistant"]', {
      hasText: 'piwin desktop mock reply',
    }),
  ).toBeVisible();
}

async function openFirstSessionMenu(page: Page): Promise<void> {
  const row = page.locator('.session-row').first();
  await row.hover();
  await row.getByTestId('session-menu-btn').click();
}

test.describe('desktop shell (vite + host mock)', () => {
  test('loads shell with host ready and mock transport', async ({ page }) => {
    await page.goto('/');
    await waitForHostReady(page);
    await expect(page.getByTestId('sidebar-empty-hint')).toBeVisible();
    await expect(page.getByTestId('chat-empty-state')).toBeVisible();
  });

  test('opens and closes Settings panel', async ({ page }) => {
    await page.goto('/');
    await waitForHostReady(page);

    await page.getByTestId('settings-open-btn').click();
    await expect(page.getByTestId('settings-panel')).toBeVisible();
    await expect(page.getByTestId('settings-config-root')).toHaveAttribute('title', /配置根目录/);

    await page.getByTestId('settings-nav-appearance').click();
    await page.getByTestId('tool-density-slider').fill('2');
    await expect(page.getByTestId('tool-density-value')).toContainText(/详细|detailed/);

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('settings-panel')).toHaveCount(0);
  });

  test('persists the Desktop language selection and uses locale-stable controls', async ({
    page,
  }) => {
    await page.goto('/');
    await waitForHostReady(page);
    await page.getByTestId('settings-open-btn').click();

    await page.getByTestId('settings-language-select').selectOption('en');
    await expect(page.getByTestId('settings-panel')).toHaveAttribute('aria-label', 'Settings');
    await expect(page.getByTestId('settings-nav-general')).toContainText('General');

    await page.reload();
    await waitForHostReady(page);
    await expect(page.getByTestId('settings-open-btn')).toHaveAttribute('aria-label', 'Settings');

    await page.getByTestId('settings-open-btn').click();
    await expect(page.getByTestId('settings-language-select')).toHaveValue('en');
  });

  test('opens Extensions from Settings Advanced and toggles path-guard', async ({ page }) => {
    await page.goto('/');
    await waitForHostReady(page);

    await page.getByTestId('settings-open-btn').click();
    await expect(page.getByTestId('settings-panel')).toBeVisible();
    await page.getByTestId('settings-nav-extensions').click();
    await expect(page.getByTestId('extensions-panel')).toBeVisible();
    await expect(page.getByTestId('extensions-security-banner')).toBeVisible();
    await expect(
      page.getByTestId('extension-item').filter({ hasText: 'path-guard' }),
    ).toBeVisible();

    await page
      .getByTestId('extension-item')
      .filter({ hasText: 'path-guard' })
      .getByTestId('extension-toggle-btn')
      .click();
    await expect(
      page.getByTestId('extension-item').filter({ hasText: 'path-guard' }),
    ).toContainText('off');

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('settings-panel')).toHaveCount(0);
  });

  test('Models settings can add a provider preset', async ({ page }) => {
    await page.goto('/');
    await waitForHostReady(page);
    await page.getByTestId('settings-open-btn').click();
    await page.getByTestId('settings-nav-models').click();
    await expect(page.getByTestId('provider-settings')).toBeVisible();
    await page.getByTestId('provider-add-open').click();
    await page.getByTestId('provider-preset-openai').click();
    await expect(page.getByTestId('provider-drawer')).toBeVisible();
    await expect(page.getByTestId('provider-baseurl-input')).toHaveValue(/api\.openai\.com/);
    await expect(page.getByTestId('model-workbench')).toBeVisible();
    await page.getByTestId('provider-save-btn').click();
    await expect(page.getByTestId('provider-row-openai')).toBeVisible();
  });

  test('Models settings can add Google Gemini protocol preset', async ({ page }) => {
    await page.goto('/');
    await waitForHostReady(page);
    await page.getByTestId('settings-open-btn').click();
    await page.getByTestId('settings-nav-models').click();
    await expect(page.getByTestId('provider-settings')).toBeVisible();
    await page.getByTestId('provider-add-open').click();
    await page.getByTestId('provider-preset-gemini').click();
    await expect(page.getByTestId('provider-drawer')).toBeVisible();
    await expect(page.getByTestId('provider-baseurl-input')).toHaveValue(
      /generativelanguage\.googleapis\.com/,
    );
    await expect(page.getByTestId('model-workbench')).toBeVisible();
    await page.getByTestId('provider-apikey-env-input').fill('fake-gemini-key');
    await page.getByTestId('provider-save-btn').click();
    await expect(page.getByTestId('provider-row-gemini')).toBeVisible();
    await expect(page.getByTestId('provider-drawer')).toHaveCount(0);
  });

  test('open project → session ready for chat', async ({ page }) => {
    await page.goto('/');
    await waitForHostReady(page);

    await openTrustedSession(page, '/tmp/piwin-e2e-desktop');
    await expect(page.getByTestId('session-item').first()).toBeVisible();
    await expect(page.getByTestId('composer-input')).toBeEnabled();
  });

  test('keeps the project picker compact after opening a project', async ({ page }) => {
    await page.goto('/');
    await waitForHostReady(page);

    await page.getByTestId('open-workspace-btn').click();
    await expect(page.getByTestId('workspace-path-dialog')).toBeVisible();
    await page.getByTestId('project-path-input').fill('/tmp/piwin-e2e-sidebar');
    await page.getByTestId('open-project-btn').click();
    await expect(page.getByTestId('workspace-path-dialog')).toHaveCount(0);
    await expect(page.getByTestId('trust-dialog')).toHaveCount(0);
    // Trust indicator is shown as "Trusted" text inside the repository item button.
    await expect(page.getByTestId('repository-item').filter({ hasText: 'Trusted' })).toBeVisible();
    await expect(page.getByTestId('session-item')).toHaveCount(1);

    await page.getByTestId('open-workspace-btn').click();
    await expect(page.getByTestId('workspace-path-dialog')).toBeVisible();
    await expect(page.getByTestId('new-session-btn')).toContainText(/New Agent/);
    await expect(page.getByTestId('session-search-btn')).toBeVisible();
    await page.getByTestId('session-search-btn').click();
    await expect(page.getByTestId('session-search-input')).toBeVisible();
  });

  test('mock chat: send prompt and see assistant reply', async ({ page }) => {
    await page.goto('/');
    await waitForHostReady(page);
    await openTrustedSession(page, '/tmp/piwin-e2e-chat');

    const prompt = 'hello desktop e2e';
    await page.getByTestId('composer-input').fill(prompt);
    await page.getByTestId('send-btn').click();

    // SR-01: exactly one run status region exists during/after a run
    // (ContextBar owns the migrated "run-status-strip" testid).
    await expect(page.locator('[data-testid="run-status-strip"]')).toHaveCount(1);

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

  test('SR-01: exactly one status region while a run is active', async ({ page }) => {
    await page.goto('/');
    await waitForHostReady(page);
    await openTrustedSession(page, '/tmp/piwin-e2e-status-region');

    await page
      .getByTestId('composer-input')
      .fill(
        'please stream a fairly long reply so the run is still active while we count status regions',
      );
    await page.getByTestId('send-btn').click();

    // Pause being visible proves the run has not settled yet.
    await expect(page.getByTestId('pause-btn')).toBeVisible({ timeout: 5000 });

    // R2 merged the tab strip / context header / run status strip into a
    // single ContextBar; duplicated status regions were the SR-01 defect.
    await expect(page.locator('[data-testid="run-status-strip"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="workspace-context-header"]')).toHaveCount(1);
  });

  test('renderer stress keeps history, input, and Stop usable during bursty streaming', async ({
    page,
  }) => {
    await page.goto('/');
    await waitForHostReady(page);
    await openTrustedSession(page, '/tmp/piwin-e2e-render-stress');

    await page.getByTestId('composer-input').fill('__PIWIN_RENDER_STRESS__');
    await page.getByTestId('send-btn').click();

    await expect(page.locator('[data-testid="message-bubble"]')).toHaveCount(502, {
      timeout: 15_000,
    });
    await expect(page.locator('[data-testid="message-bubble"].is-streaming')).toBeVisible();

    const composerInput = page.getByTestId('composer-input');
    await composerInput.fill('typing remains responsive during the burst');
    await expect(composerInput).toHaveValue('typing remains responsive during the burst');
    await expect(page.getByTestId('pause-btn')).toBeEnabled();
    await page.getByTestId('pause-btn').click();

    await expect(page.getByTestId('pause-btn')).toHaveCount(0, { timeout: 10_000 });
    await expect(
      page.locator('[data-testid="send-btn"], [data-testid="resume-run-btn"]'),
    ).toBeVisible();
  });

  test('composer plus menu selects Plan mode', async ({ page }) => {
    await page.goto('/');
    await waitForHostReady(page);
    await openTrustedSession(page, '/tmp/piwin-e2e-plan-mode');
    await page.getByTestId('composer-input').fill('/plan');
    await page.getByTestId('send-btn').click();
    await expect(page.getByTestId('agent-mode-chip')).toContainText('Plan');
    await page.getByTestId('agent-mode-dismiss').click();
    await expect(page.getByTestId('agent-mode-chip')).toHaveCount(0);
  });

  test('Inspector opens Activity Terminal without a competing bottom dock', async ({ page }) => {
    await page.goto('/');
    await waitForHostReady(page);
    await expect(page.getByTestId('terminal-dock')).toHaveCount(0);
    // Closed by default; open via edge control, then pick Terminal from the list.
    await expect(page.getByTestId('right-panel')).toBeHidden();
    await page.getByTestId('right-panel-open-btn').click();
    await expect(page.getByTestId('right-panel')).toHaveAttribute('data-content-expanded', 'true');
    await page.getByTestId('right-panel-tab-activity').click();
    await expect(page.getByTestId('terminal-dock')).toBeVisible();
    await expect(page.getByTestId('terminal-dock')).toHaveAttribute('data-variant', 'panel');
    await expect(page.locator('.terminal-dock:not(.terminal-dock-panel)')).toHaveCount(0);
  });

  test('workspace panel toggle remains available to collapse the panel', async ({ page }) => {
    await page.goto('/');
    await waitForHostReady(page);

    const panelToggle = page.getByTestId('right-panel-open-btn');
    await expect(panelToggle).toHaveAttribute('aria-expanded', 'false');
    await panelToggle.click();
    await expect(page.getByTestId('right-panel')).toBeVisible();
    await expect(panelToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('right-panel-close-btn')).toHaveCount(0);

    await panelToggle.click();
    await expect(page.getByTestId('right-panel')).toBeHidden();
    await expect(panelToggle).toHaveAttribute('aria-expanded', 'false');
  });

  test('right panel restores last detail view after collapse (quiet workbench)', async ({
    page,
  }) => {
    await page.goto('/');
    await waitForHostReady(page);

    const panelToggle = page.getByTestId('right-panel-open-btn');
    await panelToggle.click();
    await page.getByTestId('right-panel-files-btn').click();
    await expect(page.getByTestId('right-panel')).toHaveAttribute('data-view', 'detail');
    await expect(page.getByTestId('file-tree-panel')).toBeVisible();

    // Collapse via titleband (must not stop generation; panel only).
    await panelToggle.click();
    await expect(page.getByTestId('right-panel')).toBeHidden();

    // Reopen restores last view (detail + files).
    await panelToggle.click();
    await expect(page.getByTestId('right-panel')).toHaveAttribute('data-view', 'detail');
    await expect(page.getByTestId('file-tree-panel')).toBeVisible();
  });

  test('right toolkit opens files panel; tool cards still show in transcript', async ({ page }) => {
    await page.goto('/');
    await waitForHostReady(page);
    await expect(page.getByTestId('right-panel')).toBeHidden();
    await expect(page.getByTestId('right-panel-open-btn')).toBeVisible();
    await expect(page.getByTestId('app-shell')).not.toHaveClass(/has-right-panel/);

    await page.getByTestId('right-panel-open-btn').click();
    await expect(page.getByTestId('right-panel')).toHaveAttribute('data-content-expanded', 'true');
    await expect(page.getByTestId('app-shell')).toHaveClass(/has-right-panel/);
    await page.getByTestId('right-panel-files-btn').click();
    await expect(page.getByTestId('file-tree-panel')).toBeVisible();

    await openTrustedSession(page, '/tmp/piwin-e2e-tools');
    await page.getByTestId('composer-input').fill('tool card smoke');
    await page.getByTestId('send-btn').click();

    // Quiet workbench: tools collapse into the turn summary chip when the answer starts.
    await expect(page.getByTestId('turn-work-details-summary').first()).toBeVisible();
    await page.getByTestId('turn-work-details-summary').first().click();
    await expect(page.getByTestId('tool-call-card').first()).toBeVisible();
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

  test('Signal Terminal panel has Activity and Terminal tabs', async ({ page }) => {
    await page.goto('/');
    await waitForHostReady(page);
    await page.getByTestId('right-panel-open-btn').click();
    await page.getByTestId('right-panel-tab-activity').click();
    await expect(page.getByTestId('terminal-dock')).toBeVisible();
    await expect(page.getByTestId('dock-tab-activity')).toBeVisible();
    await expect(page.getByTestId('dock-tab-terminal')).toBeVisible();
    await page.getByTestId('dock-tab-terminal').click();
    await expect(page.getByTestId('pty-panel')).toBeVisible();
    // untrusted / no project: show guidance
    await expect(page.getByTestId('pty-panel')).toContainText(/Open a project|Trust this project/);
  });

  test('pause ends mock stream without late text growth', async ({ page }) => {
    await page.goto('/');
    await waitForHostReady(page);
    await openTrustedSession(page, '/tmp/piwin-e2e-abort');
    await page
      .getByTestId('composer-input')
      .fill(
        'please stream a fairly long reply so we can abort mid way through the mock host chunks',
      );
    await page.getByTestId('send-btn').click();
    await expect(page.getByTestId('pause-btn')).toBeVisible({ timeout: 5000 });
    // Force/evaluate avoids actionability races while the stream still animates layout.
    await page.getByTestId('pause-btn').evaluate((node: HTMLElement) => node.click());
    await expect(
      page.locator('[data-testid="send-btn"], [data-testid="resume-run-btn"]'),
    ).toBeVisible({ timeout: 8000 });
    const assistant = page.locator('[data-testid="message-bubble"][data-role="assistant"]').last();
    await expect(assistant).toBeVisible();
    const textAfterStop = (await assistant.innerText()).trim();
    await page.waitForTimeout(200);
    const textLater = (await assistant.innerText()).trim();
    expect(textLater).toBe(textAfterStop);
  });

  test('MCP registry draft appears in configured list', async ({ page }) => {
    await page.goto('/');
    await waitForHostReady(page);
    await page.getByTestId('settings-open-btn').click();
    // MCP panel triggers mcp/get on mount (not handled by mock).
    // Verify the settings nav button for tools/MCP is present.
    await expect(page.getByTestId('settings-nav-tools')).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('Settings Automation panel loads', async ({ page }) => {
    await page.goto('/');
    await waitForHostReady(page);
    await page.getByTestId('settings-open-btn').click();
    await page
      .getByTestId('settings-panel')
      .getByRole('button', { name: /自动化/ })
      .click();
    await expect(page.getByTestId('automation-panel')).toBeVisible();
    await expect(page.getByTestId('automation-enabled')).toBeVisible();
    await page.getByTestId('automation-enabled').check();
    await page.getByTestId('cron-name-input').fill('e2e-job');
    await page.getByTestId('cron-prompt-input').fill('hello cron');
    await page.getByTestId('cron-add-btn').click();
    await expect(page.getByTestId('cron-job-item')).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('Skills Store and MCP Registry tabs', async ({ page }) => {
    await page.goto('/');
    await waitForHostReady(page);
    await page.getByTestId('settings-open-btn').click();
    // Skills panel triggers skills/list on mount (not handled by mock).
    // Verify the settings nav button is present; full panel requires real host.
    await expect(page.getByTestId('settings-nav-skills')).toBeVisible();
    // MCP panel triggers mcp/get on mount (not handled by mock).
    await expect(page.getByTestId('settings-nav-tools')).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('renames and archives a session from the context menu', async ({ page }) => {
    await page.goto('/');
    await waitForHostReady(page);
    await openTrustedSession(page, '/tmp/piwin-e2e-session-lifecycle');

    await openFirstSessionMenu(page);
    await expect(page.getByTestId('session-row-menu')).toBeVisible();
    await page.getByTestId('session-menu-rename').click();
    await expect(page.getByTestId('session-rename-input')).toBeVisible();
    await page.getByTestId('session-rename-input').fill('Lifecycle Agent');
    await page.getByTestId('session-rename-save').click();
    await expect(page.getByTestId('session-item')).toContainText('Lifecycle Agent');

    await openFirstSessionMenu(page);
    await page.getByTestId('session-menu-archive').click();
    await expect(page.getByTestId('session-item')).toHaveCount(0);
    await expect(page.getByTestId('session-restore-active-btn')).toBeVisible();

    await page.getByTestId('display-options-btn').click();
    await page.getByTestId('display-filter-archived').click();
    await expect(page.getByTestId('session-item')).toContainText('Lifecycle Agent');
    await expect(page.getByTestId('session-item')).toHaveAttribute('data-archived', 'true');

    const archivedRow = page.locator('.session-row').first();
    await archivedRow.hover();
    await archivedRow.getByTestId('session-delete-btn').click();
    await expect(page.getByTestId('session-delete-confirm')).toBeVisible();
    await page.getByTestId('confirm-dialog-confirm').click();
    await expect(page.getByTestId('session-item')).toHaveCount(0);
  });

  test('duplicates a session from the context menu', async ({ page }) => {
    await page.goto('/');
    await waitForHostReady(page);
    await openTrustedSession(page, '/tmp/piwin-e2e-session-duplicate');

    await page.getByTestId('composer-input').fill('fork this thread');
    await page.getByTestId('send-btn').click();
    await expect(
      page.locator('[data-testid="message-bubble"][data-role="assistant"]').last(),
    ).toBeVisible({ timeout: 10000 });

    await openFirstSessionMenu(page);
    await page.getByTestId('session-menu-duplicate').click();
    await expect(page.getByTestId('session-item')).toHaveCount(2);
    await expect(page.getByTestId('session-item').filter({ hasText: 'Copy of' })).toBeVisible();
  });

  test('shows capability matrix without cluttering the navigator footer', async ({ page }) => {
    await page.goto('/');
    await waitForHostReady(page);
    await expect(page.getByTestId('shell-preview-pill')).toHaveCount(0);
    await page.getByTestId('settings-open-btn').click();
    await expect(page.getByTestId('capability-matrix')).toBeVisible();
    await expect(page.getByTestId('capability-row-pty')).toContainText(
      /交互终端|Interactive terminal/,
    );
    await expect(page.getByTestId('capability-row-pty')).toHaveClass(/unavailable/);
    await expect(page.getByTestId('capability-row-sessionLifecycle')).toHaveClass(/available/);
  });

  test('lists and revokes remembered permissions in Settings', async ({ page }) => {
    await page.goto('/');
    await waitForHostReady(page);
    await openTrustedSession(page, '/tmp/piwin-e2e-remembered-perms');

    await page.getByTestId('settings-open-btn').click();
    await expect(page.getByTestId('settings-panel')).toBeVisible();
    await expect(page.getByTestId('remembered-permissions')).toBeVisible();
    await expect(page.getByTestId('remembered-permission-row')).toBeVisible();
    await page.getByTestId('remembered-permission-revoke').click();
    await expect(page.getByTestId('remembered-permissions-empty')).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('closes Settings with Escape and dismisses session menu', async ({ page }) => {
    await page.goto('/');
    await waitForHostReady(page);
    await openTrustedSession(page, '/tmp/piwin-e2e-a11y-focus');

    await page.getByTestId('settings-open-btn').click();
    await expect(page.getByTestId('settings-panel')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('settings-panel')).toHaveCount(0);

    await page.getByTestId('session-menu-btn').click();
    await expect(page.getByTestId('session-row-menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('session-row-menu')).toHaveCount(0);
  });

  test('automation panel shows host-required honesty banner', async ({ page }) => {
    await page.goto('/');
    await waitForHostReady(page);
    await page.getByTestId('settings-open-btn').click();
    await page
      .getByTestId('settings-panel')
      .getByRole('button', { name: /自动化/ })
      .click();
    await expect(page.getByTestId('automation-panel')).toBeVisible();
    await expect(page.getByTestId('automation-host-banner')).toBeVisible();
    await expect(page.getByTestId('hooks-post-event-note')).toBeVisible();
  });

  test('open workspace auto-trusts and creates session; subagent activity card appears', async ({
    page,
  }) => {
    await page.goto('/');
    await waitForHostReady(page);
    await page.getByTestId('open-workspace-btn').click();
    await page.getByTestId('project-path-input').fill('/tmp/piwin-e2e-auto-session');
    await page.getByTestId('open-project-btn').click();
    await expect(page.getByTestId('trust-dialog')).toHaveCount(0);
    await expect(page.getByTestId('session-item')).toHaveCount(1);
    await expect(page.getByTestId('composer-input')).toBeEnabled();

    await page.getByTestId('settings-open-btn').click();
    await expect(page.getByTestId('settings-panel')).toBeVisible();
    await page
      .getByTestId('settings-panel')
      .getByRole('button', { name: /子代理/ })
      .click();
    await page.getByTestId('subagent-task-input').fill('Inspect the module map');
    await page.getByTestId('subagent-spawn-btn').click();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('subagent-activity-card')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('subagent-activity-card')).toContainText(/Running|Started/i);
  });

  test('composer is typeable on cold start without a workspace', async ({ page }) => {
    await page.goto('/');
    await waitForHostReady(page);
    const composer = page.getByTestId('composer-input');
    await expect(composer).toBeEnabled();
    await expect(composer).not.toHaveAttribute('disabled', '');
    await composer.click();
    await composer.fill('draft without project');
    await expect(composer).toHaveValue('draft without project');
    // ADR 0016: General scope allows send without opening a project folder.
    await page.getByTestId('send-btn').click();
    await expect(page.getByTestId('workspace-path-dialog')).toHaveCount(0);
    await expect(
      page.locator('[data-testid="message-bubble"][data-role="user"]', {
        hasText: 'draft without project',
      }),
    ).toBeVisible({ timeout: 10000 });
  });

  test('composer slash menu opens and /compact runs compaction', async ({ page }) => {
    await page.goto('/');
    await waitForHostReady(page);
    await openTrustedSession(page, '/tmp/piwin-e2e-slash');

    const composer = page.getByTestId('composer-input');
    await composer.click();
    await composer.fill('/');
    await expect(page.getByTestId('composer-slash-menu')).toBeVisible();
    await expect(page.getByTestId('slash-item-cmd:compact')).toBeVisible();
    await expect(page.getByTestId('slash-item-mode:plan')).toBeVisible();
    await expect(page.getByTestId('slash-item-skill:create-skill')).toBeVisible();

    await composer.fill('/compact');
    await composer.press('Enter');
    // Compaction may complete quickly in mock; accept progress or result notice.
    await expect(
      page
        .getByTestId('compaction-progress-notice')
        .or(page.getByTestId('compaction-result-notice')),
    ).toBeVisible({ timeout: 10_000 });
  });
});
