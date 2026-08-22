import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { HostCommandContext } from './host-command-context.js';
import { handleMediaSaveCommand } from './media-save-commands.js';
import { createDefaultPiwinConfig, savePiwinConfig } from '../config-store.js';
import { resetMediaUploads } from '../media-upload-session.js';

function createMinimalContext(rootDir: string): HostCommandContext {
  return {
    piwinRoot: rootDir,
    push: () => {},
    requireSession: () => {
      throw new Error('session not needed');
    },
    requireDurableSession: async () => {},
    getMcpManager: () => {
      throw new Error('mcp not needed');
    },
    getJobController: () => {
      throw new Error('jobs not needed');
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

describe('handleMediaSaveCommand chunked upload', () => {
  afterEach(() => {
    resetMediaUploads();
  });

  it('writes a payload larger than one Host JSON frame via sequential chunks', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-media-chunk-'));
    const config = createDefaultPiwinConfig();
    config.providers = [];
    config.media.maxPasteBytes = 10 * 1024 * 1024;
    await savePiwinConfig(config, rootDir);
    const context = createMinimalContext(rootDir);
    const payload = new Uint8Array(900 * 1024);
    payload[0] = 0x89;
    payload[1] = 0x50;
    payload[payload.length - 1] = 0x0a;
    const slices = [
      payload.subarray(0, 300 * 1024),
      payload.subarray(300 * 1024, 600 * 1024),
      payload.subarray(600 * 1024),
    ];

    const begin = await handleMediaSaveCommand(
      {
        type: 'media/save-begin',
        input: {
          sessionId: 'session-chunk',
          mimeType: 'image/png',
          source: 'paste',
          name: 'shot.png',
          contentKind: 'image',
          byteSize: payload.byteLength,
        },
      },
      'r1',
      context,
    );
    expect(begin?.success).toBe(true);
    if (!begin || !begin.success) {
      throw new Error(begin?.error ?? 'begin failed');
    }
    const uploadId = (begin.data as { uploadId: string }).uploadId;

    for (const [index, slice] of slices.entries()) {
      const chunk = await handleMediaSaveCommand(
        {
          type: 'media/save-chunk',
          input: {
            uploadId,
            chunkIndex: index,
            base64Data: Buffer.from(slice).toString('base64'),
          },
        },
        `r-chunk-${index}`,
        context,
      );
      expect(chunk?.success).toBe(true);
    }

    const finished = await handleMediaSaveCommand(
      { type: 'media/save-finish', input: { uploadId } },
      'r-finish',
      context,
    );
    expect(finished?.success).toBe(true);
    if (!finished || !finished.success) {
      throw new Error(finished?.error ?? 'finish failed');
    }
    const asset = (finished.data as { asset: { absolutePath: string; byteSize: number } }).asset;
    expect(asset.byteSize).toBe(payload.byteLength);
    const written = await readFile(asset.absolutePath);
    expect(written.byteLength).toBe(payload.byteLength);
    expect(written[0]).toBe(0x89);
    expect(written[written.length - 1]).toBe(0x0a);
  });
});
