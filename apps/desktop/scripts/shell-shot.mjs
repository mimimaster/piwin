/**
 * Visual capture harness for the Deck redesign.
 *
 * Drives the browser shell against the in-browser HostClient mock (the same
 * fixture the e2e suite uses) and writes full-window screenshots so each
 * region rewrite can be reviewed against the previous pass.
 *
 *   pnpm exec vite --port 1466 --strictPort --host 127.0.0.1   # in one shell
 *   node scripts/shell-shot.mjs [outDir] [--light]
 */
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const outDir = process.argv[2] ?? '/tmp/deck-shell';
const light = process.argv.includes('--light');
const baseURL = process.env.SHOT_BASE_URL ?? 'http://127.0.0.1:1466';
const PROJECT_PATH = '/Users/yorickjue/Developer/piwin';

await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1560, height: 940 },
  deviceScaleFactor: 2,
  colorScheme: light ? 'light' : 'dark',
  reducedMotion: 'reduce',
});

const shot = async (name) => {
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${outDir}/${name}.png` });
  console.log(`  ${name}`);
};

// Skip the boot gate: outside Tauri the sidecar choice resolves to the
// in-browser HostClient mock, which is exactly the fixture we want to shoot.
await page.addInitScript(() => {
  localStorage.setItem('piwin.desktop.host-launch-mode', 'sidecar');
});

await page.goto(baseURL);
await page.getByTestId('app-shell').waitFor({ state: 'visible', timeout: 30_000 });
await page.getByTestId('composer-input').waitFor({ state: 'visible', timeout: 30_000 });
await shot('01-empty');

// Open a project, then send one prompt so the mock produces a real transcript.
await page.getByTestId('open-workspace-btn').click();
await page.getByRole('menuitem', { name: /打开工作区文件夹|open workspace folder/i }).click();
await page.getByTestId('project-path-input').fill(PROJECT_PATH);
await page.getByTestId('open-project-btn').click();
await page.getByTestId('composer-input').waitFor({ state: 'visible' });
await shot('02-project-open');

await page.getByTestId('composer-input').fill('Redesign the desktop shell');
await page.getByTestId('send-btn').click();
await page
  .locator('[data-testid="message-bubble"][data-role="assistant"]')
  .first()
  .waitFor({ state: 'visible', timeout: 30_000 });
await shot('03-transcript');

const clickShot = async (testId, name) => {
  const target = page.getByTestId(testId);
  if ((await target.count()) === 0) {
    console.log(`  (skip ${name}: no ${testId})`);
    return false;
  }
  await target.first().click();
  await shot(name);
  return true;
};

// Composer plus menu — checks overlay/menu chrome against the deck.
await clickShot('composer-plus-btn', '04-plus-menu');
await page.keyboard.press('Escape');

// Inspector column, then one of its tools.
if (await clickShot('right-panel-open-btn', '05-inspector')) {
  await clickShot('right-panel-home-files', '06-inspector-files');
}

// Settings is a separate full-window surface with its own dense chrome.
await clickShot('settings-open-btn', '07-settings');

// Flip to the Bone theme through the real settings control, then back out to
// the workspace so the light ramp is checked on the shell it was authored for.
if (light) {
  const lightBtn = page
    .locator('[data-testid="appearance-mode-control"] label')
    .filter({ hasText: /^Light$/ });
  if ((await lightBtn.count()) > 0) {
    await lightBtn.first().click();
    await shot('08-settings-bone');
    const back = page.getByRole('button', { name: /返回工作区|back to workspace/i });
    if ((await back.count()) > 0) {
      await back.first().click();
      await shot('09-shell-bone');
    }
  } else {
    console.log('  (skip bone: no Light button)');
  }
}

await browser.close();
console.log(`\nwrote ${outDir}`);
