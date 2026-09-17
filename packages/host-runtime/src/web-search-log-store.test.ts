import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { HostResponse, WebSearchLogPage, WebSearchLogRecord } from '@piwin/contracts';
import { createWebSearchLogStore, WEB_SEARCH_LOG_MAX_ENTRIES } from './web-search-log-store.js';
import { handleWebSearchLogCommand } from './commands/web-search-log-commands.js';
import { getWebSearchLogStore } from './web-search-log-store.js';
import type { HostCommandContext } from './commands/host-command-context.js';

function record(partial: Partial<WebSearchLogRecord> = {}): WebSearchLogRecord {
  return {
    sessionId: 's1',
    query: 'tauri iframe',
    ok: true,
    providerId: 'tavily',
    hitCount: 3,
    durationMs: 900,
    attempts: [{ sourceId: 'tavily', ok: true, hitCount: 3, durationMs: 900 }],
    ...partial,
  };
}

async function tempLogPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'piwin-web-search-log-'));
  return join(dir, 'logs', 'web-search.jsonl');
}

describe('web search log store', () => {
  it('records calls and lists newest first with paging', async () => {
    const store = createWebSearchLogStore(await tempLogPath());
    store.record(record({ query: 'first' }));
    store.record(record({ query: 'second' }));
    store.record(record({ query: 'third' }));
    await store.flush();

    const page = await store.list({ limit: 2 });
    expect(page.total).toBe(3);
    expect(page.entries.map((entry) => entry.query)).toEqual(['third', 'second']);
    expect(page.entries[0]?.id).toEqual(expect.any(String));
    expect(page.entries[0]?.recordedAt).toEqual(expect.any(String));
    const next = await store.list({ limit: 2, offset: 2 });
    expect(next.entries.map((entry) => entry.query)).toEqual(['first']);
  });

  it('filters to failed calls, including partially failed aggregates', async () => {
    const store = createWebSearchLogStore(await tempLogPath());
    store.record(record({ query: 'clean' }));
    store.record(
      record({
        query: 'partial',
        providerId: 'aggregate:brave+tavily',
        attempts: [
          { sourceId: 'brave', ok: false, hitCount: 0, durationMs: 5000, timedOut: true },
          { sourceId: 'tavily', ok: true, hitCount: 3, durationMs: 900 },
        ],
      }),
    );
    store.record(record({ query: 'broken', ok: false, hitCount: 0, error: 'Missing API key' }));
    await store.flush();

    const page = await store.list({ status: 'failed' });
    expect(page.entries.map((entry) => entry.query)).toEqual(['broken', 'partial']);
    expect(page.entries[0]?.error).toBe('Missing API key');
    expect(page.entries[1]?.attempts[0]?.timedOut).toBe(true);
  });

  it('does not persist the diagnostics kind tag or error text on success', async () => {
    const filePath = await tempLogPath();
    const store = createWebSearchLogStore(filePath);
    store.record({ ...record({ error: 'ignored' }), kind: 'web-search-diagnostics' } as WebSearchLogRecord);
    await store.flush();
    const row = JSON.parse((await readFile(filePath, 'utf8')).trim()) as Record<string, unknown>;
    expect(row).not.toHaveProperty('kind');
    expect(row).not.toHaveProperty('error');
  });

  it('compacts to the most recent rows and skips corrupt lines', async () => {
    const filePath = await tempLogPath();
    const seed = createWebSearchLogStore(filePath);
    seed.record(record({ query: 'seed' }));
    await seed.flush();
    const seedLine = (await readFile(filePath, 'utf8')).trim();
    const rows = Array.from({ length: WEB_SEARCH_LOG_MAX_ENTRIES * 1.5 - 1 }, (_, index) =>
      seedLine.replace('"seed"', `"q${index}"`),
    );
    await writeFile(filePath, `not json\n${rows.join('\n')}\n`, 'utf8');

    const store = createWebSearchLogStore(filePath);
    store.record(record({ query: 'latest' }));
    await store.flush();

    const page = await store.list({ limit: 1 });
    expect(page.total).toBe(WEB_SEARCH_LOG_MAX_ENTRIES);
    expect(page.entries[0]?.query).toBe('latest');
  });

  it('clears the log', async () => {
    const store = createWebSearchLogStore(await tempLogPath());
    store.record(record());
    await store.flush();
    await store.clear();
    expect((await store.list()).total).toBe(0);
  });

  it('serves list and clear through Host commands', async () => {
    const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-web-search-cmd-'));
    const context = { piwinRoot } as unknown as HostCommandContext;
    const store = getWebSearchLogStore(piwinRoot);
    store.record(record({ query: 'via command' }));
    await store.flush();

    const listed = (await handleWebSearchLogCommand(
      { type: 'web/search-log-list', limit: 10 },
      'r1',
      context,
    )) as HostResponse;
    expect(listed.success).toBe(true);
    const page = (listed as { data: { page: WebSearchLogPage } }).data.page;
    expect(page.entries[0]?.query).toBe('via command');

    const cleared = await handleWebSearchLogCommand({ type: 'web/search-log-clear' }, 'r2', context);
    expect(cleared?.success).toBe(true);
    expect((await store.list()).total).toBe(0);
    expect(await handleWebSearchLogCommand({ type: 'host/ping' }, 'r3', context)).toBeNull();
  });
});
