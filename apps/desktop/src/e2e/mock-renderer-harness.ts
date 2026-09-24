import type { MockHostBackend } from '../host-client-mock.js';
import { seedInkstoneHost } from './inkstone-host-fixture.js';
import { seedChainShowcaseHost } from './chain-showcase-fixture.js';
import { seedLongSessionHost } from './long-session-fixture.js';
import { seedLiveChainHost } from './live-chain-fixture.js';

export function installMockRendererHarness(host: MockHostBackend): void {
  if (typeof window === 'undefined') {
    return;
  }
  const params = new URLSearchParams(window.location.search);
  if (import.meta.env.VITE_PIWIN_E2E_FIXTURES === 'true' && params.get('e2eInkstone') === '1') {
    seedInkstoneHost(host);
  }
  // Showcase sessions for docs screenshots: fabricated conversations that
  // exercise every tool-card surface through the real renderer. The value picks
  // which conversation to seed ('all' or one session key).
  const showcaseKey = params.get('e2eChainShowcase');
  if (import.meta.env.VITE_PIWIN_E2E_FIXTURES === 'true' && showcaseKey !== null) {
    seedChainShowcaseHost(host, showcaseKey === '' ? 'all' : showcaseKey);
  }
  if (import.meta.env.VITE_PIWIN_E2E_FIXTURES === 'true' && params.get('e2eLongSession') === '1') {
    seedLongSessionHost(host);
  }
  if (import.meta.env.VITE_PIWIN_E2E_FIXTURES === 'true' && params.get('e2eLiveChain') === '1') {
    seedLiveChainHost(host);
  }
  const seedCount = Number(params.get('e2eSeedSessions'));
  if (Number.isSafeInteger(seedCount) && seedCount > 0) {
    const now = Date.parse('2026-08-13T00:00:00.000Z');
    for (let index = 0; index < seedCount; index += 1) {
      const sessionId = `e2e-session-${index + 1}`;
      host.sessions.set(sessionId, {
        projectPath: '',
        scope: { kind: 'general' },
        workingDirectory: 'general',
        events: [],
        transcript: [],
        name: `E2E Session ${String(index + 1).padStart(3, '0')}`,
        nameSource: 'user',
        updatedAt: new Date(now - index * 60_000).toISOString(),
      });
    }
  }
  if (params.get('e2eHostDiagnostics') === '1') {
    (
      window as Window & {
        __PIWIN_E2E_HOST_STATS__?: { sessionList: number; sessionListPage: number };
      }
    ).__PIWIN_E2E_HOST_STATS__ = host.e2eCommandCounts;
  }
}
