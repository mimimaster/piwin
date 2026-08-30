import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSessionRecord, getSessionRecord, upsertSessionRecord } from '@piwin/session';
import { getPiwinSessionIndexPath } from './paths.js';
import { rewritePersistedChannelRefs } from './rewrite-persisted-channel-refs.js';

describe('rewritePersistedChannelRefs', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('rewrites session index channel models and live sessionModels', async () => {
    const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-oauth-relocate-'));
    roots.push(piwinRoot);
    const indexPath = getPiwinSessionIndexPath(piwinRoot);
    const channel = createSessionRecord({
      id: 's-channel',
      name: 'channel',
      projectPath: '/tmp',
    });
    const subscription = createSessionRecord({
      id: 's-sub',
      name: 'sub',
      projectPath: '/tmp',
    });
    await upsertSessionRecord(indexPath, {
      ...channel,
      model: { providerId: 'xai', modelId: 'grok-4.6', source: 'channel' },
    });
    await upsertSessionRecord(indexPath, {
      ...subscription,
      model: { providerId: 'xai', modelId: 'grok-4.6', source: 'subscription' },
    });
    const sessionModels = new Map([
      ['live-channel', { providerId: 'xai', modelId: 'grok-4.6', source: 'channel' as const }],
      ['live-sub', { providerId: 'xai', modelId: 'grok-4.6', source: 'subscription' as const }],
    ]);
    await rewritePersistedChannelRefs({
      piwinRoot,
      fromProviderId: 'xai',
      toProviderId: 'xai-api',
      sessionModels,
    });
    expect((await getSessionRecord(indexPath, 's-channel'))?.model?.providerId).toBe('xai-api');
    expect((await getSessionRecord(indexPath, 's-sub'))?.model?.providerId).toBe('xai');
    expect(sessionModels.get('live-channel')?.providerId).toBe('xai-api');
    expect(sessionModels.get('live-sub')?.providerId).toBe('xai');
  });
});
