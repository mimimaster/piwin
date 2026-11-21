import { expect, test, type Page } from '@playwright/test';

const PELICAN_SESSION_ID = 'fixture-pelican-heavy';
const PELICAN_TITLE = '画一个2D的鹈鹕骑自行车的html动画（合成复现）';
const PELICAN_USER_ID = 'pelican-u1';
const PELICAN_FINAL_ID = 'pelican-final';
const PEER_TITLE = '普通对照会话';
const READING_STORAGE_KEY = 'piwin.desktop.transcriptReading.v1';

type StreamProbe = {
  session: string | null;
  historyViewActive: boolean;
  jumpLabel: string | null;
  hasTurnWindow: boolean;
  turnWindowHeight: number | null;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  turnCount: number;
  visibleTurns: Array<{
    textLen: number;
    textSnippet: string;
    top: number;
    bottom: number;
    height: number;
    intersectsViewport: boolean;
  }>;
  centerHitTag: string | null;
  centerHitInsideTurn: boolean;
  iframeCount: number;
  iframeHeight: number | null;
  visibleTextLen: number;
};

async function waitForMockShell(page: Page): Promise<void> {
  const chooseSidecar = page.getByTestId('host-gate-choose-sidecar');
  if (await chooseSidecar.isVisible()) {
    await chooseSidecar.click();
  }
  await expect(page.getByTestId('app-shell')).toBeVisible();
  await expect(page.getByTestId('composer-input')).toBeVisible();
}

async function openSidebarSession(page: Page, title: string): Promise<void> {
  const item = page.getByTestId('session-item').filter({ hasText: title }).first();
  await expect(item).toBeVisible();
  await item.click();
  await expect(page.getByTestId('transcript-opening-state')).toBeHidden({ timeout: 15_000 });
}

async function collectStreamProbe(page: Page): Promise<StreamProbe> {
  return page.evaluate(() => {
    const stream = document.querySelector<HTMLElement>('[data-testid="chat-stream"]');
    if (!stream) {
      throw new Error('chat-stream element not found');
    }
    const streamRect = stream.getBoundingClientRect();
    const turnWindow = stream.querySelector<HTMLElement>('[data-testid="transcript-turn-window"]');
    const turns = Array.from(stream.querySelectorAll<HTMLElement>('.chat-turn-group'));
    const visibleTurns = turns.map((turn) => {
      const rect = turn.getBoundingClientRect();
      const intersectsViewport =
        rect.height > 0 &&
        rect.bottom > streamRect.top + 4 &&
        rect.top < streamRect.bottom - 4;
      const text = (turn.textContent ?? '').trim();
      return {
        textLen: text.length,
        textSnippet: text.slice(0, 80),
        top: Math.round(rect.top - streamRect.top),
        bottom: Math.round(rect.bottom - streamRect.top),
        height: Math.round(rect.height),
        intersectsViewport,
      };
    });

    const centerX = streamRect.left + streamRect.width / 2;
    const centerY = streamRect.top + streamRect.height / 2;
    const hit = document.elementFromPoint(centerX, centerY);
    const centerHitInsideTurn = Boolean(hit?.closest('.chat-turn-group'));

    const visibleTextLen = visibleTurns
      .filter((t) => t.intersectsViewport)
      .reduce((sum, t) => sum + t.textLen, 0);

    const jumpBtn = document.querySelector<HTMLElement>('[data-testid="jump-to-latest-btn"]');
    const jumpLabel = jumpBtn?.getAttribute('aria-label') ?? null;
    const iframe = stream.querySelector<HTMLIFrameElement>('iframe');

    return {
      session: stream.getAttribute('data-artifact-layout-session'),
      historyViewActive: Boolean(jumpLabel && (jumpLabel.includes('返回最新消息') || jumpLabel.includes('Return to latest'))),
      jumpLabel,
      hasTurnWindow: turnWindow !== null,
      turnWindowHeight: turnWindow ? Math.round(turnWindow.getBoundingClientRect().height) : null,
      scrollTop: Math.round(stream.scrollTop),
      scrollHeight: Math.round(stream.scrollHeight),
      clientHeight: Math.round(stream.clientHeight),
      turnCount: turns.length,
      visibleTurns,
      centerHitTag: hit ? `${hit.tagName.toLowerCase()}.${hit.className}` : null,
      centerHitInsideTurn,
      iframeCount: stream.querySelectorAll('iframe').length,
      iframeHeight: iframe ? Math.round(iframe.getBoundingClientRect().height) : null,
      visibleTextLen,
    };
  });
}

async function assertViewportHasVisibleTurn(page: Page, label: string): Promise<void> {
  // Let layout / rAF settle briefly after opening cover lifts.
  await page.waitForTimeout(300);
  const probe = await collectStreamProbe(page);
  console.log(`[old-session-blank:${label}] ${JSON.stringify(probe)}`);

  expect(probe.session).toBe(PELICAN_SESSION_ID);
  expect(probe.turnCount).toBeGreaterThan(0);
  const intersecting = probe.visibleTurns.filter((turn) => turn.intersectsViewport);
  expect(intersecting.length).toBeGreaterThan(0);
  expect(probe.visibleTextLen > 0 || probe.iframeCount > 0).toBe(true);
}

test.describe('old heavy-thinking session open visibility', () => {
  test('a: opens directly without remembered reading position', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 840 });
    await page.goto('/?e2eOldSessionBlank=1');
    await waitForMockShell(page);
    await openSidebarSession(page, PELICAN_TITLE);
    await assertViewportHasVisibleTurn(page, 'a-direct');
  });

  test('b: opens with non-resident user anchor in localStorage', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 840 });
    await page.addInitScript(
      ({ key, sessionId, userId, finalId }) => {
        window.localStorage.setItem(
          key,
          JSON.stringify([
            [
              sessionId,
              {
                followTail: false,
                anchor: { messageId: userId, offset: 0 },
                lastSeenMessageId: finalId,
                lastUserMessageId: userId,
              },
            ],
          ]),
        );
      },
      {
        key: READING_STORAGE_KEY,
        sessionId: PELICAN_SESSION_ID,
        userId: PELICAN_USER_ID,
        finalId: PELICAN_FINAL_ID,
      },
    );
    await page.goto('/?e2eOldSessionBlank=1');
    await waitForMockShell(page);
    await openSidebarSession(page, PELICAN_TITLE);
    await assertViewportHasVisibleTurn(page, 'b-remembered-anchor');
  });

  test('c: opens with non-resident user anchor under critical memory pressure', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 840 });
    await page.addInitScript(
      ({ key, sessionId, userId, finalId }) => {
        window.localStorage.setItem(
          key,
          JSON.stringify([
            [
              sessionId,
              {
                followTail: false,
                anchor: { messageId: userId, offset: 0 },
                lastSeenMessageId: finalId,
                lastUserMessageId: userId,
              },
            ],
          ]),
        );
      },
      {
        key: READING_STORAGE_KEY,
        sessionId: PELICAN_SESSION_ID,
        userId: PELICAN_USER_ID,
        finalId: PELICAN_FINAL_ID,
      },
    );
    await page.goto('/?e2eOldSessionBlank=1');
    await waitForMockShell(page);
    await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent('desktop:memory-pressure', { detail: { level: 'critical' } }),
      );
    });
    await openSidebarSession(page, PELICAN_TITLE);
    await assertViewportHasVisibleTurn(page, 'c-anchor-critical');
  });

  test('d: opens another session then switches to heavy session and back via warm cache', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 840 });
    await page.goto('/?e2eOldSessionBlank=1');
    await waitForMockShell(page);
    await openSidebarSession(page, PEER_TITLE);
    await openSidebarSession(page, PELICAN_TITLE);
    await assertViewportHasVisibleTurn(page, 'd-first-open');
    await openSidebarSession(page, PEER_TITLE);
    await openSidebarSession(page, PELICAN_TITLE);
    await assertViewportHasVisibleTurn(page, 'd-warm-switch-back');
  });
});
