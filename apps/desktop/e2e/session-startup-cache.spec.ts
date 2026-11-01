import { expect, test } from '@playwright/test';

test('shows an old cached conversation while the remote Host is unreachable', async ({ page }) => {
  await page.routeWebSocket('ws://127.0.0.1:8787', (socket) => socket.close());
  await page.addInitScript(() => {
    const endpoint = 'ws://127.0.0.1:8787';
    const savedAt = '2026-01-01T00:00:00Z';
    const scope = { kind: 'general' };
    localStorage.setItem('piwin.desktop.remote-host-target', JSON.stringify({ endpoint }));
    localStorage.setItem(
      `piwin.desktop.session-list-snapshot.v1.${encodeURIComponent(endpoint)}`,
      JSON.stringify({
        version: 1,
        savedAt,
        general: [{ id: 'cached', name: 'Saved offline chat', scope }],
        projects: {},
        recentProjects: [],
      }),
    );
    localStorage.setItem(
      `piwin.desktop.session-startup.v1.${encodeURIComponent(endpoint)}`,
      JSON.stringify({
        version: 1,
        savedAt,
        sessionId: 'cached',
        name: 'Saved offline chat',
        scope,
        messages: [
          {
            id: 'reply',
            role: 'assistant',
            text: 'Visible before the Host connects.',
            thinking: '',
            tools: [],
            attachments: [],
            status: 'done',
          },
        ],
      }),
    );
  });
  await page.goto('/');
  await expect(page.getByTestId('app-shell')).toBeVisible();
  await expect(
    page.getByTestId('session-item').filter({ hasText: 'Saved offline chat' }),
  ).toBeVisible();
  await expect(
    page.getByTestId('message-bubble').filter({ hasText: 'Visible before the Host connects.' }),
  ).toBeVisible();
  await expect(page.locator('.transcript-viewport.is-opening')).toHaveCount(0);
  await expect(page.getByTestId('send-btn')).toBeDisabled();
});
