import { expect, test, type Page } from '@playwright/test';

async function geometry(page: Page) {
  return page.evaluate(() => {
    const stage = document.querySelector('.chat-stage');
    const tui = document.querySelector('.conversation-tui-stage');
    const surface = document.querySelector('.xterm-surface');
    const screen = document.querySelector('.xterm-screen');
    if (stage === null || tui === null || surface === null || screen === null) throw new Error('TUI not mounted');
    return {
      stageWidth: stage.getBoundingClientRect().width,
      tuiWidth: tui.getBoundingClientRect().width,
      surfaceWidth: surface.getBoundingClientRect().width,
      screenWidth: screen.getBoundingClientRect().width,
      cols: Number(document.documentElement.dataset.ptyCols),
      opens: Number(document.documentElement.dataset.ptyOpens),
    };
  });
}

for (const theme of ['ink', 'paper']) {
  for (const centered of [true, false]) {
    test(`TUI fills and stays in its stage (${theme}, centered=${centered})`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`/e2e/fixtures/embedded-tui.html?theme=${theme}&centered=${centered}`);
      await expect(page.locator('[data-testid=conversation-shell-desktop] .shell-glyph')).toHaveCSS('color', theme === 'paper' ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)');
      await page.getByTestId('conversation-shell-cli').click();
      await expect(page.locator('.xterm-screen')).toBeVisible();
      await expect.poll(async () => (await geometry(page)).cols).toBeGreaterThan(20);
      const samples = await page.evaluate(async () => {
        const measurements: { stage: number; tui: number }[] = [];
        for (let index = 0; index < 15; index += 1) {
          const stage = document.querySelector('.chat-stage');
          const tui = document.querySelector('.conversation-tui-stage');
          if (stage === null || tui === null) throw new Error('TUI not mounted');
          measurements.push({ stage: stage.getBoundingClientRect().width, tui: tui.getBoundingClientRect().width });
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
        return measurements;
      });
      for (const sample of samples) expect(Math.abs(sample.stage - sample.tui)).toBeLessThan(1);
      const first = await geometry(page);
      expect(first.surfaceWidth).toBeGreaterThan(first.stageWidth - 24);
      expect(first.screenWidth).toBeGreaterThan(first.surfaceWidth - 40);
      expect(first.opens).toBe(1);
      await page.setViewportSize({ width: 900, height: 700 });
      await expect.poll(async () => (await geometry(page)).cols).toBeLessThan(first.cols);
      const narrow = await geometry(page);
      expect(Math.abs(narrow.stageWidth - narrow.tuiWidth)).toBeLessThan(1);
      await page.setViewportSize({ width: 1600, height: 1000 });
      await expect.poll(async () => (await geometry(page)).cols).toBeGreaterThan(first.cols);
      await page.getByTestId('fixture-adopt-session').click();
      await expect(page.locator('.chat-column-empty')).toHaveCount(0);
      const adopted = await geometry(page);
      expect(Math.abs(adopted.stageWidth - adopted.tuiWidth)).toBeLessThan(1);
      expect(adopted.opens).toBe(1);
      await page.getByTestId('conversation-shell-desktop').click();
      await expect(page.locator('.xterm-screen')).toBeHidden();
    });
  }
}

for (const theme of ['ink', 'paper']) {
  test(`Grok switches directly to its Host-native TUI (${theme})`, async ({ page }) => {
    await page.goto(`/e2e/fixtures/embedded-tui.html?theme=${theme}&agent=grok`);
    await page.getByTestId('conversation-shell-cli').click();
    await expect(page.locator('.xterm-screen')).toBeVisible();
    await expect(page.getByTestId('conversation-shell-cli')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.cliAgent)).toBe('grok');
    await expect.poll(async () => (await geometry(page)).cols).toBeGreaterThan(20);
    expect((await geometry(page)).opens).toBe(1);
    await page.getByTestId('conversation-shell-desktop').click();
    await expect(page.locator('.xterm-screen')).toBeHidden();
    await expect(page.getByTestId('conversation-shell-desktop')).toHaveAttribute('aria-pressed', 'true');
  });
}

for (const agent of ['pi', 'grok']) {
  test(`repeated ${agent} shell switches reuse the running terminal`, async ({ page }) => {
    await page.goto(`/e2e/fixtures/embedded-tui.html?agent=${agent}`);
    await page.getByTestId('conversation-shell-cli').click();
    await expect(page.locator('.xterm-screen')).toBeVisible();
    await expect.poll(async () => (await geometry(page)).opens).toBe(1);
    for (let index = 0; index < 4; index += 1) {
      await page.getByTestId('conversation-shell-desktop').click();
      await expect(page.locator('.xterm-screen')).toBeHidden();
      await expect(page.getByTestId('composer-input')).toBeFocused();
      await page.getByTestId('conversation-shell-cli').click();
      await expect(page.locator('.xterm-screen')).toBeVisible();
      expect((await geometry(page)).opens).toBe(1);
      await expect(page.locator('.xterm-helper-textarea')).toBeFocused();
    }
  });
}

test('hidden CLI retains its grid, refits on return, and preserves the Desktop draft', async ({ page }) => {
  await page.goto('/e2e/fixtures/embedded-tui.html');
  await page.getByTestId('composer-input').fill('未发送的草稿');
  await page.getByTestId('conversation-shell-cli').click();
  await expect(page.locator('.xterm-screen')).toBeVisible();
  await expect.poll(async () => (await geometry(page)).cols).toBeGreaterThan(20);
  const first = await geometry(page);
  await page.getByTestId('conversation-shell-desktop').click();
  await page.setViewportSize({ width: 900, height: 700 });
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => Number(document.documentElement.dataset.ptyCols))).toBe(first.cols);
  await page.getByTestId('conversation-shell-cli').click();
  await expect.poll(async () => (await geometry(page)).cols).toBeLessThan(first.cols);
  expect((await geometry(page)).opens).toBe(1);
  await page.getByTestId('conversation-shell-desktop').click();
  await expect(page.getByTestId('composer-input')).toHaveValue('未发送的草稿');
});

test('a terminal finishing startup while hidden cannot steal the composer focus', async ({ page }) => {
  await page.goto('/e2e/fixtures/embedded-tui.html?delayed');
  await page.getByTestId('conversation-shell-cli').click();
  await expect(page.locator('.xterm-screen')).toBeVisible();
  await page.getByTestId('conversation-shell-desktop').click();
  await expect(page.getByTestId('composer-input')).toBeFocused();
  await page.waitForTimeout(400);
  await expect(page.getByTestId('composer-input')).toBeFocused();
  await page.getByTestId('conversation-shell-cli').click();
  await expect(page.locator('.xterm-helper-textarea')).toBeFocused();
  expect((await geometry(page)).opens).toBe(1);
});
