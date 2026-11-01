import { expect, test } from '@playwright/test';

for (const scopeKind of ['general', 'project'] as const) {
  test(`shows an old cached ${scopeKind} conversation while the remote Host is unreachable`, async ({
    page,
  }) => {
    await page.routeWebSocket('ws://127.0.0.1:8787', (socket) => socket.close());
    await page.addInitScript((scopeKind) => {
      const endpoint = 'ws://127.0.0.1:8787';
      const savedAt = '2026-01-01T00:00:00Z';
      const projectPath = 'project-0123456789abcdef01234567';
      const scope =
        scopeKind === 'project' ? { kind: 'project', projectPath } : { kind: 'general' };
      const session = { id: 'cached', name: 'Saved offline chat', scope };
      localStorage.setItem('piwin.desktop.remote-host-target', JSON.stringify({ endpoint }));
      localStorage.setItem(
        `piwin.desktop.session-list-snapshot.v1.${encodeURIComponent(endpoint)}`,
        JSON.stringify({
          version: 1,
          savedAt,
          general: scopeKind === 'general' ? [session] : [],
          projects: scopeKind === 'project' ? { [projectPath]: [session] } : {},
          recentProjects:
            scopeKind === 'project'
              ? [
                  {
                    path: projectPath,
                    displayName: 'Saved project',
                    trust: 'trusted',
                    lastOpenedAt: savedAt,
                    createdAt: savedAt,
                  },
                ]
              : [],
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
    }, scopeKind);
    await page.goto('/');
    await expect(page.getByTestId('app-shell')).toBeVisible();
    if (scopeKind === 'project') {
      await page.getByTestId('sidebar-mode-code').click();
    }
    await expect(
      page.getByTestId('session-item').filter({ hasText: 'Saved offline chat' }),
    ).toBeVisible();
    await expect(
      page.getByTestId('message-bubble').filter({ hasText: 'Visible before the Host connects.' }),
    ).toBeVisible();
    await expect(page.locator('.transcript-viewport.is-opening')).toHaveCount(0);
    await expect(page.getByTestId('project-trust-notice')).toHaveCount(0);
    await expect(page.getByTestId('send-btn')).toBeDisabled();
  });
}
