import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { saveMediaAsset, writeMediaLibraryMeta } from '@piwin/media';
import type { HostCommandContext } from './host-command-context.js';
import { handleMediaListCommand } from './media-list-commands.js';
import { createDefaultPiwinConfig, savePiwinConfig } from '../config-store.js';

function createMinimalContext(rootDir: string): HostCommandContext {
  return {
    piwinRoot: rootDir,
    push: () => {},
    requireSession: () => {
      throw new Error('session not needed for media list');
    },
    getMcpManager: () => {
      throw new Error('mcp not needed for media list');
    },
    getJobController: () => {
      throw new Error('jobs not needed for media list');
    },
    todoStore: {} as HostCommandContext['todoStore'],
    petStateStore: {
      snapshot: () => ({ pet: null }),
      setBase: () => {},
    } as unknown as HostCommandContext['petStateStore'],
    runCronJob: async () => ({ ok: false }),
    pendingPermissions: new Map(),
    pendingExtensionUi: new Map(),
    rememberProjectPermission: async () => {},
    rememberSessionPermission: () => {},
    sessionPermissionOverrides: new Map(),
    setSessionPermissionOverride: () => {},
    clearSessionPermissionOverride: () => {},
  } as unknown as HostCommandContext;
}

describe('handleMediaListCommand', () => {
  it('returns vault images newest first', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-media-list-cmd-'));
    await savePiwinConfig(createDefaultPiwinConfig(), rootDir);
    const mediaRoot = join(rootDir, 'media');
    const asset = await saveMediaAsset(
      { mediaRoot, maxPasteBytes: 1024, allowedMimeTypes: ['image/png'] },
      {
        sessionId: 'sess-1',
        bytes: new Uint8Array([137, 80, 78, 71, 3]),
        mimeType: 'image/png',
        source: 'generated',
      },
    );
    await writeMediaLibraryMeta(
      { mediaRoot },
      'sess-1',
      asset.id,
      {
        source: 'generated',
        kind: 'image',
        createdAt: asset.createdAt,
        prompt: 'foggy pier',
      },
    );

    const response = await handleMediaListCommand(
      { type: 'media/list', input: { kind: 'image' } },
      undefined,
      createMinimalContext(rootDir),
    );
    expect(response?.success).toBe(true);
    const data = (response as { data?: { items?: Array<{ assetId: string; prompt?: string }> } })
      .data;
    expect(data?.items?.[0]?.assetId).toBe(asset.id);
    expect(data?.items?.[0]?.prompt).toBe('foggy pier');
  });

  it('deletes a vault image and drops it from the next list', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-media-del-cmd-'));
    await savePiwinConfig(createDefaultPiwinConfig(), rootDir);
    const mediaRoot = join(rootDir, 'media');
    const asset = await saveMediaAsset(
      { mediaRoot, maxPasteBytes: 1024, allowedMimeTypes: ['image/png'] },
      {
        sessionId: 'sess-1',
        bytes: new Uint8Array([137, 80, 78, 71, 4]),
        mimeType: 'image/png',
        source: 'generated',
      },
    );

    const deleted = await handleMediaListCommand(
      { type: 'media/delete', input: { sessionId: 'sess-1', assetId: asset.id } },
      undefined,
      createMinimalContext(rootDir),
    );
    expect(deleted?.success).toBe(true);
    expect((deleted as { data?: { deleted?: boolean } }).data?.deleted).toBe(true);

    const listed = await handleMediaListCommand(
      { type: 'media/list', input: { kind: 'image' } },
      undefined,
      createMinimalContext(rootDir),
    );
    expect((listed as { data?: { total?: number } }).data?.total).toBe(0);
  });

  it('ignores unrelated commands', async () => {
    const response = await handleMediaListCommand(
      { type: 'media/read', input: { sessionId: 's', assetId: 'a' } },
      undefined,
      createMinimalContext('/tmp'),
    );
    expect(response).toBeNull();
  });
});
