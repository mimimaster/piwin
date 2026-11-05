import { expect, test, type Page } from '@playwright/test';
import type { HostPush } from '@piwin/contracts';

type BrowserTabTestHost = {
  getTransport(): string;
  emit(message: HostPush): void;
};

async function emitBrowserPush(page: Page, message: HostPush): Promise<void> {
  await page.evaluate((push) => {
    const host = (window as Window & { __browserTabTestHost?: BrowserTabTestHost }).__browserTabTestHost;
    if (!host || host.getTransport() !== 'mock') throw new Error('Expected the isolated mock Host');
    host.emit(push);
  }, message);
}

test('a closed Browser tool tab stays closed through passive page updates', async ({ page }) => {
  // Capture this isolated browser's mock client without adding a production
  // test API or connecting to the operator's live Host.
  await page.route('**/src/host/host-client.ts', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}
      const subscribeBeforeBrowserTabTest = HostClient.prototype.subscribe;
      HostClient.prototype.subscribe = function(listener) {
        globalThis.__browserTabTestHost = this;
        return subscribeBeforeBrowserTabTest.call(this, listener);
      };
    ` });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByTestId('host-gate-choose-sidecar').click();
  await expect(page.getByTestId('app-shell')).toBeVisible();
  await page.getByTestId('sidebar-mode-code').click();
  await page.getByTestId('open-workspace-btn').click();
  await page.getByTestId('project-path-input').fill('/tmp/piwin-e2e-browser-tab-close');
  await page.getByTestId('open-project-btn').click();
  await page.getByTestId('composer-input').fill('Complete this browser tab regression session.');
  await page.getByTestId('send-btn').click();
  await expect(page.locator('[data-testid="message-bubble"][data-role="assistant"]'))
    .toContainText('piwin desktop mock reply');
  const sessionId = await page.getByTestId('chat-stream').getAttribute('data-artifact-layout-session');
  if (!sessionId) throw new Error('Expected an active conversation');

  await page.getByTestId('right-panel-open-btn').first().click();
  await page.getByTestId('right-panel-home-files').click();
  await expect(page.getByTestId('file-tree-panel')).toBeVisible();
  await emitBrowserPush(page, { type: 'browser/controller', sessionId, owner: 'agent', reason: 'agent-write', ts: 1 });
  const browserTab = page.getByTestId('right-panel-open-tab-browser');
  await expect(browserTab).toBeVisible();
  await emitBrowserPush(page, { type: 'browser/controller', sessionId, owner: 'idle', reason: 'run-terminal', ts: 2 });
  await page.getByTestId('right-panel-close-tab-browser').click();
  await expect(browserTab).toHaveCount(0);
  await expect(page.getByTestId('file-tree-panel')).toBeVisible();

  for (let revision = 1; revision <= 3; revision += 1) {
    await emitBrowserPush(page, { type: 'browser/state', sessionId, ts: revision + 2,
      url: 'https://linux.do/t/topic/2904802', lifecycle: 'ready', documentRevision: revision });
  }
  await emitBrowserPush(page, { type: 'browser/controller', sessionId, owner: 'agent', reason: 'mirror-start', ts: 6 });
  // Let state updates and mirror effects paint before checking close intent.
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  await expect(browserTab).toHaveCount(0);
  await expect(page.getByTestId('file-tree-panel')).toBeVisible();

  await page.getByTestId('right-panel-tab-add').click();
  await page.getByTestId('right-panel-plus-browser').click();
  await expect(browserTab).toBeVisible();
  await page.getByTestId('right-panel-close-tab-browser').click();
  await expect(browserTab).toHaveCount(0);

  // New real browser work can still request attention after the prior turn.
  await emitBrowserPush(page, { type: 'browser/controller', sessionId, owner: 'agent', reason: 'agent-write', ts: 7 });
  await expect(browserTab).toBeVisible();
});
