import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HostCommandContext } from './host-command-context.js';
import { handleCatalogCommand } from './catalog-commands.js';
import { createDefaultPiwinConfig, savePiwinConfig } from '../config-store.js';

function createMinimalContext(rootDir: string): HostCommandContext {
  return {
    piwinRoot: rootDir,
    push: () => {},
    requireSession: () => {
      throw new Error('session not needed for speech transcription');
    },
    getMcpManager: () => {
      throw new Error('mcp not needed for speech transcription');
    },
    getJobController: () => {
      throw new Error('jobs not needed for speech transcription');
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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('handleCatalogCommand speech/transcribe', () => {
  it('uses the configured ASR model and returns text without writing audio', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-speech-command-'));
    const config = createDefaultPiwinConfig();
    config.providers = [
      {
        id: 'local-whisper',
        protocol: 'openai-compatible',
        name: 'Local Whisper',
        baseUrl: 'http://127.0.0.1:8080/v1',
        models: [{ id: 'whisper-local', capabilities: ['speech-to-text'] }],
      },
    ];
    config.speech = {
      asr: {
        defaultModel: {
          protocol: 'openai-compatible',
          providerId: 'local-whisper',
          modelId: 'whisper-local',
        },
      },
    };
    await savePiwinConfig(config, rootDir);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response(JSON.stringify({ text: 'transcribed text' }), { status: 200 }),
      ),
    );

    const response = await handleCatalogCommand(
      {
        type: 'speech/transcribe',
        input: { mimeType: 'audio/webm', base64Data: 'AQID', durationMs: 1_000 },
      },
      'speech-request',
      createMinimalContext(rootDir),
    );

    expect(response).toMatchObject({
      type: 'response',
      command: 'speech/transcribe',
      success: true,
      data: {
        text: 'transcribed text',
        model: {
          protocol: 'openai-compatible',
          providerId: 'local-whisper',
          modelId: 'whisper-local',
        },
        durationMs: expect.any(Number),
      },
    });
  });

  it('fails safely when no ASR default is configured', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-speech-command-empty-'));
    await savePiwinConfig(createDefaultPiwinConfig(), rootDir);
    const response = await handleCatalogCommand(
      { type: 'speech/transcribe', input: { mimeType: 'audio/webm', base64Data: 'AQID' } },
      undefined,
      createMinimalContext(rootDir),
    );
    expect(response).toMatchObject({
      command: 'speech/transcribe',
      success: false,
      error: 'ASR model is not configured.',
    });
  });
});
