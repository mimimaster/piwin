import { describe, expect, it } from 'vitest';
import { deriveSessionStatusInsights, formatCompactTokenCount } from './session-status-model';

describe('deriveSessionStatusInsights', () => {
  it('returns null sections when no runtime metadata is supplied', () => {
    const empty = deriveSessionStatusInsights(undefined, false);
    expect(empty.hasDetails).toBe(false);
    expect(empty.overview).toBeNull();
    expect(empty.prompt).toBeNull();
    expect(empty.antigravity).toBeNull();
  });

  it('extracts active pi-purge prompt path, mode, and Host ContextManifest paths', () => {
    const insights = deriveSessionStatusInsights(
      {
        agentId: 'pi',
        modelLabel: 'Claude Sonnet 4.6',
        effortLabel: 'high',
        permissionMode: 'auto',
        sessionId: 'sess-123',
        workspacePath: '/Users/dev/project',
        contextTokensUsed: 42_000,
        contextTokensLimit: 200_000,
        usageTotals: {
          sessionId: 'sess-123',
          userTurnCount: 3,
          promptTokens: 10_000,
          completionTokens: 2_000,
          cacheReadTokens: 30_000,
          cacheWriteTokens: 0,
          totalTokens: 42_000,
          entryCount: 4,
          estimatedCostUsd: 0.18,
        },
        extensionSurface: {
          sessionId: 'sess-123',
          statuses: [
            { key: 'pi-purge', text: 'PURGE · strict' },
            {
              key: 'meta:pi-purge',
              text: JSON.stringify({ on: true, mode: 'strict', source: 'custom', chars: 512 }),
            },
            { key: 'meta:pi-purge-path', text: '/Users/dev/project/.pi/lean-system.md' },
            { key: 'meta:context-prompt', text: JSON.stringify({ appSrc: 'project', agents: 2 }) },
            { key: 'meta:context-app-path', text: '/Users/dev/project/APPEND_SYSTEM.md' },
            { key: 'deepseek-cache', text: 'Cache 88%' },
          ],
          widgets: [],
        },
      },
      true,
    );

    expect(insights.overview).toMatchObject({
      agentLabel: 'Pi',
      modelLabel: 'Claude Sonnet 4.6',
      effortLabel: 'high',
      contextSummary: '21% · 42k / 200k',
      cacheSummary: '缓存 75%',
      costSummary: '$0.18',
    });
    expect(insights.prompt).toMatchObject({
      engine: 'pi-purge',
      badge: 'PURGE ON · strict (custom)',
      activePath: '/Users/dev/project/.pi/lean-system.md',
      appendPath: '/Users/dev/project/APPEND_SYSTEM.md',
      agentsCount: 2,
      charsLabel: '512 chars',
    });
    expect(insights.extraStatuses).toEqual([{ key: 'deepseek-cache', text: 'Cache 88%' }]);
  });

  it('shows ContextManifest SYSTEM.md when pi-purge is OFF and parses Antigravity metadata', () => {
    const piInsights = deriveSessionStatusInsights(
      {
        agentId: 'pi',
        extensionSurface: {
          sessionId: 's2',
          statuses: [
            { key: 'meta:pi-purge', text: JSON.stringify({ on: false, mode: 'strict', source: 'none' }) },
            { key: 'meta:context-prompt', text: JSON.stringify({ sysSrc: 'pi-native', agents: 1 }) },
            { key: 'meta:context-sys-path', text: '/Users/dev/.pi/agent/SYSTEM.md' },
          ],
          widgets: [],
        },
      },
      false,
    );
    expect(piInsights.prompt).toMatchObject({
      engine: 'context-system',
      badge: 'SYSTEM.md (global)',
      activePath: '/Users/dev/.pi/agent/SYSTEM.md',
    });

    const agyInsights = deriveSessionStatusInsights(
      {
        agentId: 'antigravity',
        nativeSessionId: 'conv-abc',
        extensionSurface: {
          sessionId: 's3',
          statuses: [
            { key: 'meta:agy-purge', text: JSON.stringify({ on: true, mode: 'replace', source: 'custom', chars: 320 }) },
            { key: 'meta:agy-purge-path', text: '/Users/dev/.piwin/antigravity-acp/staged-homes/h1/GEMINI.md' },
            { key: 'meta:agy-account', text: JSON.stringify({ id: 'work', label: 'work', isSystem: false, proxy: 'socks5://127.0.0.1:7890' }) },
            { key: 'meta:agy-rebuild', text: JSON.stringify({ auto: true, count: 1 }) },
            { key: 'agy-route', text: '⚠ Degraded route (3pt: fast_ttft)' },
            {
              key: 'meta:agy-quota',
              text: JSON.stringify({
                accountId: 'work',
                buckets: [{ id: 'gemini-5h', label: 'Gem 5h', remainingPct: 72, reset: '2h' }],
              }),
            },
          ],
          widgets: [],
        },
      },
      true,
    );

    expect(agyInsights.prompt?.activePath).toBe('/Users/dev/.piwin/antigravity-acp/staged-homes/h1/GEMINI.md');
    expect(agyInsights.antigravity).toMatchObject({
      accountLabel: 'work',
      isSystemAccount: false,
      proxyLabel: 'socks5://127.0.0.1:7890',
      routeDegraded: true,
      autoRebuildLabel: '自动重建 ON (本会话 1 次)',
      quotaAccountId: 'work',
    });
    expect(agyInsights.antigravity?.quotaBuckets).toEqual([
      { id: 'gemini-5h', label: 'Gem 5h', remainingPct: 72, resetLabel: '2h' },
    ]);
  });

  it('formats compact token numbers cleanly', () => {
    expect(formatCompactTokenCount(950)).toBe('950');
    expect(formatCompactTokenCount(42_400)).toBe('42k');
    expect(formatCompactTokenCount(1_500_000)).toBe('1.5M');
  });
});
