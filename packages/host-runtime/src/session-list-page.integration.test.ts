import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SessionListPageData } from '@piwin/contracts';
import { HostRuntime } from './host-runtime.js';

describe('HostRuntime session/list-page', () => {
  it('returns bounded pages and invalidates a cursor after reordering', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-host-session-page-'));
    const runtime = new HostRuntime({ mode: 'sdk', mock: true, piwinRoot: rootDir });
    const sessionIds: string[] = [];

    try {
      for (let index = 0; index < 14; index += 1) {
        const created = await runtime.handleCommand({
          type: 'session/create',
          input: {
            scope: { kind: 'general' },
            sessionName: `Bounded Chat ${index.toString().padStart(2, '0')}`,
          },
        });
        if (!created.success) throw new Error(created.error);
        sessionIds.push((created.data as { sessionId: string }).sessionId);
      }

      const firstResponse = await runtime.handleCommand({
        type: 'session/list-page',
        query: {
          scope: { kind: 'general' },
          lifecycle: 'active',
          order: 'alphabetical',
          limit: 6,
        },
      });
      expect(firstResponse.success).toBe(true);
      if (!firstResponse.success) throw new Error(firstResponse.error);
      const first = firstResponse.data as SessionListPageData;
      expect(first.status).toBe('page');
      if (first.status !== 'page') return;
      expect(first.sessions).toHaveLength(6);
      expect(first.page.totalCount).toBe(14);
      expect(first.page.pageCount).toBe(3);
      const nextCursor = first.page.nextCursor;
      if (nextCursor === undefined) throw new Error('expected next cursor');

      const secondResponse = await runtime.handleCommand({
        type: 'session/list-page',
        query: {
          scope: { kind: 'general' },
          lifecycle: 'active',
          order: 'alphabetical',
          limit: 6,
          cursor: nextCursor,
        },
      });
      expect(secondResponse.success).toBe(true);
      if (!secondResponse.success) throw new Error(secondResponse.error);
      const second = secondResponse.data as SessionListPageData;
      expect(second.status === 'page' ? second.page.pageIndex : -1).toBe(1);

      const firstSessionId = sessionIds[0];
      if (firstSessionId === undefined) throw new Error('missing session fixture');
      await runtime.handleCommand({
        type: 'session/rename',
        sessionId: firstSessionId,
        name: 'AAA',
      });

      const staleResponse = await runtime.handleCommand({
        type: 'session/list-page',
        query: {
          scope: { kind: 'general' },
          lifecycle: 'active',
          order: 'alphabetical',
          limit: 6,
          cursor: nextCursor,
        },
      });
      expect(staleResponse.success).toBe(true);
      if (!staleResponse.success) throw new Error(staleResponse.error);
      expect((staleResponse.data as SessionListPageData).status).toBe('stale-cursor');
    } finally {
      await runtime.dispose();
    }
  });
});
