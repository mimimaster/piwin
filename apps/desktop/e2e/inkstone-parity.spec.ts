import { expect, test, type Page } from '@playwright/test';

async function boot(page: Page, path = '/'): Promise<void> {
  await page.goto(path);
  await page.getByRole('button', { name: '使用本机', exact: true }).click();
  await expect(page.getByTestId('agent-mode-pill')).toHaveText('mock');
  await expect(page.getByTestId('composer-input')).toBeVisible();
}

async function switchToPaper(page: Page): Promise<void> {
  if (await page.locator('html').getAttribute('data-theme-id') === 'piwin-inkstone-ink') {
    await page.getByTestId('titlebar-theme-toggle').click();
  }
  await expect(page.locator('html')).toHaveAttribute('data-theme-id', 'piwin-inkstone-paper');
}

async function assertShellGeometry(page: Page): Promise<void> {
  const shell = page.getByTestId('app-shell');
  await expect(shell).toHaveCSS('row-gap', '0px');
  await expect(page.locator('.workspace')).toHaveCSS('border-radius', '8px');
  // The titleband owns the window-top row; the three panels start below it.
  await expect(page.locator('.chat-column')).toHaveCSS('padding-top', '0px');
  await expect(page.getByTestId('composer-input')).toHaveCSS('min-height', '52px');
  await expect(page.locator('.slab')).toHaveCSS('border-radius', '10px');
  const title = await page.getByTestId('workspace-context-header').boundingBox();
  const workspace = await page.locator('.workspace').boundingBox();
  expect(title).not.toBeNull();
  expect(workspace).not.toBeNull();
  if (!title || !workspace) throw new Error('Missing shell panels');
  expect(workspace.y).toBe(title.y + title.height);
  expect(title.height).toBe(30);
}

test('default startup, paper/ink flips and empty slab retain prototype geometry', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await boot(page);
  await switchToPaper(page);
  await assertShellGeometry(page);
  await expect(page.locator('.slab')).toHaveCSS('background-color', 'rgb(31, 28, 24)');
  await page.getByTestId('titlebar-theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme-id', 'piwin-inkstone-ink');
  await expect(page.locator('.slab')).toHaveCSS('background-color', 'rgb(14, 13, 11)');
  await assertShellGeometry(page);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme-id', 'piwin-inkstone-ink');
});

test('general Chat uses aligned paper cards and menus escape the composer', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await boot(page);
  await switchToPaper(page);
  await page.getByTestId('composer-input').fill('Inkstone layout check');
  await page.getByTestId('send-btn').click();
  await expect(page.getByTestId('conversation-response')).toContainText('piwin desktop mock reply');
  const prompt = page.locator('.user-message-bubble');
  await expect(prompt).toHaveCSS('border-radius', '8px');
  await expect(page.locator('.conversation-response')).toHaveCSS('padding-left', '0px');
  const promptBox = await prompt.boundingBox();
  const responseBox = await page.getByTestId('conversation-response').boundingBox();
  expect(promptBox).not.toBeNull();
  expect(responseBox).not.toBeNull();
  if (!promptBox || !responseBox) throw new Error('Missing conversation content');
  expect(Math.abs(promptBox.x - responseBox.x)).toBeLessThan(2);
  const slabBox = await page.locator('.composer-dock .composer-card-v2').boundingBox();
  expect(slabBox).not.toBeNull();
  if (!slabBox) throw new Error('Missing composer slab');
  expect(Math.abs(slabBox.width - responseBox.width)).toBeLessThan(3);
  expect(Math.abs(slabBox.x - responseBox.x)).toBeLessThan(3);
  await page.setViewportSize({ width: 1800, height: 900 });
  const responseWide = await page.getByTestId('conversation-response').boundingBox();
  const slabWide = await page.locator('.composer-dock .composer-card-v2').boundingBox();
  expect(responseWide).not.toBeNull();
  expect(slabWide).not.toBeNull();
  if (!responseWide || !slabWide) throw new Error('Missing boxes after stretch');
  expect(Math.abs(slabWide.width - responseWide.width)).toBeLessThan(3);
  expect(Math.abs(slabWide.x - responseWide.x)).toBeLessThan(3);
  await page.getByTestId('composer-plus-btn').click();
  await expect(page.getByRole('menu', { name: '添加文件和上下文' })).toBeVisible();
  await expect(page.locator('.slab')).toHaveCSS('overflow', 'visible');
});

test('inspector does not remove the full-window titlebar tools', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await boot(page);
  await switchToPaper(page);
  await page.getByTestId('open-workspace-btn').click();
  await page.getByTestId('project-path-input').fill('/tmp/inkstone-parity');
  await page.getByTestId('open-project-btn').click();
  await expect(page.getByTestId('workspace-path-dialog')).toHaveCount(0);
  await page.getByTestId('workspace-context-header').getByTestId('right-panel-open-btn').click();
  await expect(page.getByRole('complementary', { name: '工作区面板' })).toBeVisible();
  await expect(page.getByTestId('titlebar-theme-toggle')).toBeVisible();
  await expect(page.getByTestId('session-search-btn-sb-top')).toBeVisible();
  await assertShellGeometry(page);
  await page.setViewportSize({ width: 1000, height: 760 });
  await expect(page.getByTestId('composer-input')).toBeVisible();
  const bodyWidth = await page.locator('body').evaluate((element) => element.scrollWidth);
  expect(bodyWidth).toBeLessThanOrEqual(1000);
});

test('settings panels sit flush under the titleband like the main shell', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await boot(page);
  await switchToPaper(page);
  const workspace = await page.locator('.workspace').boundingBox();
  expect(workspace).not.toBeNull();
  if (!workspace) throw new Error('Missing workspace');

  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByTestId('settings-appearance')).toBeVisible();

  const dialog = page.locator('.settings-modal-dialog');
  await expect(dialog).toHaveCSS('row-gap', '0px');
  await expect(dialog).toHaveCSS('column-gap', '8px');

  const title = await page.getByTestId('settings-titlebar').boundingBox();
  const nav = await page.locator('.settings-nav').boundingBox();
  const main = await page.locator('.settings-main').boundingBox();
  expect(title).not.toBeNull();
  expect(nav).not.toBeNull();
  expect(main).not.toBeNull();
  if (!title || !nav || !main) throw new Error('Missing settings chrome');
  expect(title.height).toBe(30);
  expect(nav.y).toBe(title.y + title.height);
  expect(main.y).toBe(title.y + title.height);
  expect(nav.y).toBe(workspace.y);

  for (const section of ['permissions', 'web'] as const) {
    await page.getByTestId(`settings-nav-${section}`).click();
    const navBox = await page.locator('.settings-nav').boundingBox();
    const mainBox = await page.locator('.settings-main').boundingBox();
    expect(navBox?.y).toBe(title.y + title.height);
    expect(mainBox?.y).toBe(title.y + title.height);
  }

  await page.setViewportSize({ width: 700, height: 800 });
  const compactNav = await page.locator('.settings-nav').boundingBox();
  expect(compactNav).not.toBeNull();
  if (!compactNav) throw new Error('Missing compact settings nav');
  const compactTitle = await page.getByTestId('settings-titlebar').boundingBox();
  expect(compactTitle).not.toBeNull();
  if (!compactTitle) throw new Error('Missing compact settings titlebar');
  expect(compactNav.y).toBe(compactTitle.y + compactTitle.height);
});

test('appearance settings stay readable and the product mode controls work', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await boot(page);
  await switchToPaper(page);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByTestId('settings-appearance')).toBeVisible();
  const content = page.locator('.settings-main-content');
  const main = page.locator('.settings-main');
  const at1440 = await content.boundingBox();
  const mainAt1440 = await main.boundingBox();
  expect(at1440).not.toBeNull();
  expect(mainAt1440).not.toBeNull();
  if (!at1440 || !mainAt1440) throw new Error('Missing settings layout');
  expect(at1440.width).toBeGreaterThan(840);
  expect(Math.abs(mainAt1440.width - at1440.width)).toBeLessThan(24);
  await page.setViewportSize({ width: 1800, height: 900 });
  const at1800 = await content.boundingBox();
  expect(at1800).not.toBeNull();
  if (!at1800) throw new Error('Missing settings layout after resize');
  expect(at1800.width).toBeGreaterThan(at1440.width);
  await page.setViewportSize({ width: 1440, height: 900 });
  const inkstone = page.getByTestId('inkstone-theme-preview');
  await expect(inkstone).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('inkstone-theme-background')).not.toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('inkstone-appearance-paper.png') });
  await page.locator('[data-testid="appearance-mode-control"] input[value="dark"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme-id', 'piwin-inkstone-ink');
  await page.screenshot({ path: testInfo.outputPath('inkstone-appearance-ink.png') });
  await page.locator('.appearance-color-disclosure').first().getByText('自定义配色', { exact: true }).click();
  await expect(page.getByTestId('inkstone-theme-background')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme-id', 'piwin-inkstone-ink');
  await page.getByText('Narrow', { exact: true }).click();
  await page.getByRole('button', { name: '返回工作区', exact: true }).click();
  await expect(page.getByTestId('composer-input')).toBeVisible();
  await expect(page.locator('.slab')).toHaveCSS('width', '640px');
});


test('prototype Agent scene keeps body, process, composer and keyboard tabs aligned', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await boot(page, '/?e2eInkstone=1');
  await switchToPaper(page);
  await page.getByTestId('open-workspace-btn').click();
  await page.getByTestId('project-path-input').fill('/mock/piwin');
  await page.getByTestId('open-project-btn').click();
  await page.getByRole('button', { name: 'Composer 忙会话队列', exact: true }).click();
  await expect(page.getByRole('heading', { name: '已改为排队语义' })).toBeVisible();
  await page.getByTestId('workspace-context-header').getByTestId('right-panel-open-btn').click();
  await page.getByRole('button', { name: '文件', exact: true }).click();
  const fileTab = page.getByRole('tab', { name: '文件', exact: true });
  await expect(fileTab).toHaveAttribute('aria-selected', 'true');
  await expect(fileTab).toHaveAttribute('aria-controls', 'inspector-panel-files');
  await page.getByRole('button', { name: '打开面板', exact: true }).click();
  await page.getByRole('menuitem', { name: '变更', exact: true }).click();
  await fileTab.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: /^变更/ })).toHaveAttribute('aria-selected', 'true');
  await page.getByTestId('turn-work-details-summary').click();
  const body = page.locator('.turn-work-details > .markdown');
  await expect(body).toHaveCSS('font-size', '14.5px');
  await expect(page.locator('.slab')).toHaveCSS('width', '720px');
  const bodyBox = await body.boundingBox();
  const composerBox = await page.locator('.slab').boundingBox();
  expect(bodyBox?.x).toBe(composerBox?.x);
  // Read from the start of the fixture, independent of the normal follow-tail position.
  await page.locator('.chat-stream').evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: testInfo.outputPath('inkstone-agent-paper.png') });
  await page.getByTestId('titlebar-theme-toggle').click();
  await page.screenshot({ path: testInfo.outputPath('inkstone-agent-ink.png') });
});
