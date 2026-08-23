import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { HostCommandContext } from './host-command-context.js';
import { handleMediaIngestCommand } from './media-ingest-commands.js';
import { createDefaultPiwinConfig, savePiwinConfig } from '../config-store.js';

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

function createMinimalContext(rootDir: string): HostCommandContext {
  return {
    piwinRoot: rootDir,
    push: () => {},
    requireSession: () => {
      throw new Error('session not needed for preview tests');
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

describe('handleMediaIngestCommand preview/read-local-file', () => {
  it('previews a local PNG as session media', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-preview-cmd-'));
    const config = createDefaultPiwinConfig();
    config.providers = [];
    await savePiwinConfig(config, rootDir);
    const source = join(rootDir, 'ncg-boot2.png');
    await writeFile(source, PNG_BYTES);

    const response = await handleMediaIngestCommand(
      {
        type: 'preview/read-local-file',
        input: { sessionId: 'sess-1', absolutePath: source },
      },
      'preview-ok',
      createMinimalContext(rootDir),
    );

    expect(response).toMatchObject({
      id: 'preview-ok',
      success: true,
      command: 'preview/read-local-file',
      data: { status: 'ready', kind: 'media' },
    });
    const data = (response as { data?: unknown } | null)?.data as {
      asset?: { mimeType?: string; name?: string };
    };
    expect(data.asset?.mimeType).toBe('image/png');
    expect(data.asset?.name).toBe('ncg-boot2.png');
  });

  it('previews a local markdown file as text', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-preview-md-'));
    const config = createDefaultPiwinConfig();
    config.providers = [];
    await savePiwinConfig(config, rootDir);
    const source = join(rootDir, 'notes.md');
    await writeFile(source, '# notes\n', 'utf8');

    const response = await handleMediaIngestCommand(
      {
        type: 'preview/read-local-file',
        input: { sessionId: 'sess-1', absolutePath: source },
      },
      'preview-md',
      createMinimalContext(rootDir),
    );

    expect(response).toMatchObject({
      success: true,
      data: { status: 'ready', kind: 'text', content: '# notes\n', readOnly: true },
    });
  });

  it('maps a missing file to an unavailable payload, not a transport error', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-preview-missing-'));
    const config = createDefaultPiwinConfig();
    config.providers = [];
    await savePiwinConfig(config, rootDir);

    const response = await handleMediaIngestCommand(
      {
        type: 'preview/read-local-file',
        input: { sessionId: 'sess-1', absolutePath: join(rootDir, 'gone.png') },
      },
      'preview-missing',
      createMinimalContext(rootDir),
    );

    expect(response).toMatchObject({
      success: true,
      data: { status: 'unavailable', reason: 'not-found' },
    });
  });
});

describe('handleMediaIngestCommand preview/export-local-file', () => {
  it('exports zip bytes for Save As', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-export-cmd-'));
    const source = join(rootDir, 'faces.zip');
    const bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x11, 0x22]);
    await writeFile(source, bytes);

    const response = await handleMediaIngestCommand(
      {
        type: 'preview/export-local-file',
        input: { absolutePath: source },
      },
      'export-ok',
      createMinimalContext(rootDir),
    );

    expect(response).toMatchObject({
      id: 'export-ok',
      success: true,
      command: 'preview/export-local-file',
      data: {
        status: 'ready',
        fileName: 'faces.zip',
        byteSize: bytes.byteLength,
      },
    });
    const data = (response as { data?: { base64Data?: string } } | null)?.data;
    expect(Buffer.from(data?.base64Data ?? '', 'base64')).toEqual(bytes);
  });
});
