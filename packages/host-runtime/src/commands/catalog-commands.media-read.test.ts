import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { HostCommandContext } from './host-command-context.js';
import { handleCatalogCommand } from './catalog-commands.js';
import { createDefaultPiwinConfig, savePiwinConfig } from '../config-store.js';
import { saveMediaAsset } from '@piwin/media';

function createMinimalContext(rootDir: string): HostCommandContext {
  return {
    piwinRoot: rootDir,
    push: () => {},
    requireSession: () => {
      throw new Error('session not needed for media read');
    },
    getMcpManager: () => {
      throw new Error('mcp not needed for media read');
    },
    getJobController: () => {
      throw new Error('jobs not needed for media read');
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

describe('handleCatalogCommand media/read', () => {
  it('returns base64 bytes for a vault asset by logical id', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-media-read-'));
    const config = createDefaultPiwinConfig();
    config.providers = [];
    await savePiwinConfig(config, rootDir);
    // Write straight into the vault the command handler reads from.
    const mediaRoot = join(rootDir, 'media');
    const asset = await saveMediaAsset(
      {
        mediaRoot,
        maxPasteBytes: 1024,
        allowedMimeTypes: ['image/png'],
      },
      {
        sessionId: 'sess-1',
        bytes: new Uint8Array([137, 80, 78, 71, 9, 9]),
        mimeType: 'image/png',
        source: 'generated',
      },
    );

    const response = await handleCatalogCommand(
      { type: 'media/read', input: { sessionId: 'sess-1', assetId: asset.id } },
      undefined,
      createMinimalContext(rootDir),
    );
    expect(response?.success).toBe(true);
    const data = (response as { data?: unknown }).data as {
      status: string;
      base64Data?: string;
      mimeType?: string;
    };
    expect(data.status).toBe('ready');
    expect(data.mimeType).toBe('image/png');
    expect(data.base64Data).toBe(Buffer.from([137, 80, 78, 71, 9, 9]).toString('base64'));
  });

  it('maps unknown assets to an unavailable payload, not a transport error', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-media-read-'));
    const config = createDefaultPiwinConfig();
    config.providers = [];
    await savePiwinConfig(config, rootDir);

    const response = await handleCatalogCommand(
      { type: 'media/read', input: { sessionId: 'ghost', assetId: 'nope' } },
      undefined,
      createMinimalContext(rootDir),
    );
    expect(response?.success).toBe(true);
    const data = (response as { data?: unknown }).data as { status: string; reason: string };
    expect(data).toMatchObject({ status: 'unavailable', reason: 'not-found' });
  });
});
