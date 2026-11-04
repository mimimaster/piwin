import { expect, test } from '@playwright/test';

test('wide touch layout keeps the composer accessible when the viewport shrinks', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.goto('/');
  const chooseSidecar = page.getByTestId('host-gate-choose-sidecar');
  if (await chooseSidecar.isVisible()) await chooseSidecar.click();
  const shell = page.getByTestId('app-shell');
  const input = page.getByTestId('composer-input');
  await expect(shell).toHaveAttribute('data-layout', 'desktop');
  await expect(input).toBeVisible();
  await input.fill('draft across resizing');
  await expect(input).toHaveCSS('font-size', '16px');
  for (const id of ['rail-chats-btn', 'composer-plus-btn']) {
    const box = await page.getByTestId(id).boundingBox();
    expect(box, id).not.toBeNull();
    expect(box?.width, id).toBeGreaterThanOrEqual(44);
    expect(box?.height, id).toBeGreaterThanOrEqual(44);
  }
  await page.evaluate(() => document.documentElement.style.setProperty('--app-vv-height', '650px'));
  await expect.poll(async () => (await shell.boundingBox())?.height).toBe(650);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(shell).toHaveAttribute('data-layout', 'phone');
  await expect(input).toHaveValue('draft across resizing');
  await page.setViewportSize({ width: 820, height: 1180 });
  await expect(shell).toHaveAttribute('data-layout', 'desktop');
  await expect(input).toHaveValue('draft across resizing');
});

test('wide touch settings follows the visible viewport and safe top', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.goto('/');
  const chooseSidecar = page.getByTestId('host-gate-choose-sidecar');
  if (await chooseSidecar.isVisible()) await chooseSidecar.click();
  await expect(page.getByTestId('app-shell')).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--app-safe-top', '24px');
    document.documentElement.style.setProperty('--app-safe-left', '30px');
    document.documentElement.style.setProperty('--app-safe-right', '50px');
  });
  await expect.poll(async () => (await page.getByTestId('rail-chats-btn').boundingBox())?.y).toBeGreaterThanOrEqual(24);
  await page.getByTestId('settings-open-shelf-btn').click();
  const settings = page.getByTestId('settings-panel');
  await expect(settings).toBeVisible();
  await expect.poll(async () => (await page.getByTestId('settings-back-button').boundingBox())?.y).toBeGreaterThanOrEqual(24);
  const titlebar = await page.getByTestId('settings-titlebar').boundingBox();
  expect(titlebar?.x).toBeGreaterThanOrEqual(30);
  expect((titlebar?.x ?? 0) + (titlebar?.width ?? 0)).toBeLessThanOrEqual(770);
  await page.evaluate(() => document.documentElement.style.setProperty('--app-vv-height', '650px'));
  await expect.poll(async () => (await settings.boundingBox())?.height).toBe(650);
  await page.getByTestId('settings-back-button').click();
  await expect(settings).toBeHidden();
});

test('wide touch library respects safe areas and the visible viewport', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.goto('/');
  const chooseSidecar = page.getByTestId('host-gate-choose-sidecar');
  if (await chooseSidecar.isVisible()) await chooseSidecar.click();
  await page.evaluate(() => document.documentElement.style.setProperty('--app-safe-top', '24px'));
  await page.getByTestId('sidebar-library-btn').click();
  const library = page.getByTestId('library-workspace');
  await expect(library).toBeVisible();
  const toolbar = library.locator('.vault-bar').first();
  await expect.poll(async () => (await toolbar.boundingBox())?.y).toBeGreaterThanOrEqual(24);
  await page.evaluate(() => document.documentElement.style.setProperty('--app-vv-height', '650px'));
  await expect.poll(async () => (await library.boundingBox())?.height).toBe(650);
});

for (const width of [390, 820]) {
  test(`session search stays in the visible viewport at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    const chooseSidecar = page.getByTestId('host-gate-choose-sidecar');
    if (await chooseSidecar.isVisible()) await chooseSidecar.click();
    await expect(page.getByTestId('app-shell')).toBeVisible();
    if (width < 768) await page.getByTestId('rail-chats-btn').click();
    await page.getByTestId('session-search-btn-sb-top').click();
    const dialog = page.getByTestId('session-search-dialog');
    await expect(dialog).toBeVisible();
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--app-vv-height', '450px');
      document.documentElement.style.setProperty('--app-safe-top', '24px');
      document.documentElement.style.setProperty('--app-safe-left', '30px');
      document.documentElement.style.setProperty('--app-safe-right', '50px');
    });
    await expect.poll(async () => {
      const box = await dialog.boundingBox();
      return box === null ? Infinity : box.y + box.height;
    }).toBeLessThanOrEqual(450);
    const box = await dialog.boundingBox();
    expect(box?.x).toBeGreaterThanOrEqual(30);
    expect(box?.y).toBeGreaterThanOrEqual(24);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width - 50);
    await expect(page.getByTestId('session-search-input')).toBeVisible();
  });
}

test('phone controls and drawers avoid asymmetric side insets', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const chooseSidecar = page.getByTestId('host-gate-choose-sidecar');
  if (await chooseSidecar.isVisible()) await chooseSidecar.click();
  await expect(page.getByTestId('app-shell')).toHaveAttribute('data-layout', 'phone');
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--app-safe-left', '30px');
    document.documentElement.style.setProperty('--app-safe-right', '50px');
  });
  const checkSafe = async (selector: string): Promise<void> => {
    await expect.poll(async () => (await page.locator(selector).boundingBox())?.x).toBeGreaterThanOrEqual(30);
    const box = await page.locator(selector).boundingBox();
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(340);
  };
  await checkSafe('.app-shell > .context-bar');
  await page.getByTestId('right-panel-open-btn').click();
  await expect(page.getByTestId('right-panel')).toBeVisible();
  await checkSafe('.app-shell > .right-panel');
  await page.getByTestId('right-panel-close-btn').click();
  await page.getByTestId('rail-chats-btn').click();
  await expect(page.getByTestId('sidebar-close-btn')).toBeVisible();
  await checkSafe('.app-shell > .sidebar');
  await page.getByTestId('settings-open-shelf-btn').click();
  await expect(page.getByTestId('settings-panel')).toBeVisible();
  await checkSafe('.settings-titlebar');
  await page.evaluate(() => document.documentElement.style.setProperty('--app-vv-height', '450px'));
  await expect.poll(async () => (await page.getByTestId('settings-panel').boundingBox())?.height).toBe(450);
});

test('wide inspector uses the safe content width when insets change', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/');
  const chooseSidecar = page.getByTestId('host-gate-choose-sidecar');
  if (await chooseSidecar.isVisible()) await chooseSidecar.click();
  const shell = page.getByTestId('app-shell');
  await expect(shell).toHaveAttribute('data-inspector', 'column');
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--app-safe-left', '40px');
    document.documentElement.style.setProperty('--app-safe-right', '40px');
  });
  await expect(shell).toHaveAttribute('data-inspector', 'overlay');
  await page.getByTestId('right-panel-open-btn').click();
  await expect(page.getByTestId('right-panel')).toBeVisible();
  await expect(page.getByTestId('shell-overlay-scrim')).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--app-safe-left', '0px');
    document.documentElement.style.setProperty('--app-safe-right', '0px');
  });
  await expect(shell).toHaveAttribute('data-inspector', 'column');
  await expect(page.getByTestId('right-panel')).toBeVisible();
});

test('landscape phone keeps the composer and model picker reachable', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto('/');
  const chooseSidecar = page.getByTestId('host-gate-choose-sidecar');
  if (await chooseSidecar.isVisible()) await chooseSidecar.click();
  const input = page.getByTestId('composer-input');
  await expect(input).toBeVisible();
  await input.fill('landscape draft');
  await page.getByTestId('thinking-effort-trigger').click();
  const popover = page.getByTestId('thinking-effort-popover');
  await expect(popover).toBeVisible();
  const box = await popover.boundingBox();
  expect(box?.y).toBeGreaterThanOrEqual(0);
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(390);
  await page.keyboard.press('Escape');
  await expect(input).toHaveValue('landscape draft');
});
