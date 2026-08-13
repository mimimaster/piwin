import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openSessionTranscriptStore, type SessionTranscriptStore } from '@piwin/session';
import { buildColdActivationSeedOptions } from './cold-activation-seed.js';

async function openStore(label: string): Promise<SessionTranscriptStore> {
  const rootDir = await mkdtemp(join(tmpdir(), `piwin-cold-seed-${label}-`));
  return openSessionTranscriptStore({
    dbPath: join(rootDir, 'transcript.sqlite3'),
    sessionId: `session-${label}`,
    projectPath: '/project',
  });
}

async function appendRow(
  store: SessionTranscriptStore,
  id: string,
  role: 'user' | 'assistant',
  text: string,
): Promise<void> {
  const result = await store.appendMessage({
    id,
    runtimeGenerationId: 'gen-1',
    backendMessageId: `backend-${id}`,
    role,
    text,
    status: 'done',
    createdAt: new Date().toISOString(),
  });
  expect(result.ok).toBe(true);
}

describe('buildColdActivationSeedOptions', () => {
  it('returns replay seed options when native entries exist', async () => {
    const store = await openStore('native');
    await appendRow(store, 'u1', 'user', 'question');
    await appendRow(store, 'a1', 'assistant', 'answer');
    await store.appendNativeEntries('a1', [
      {
        ordinal: 0,
        entry: { format: 'pi-message-v1', payload: '{"role":"assistant"}', byteLength: 20 },
      },
    ]);

    const options = await buildColdActivationSeedOptions(store);
    expect(options).toBeDefined();
    expect(options?.seedMode).toBe('replay');
    expect(options?.seedMessages).toHaveLength(2);
    expect(options?.seedMessages?.[1]?.native).toHaveLength(1);
    store.close();
  });

  it('returns undefined when no row has native entries', async () => {
    const store = await openStore('text-only');
    await appendRow(store, 'u1', 'user', 'question');
    await appendRow(store, 'a1', 'assistant', 'answer');

    expect(await buildColdActivationSeedOptions(store)).toBeUndefined();
    store.close();
  });

  it('excludes the current prompt user row from the seed', async () => {
    const store = await openStore('exclude');
    await appendRow(store, 'a1', 'assistant', 'earlier answer');
    await store.appendNativeEntries('a1', [
      {
        ordinal: 0,
        entry: { format: 'pi-message-v1', payload: '{"role":"assistant"}', byteLength: 20 },
      },
    ]);
    await appendRow(store, 'user-current', 'user', 'the prompt being sent right now');

    const options = await buildColdActivationSeedOptions(store, 'user-current');
    expect(options?.seedMessages?.some((seed) => seed.text.includes('right now'))).toBe(false);
    store.close();
  });
});
