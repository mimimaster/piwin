import { describe, expect, it, vi } from 'vitest';
import { createPiSessionCapabilities, type AgentEvent, type AgentPluginOutputDirectory, type SavedMediaAsset, type SessionBackendCapabilities } from '@piwin/contracts';
import { externalOperationRefusal, EXTERNAL_AGENT_UNSUPPORTED_COMMANDS } from './external-agent-policy.js';
import {
  importAgentPluginMedia,
  attachImportedMediaToEvent,
  resolveMediaSource,
  resolveOutputDirectoryRoot,
  type AgentPluginMediaContext,
} from './agent-plugin-media.js';

const DIRECTORIES: readonly AgentPluginOutputDirectory[] = [
  { id: 'images', base: 'user-home', relativePath: 'vendor/sessions/{encodedWorkingDirectory}/{backendSessionId}', kind: 'image' },
  { id: 'videos', base: 'user-home', relativePath: 'vendor/sessions/{encodedWorkingDirectory}/{backendSessionId}', kind: 'video' },
  { id: 'scratch', base: 'working-directory', relativePath: '.vendor/out', kind: 'image' },
];

function context(overrides: Partial<AgentPluginMediaContext> = {}): AgentPluginMediaContext {
  return {
    agentId: 'grok',
    sessionId: 'product-1',
    backendSessionId: 'backend-1',
    cwd: '/work/project',
    outputDirectories: DIRECTORIES,
    homeDir: '/home/fixture',
    ...overrides,
  };
}

describe('external agent operation policy', () => {
  it('refuses Pi-only commands for an external session by default', () => {
    expect(externalOperationRefusal('session/fork', undefined)).toEqual({
      operation: 'fork',
      reason: 'External agent sessions cannot be forked',
    });
    expect(externalOperationRefusal('session/compact', undefined)?.operation).toBe('compact');
  });

  it('lets an adapter that declares support keep the command', () => {
    const declared = createPiSessionCapabilities();
    expect(externalOperationRefusal('session/fork', declared)).toBeUndefined();
  });

  it('prefers the adapter reason when the adapter declares the operation unsupported', () => {
    const declared: SessionBackendCapabilities = {
      agentId: 'grok',
      operations: {
        ...createPiSessionCapabilities().operations,
        fork: { supported: false, reason: 'this adapter refuses forks' },
        pause: { supported: false, reason: 'no pause in this adapter' },
      },
    };
    expect(externalOperationRefusal('session/fork', declared)).toEqual({ operation: 'fork', reason: 'this adapter refuses forks' });
    expect(externalOperationRefusal('session/pause', declared)).toEqual({ operation: 'pause', reason: 'no pause in this adapter' });
    // An operation the adapter says it supports is not refused at all.
    expect(externalOperationRefusal('session/compact', declared)).toBeUndefined();
  });

  it('never refuses a command outside the Pi-only set', () => {
    for (const type of ['session/prompt', 'session/cancel', 'session/rename', 'session/delete']) {
      expect(externalOperationRefusal(type, undefined)).toBeUndefined();
    }
    expect(EXTERNAL_AGENT_UNSUPPORTED_COMMANDS.size).toBeGreaterThan(0);
  });
});

describe('imported media event projection', () => {
  const asset: SavedMediaAsset = {
    id: 'asset-1', sessionId: 'product-1', absolutePath: '/vault/product-1/asset-1.png',
    mimeType: 'image/png', byteSize: 10, createdAt: '2026-10-02T00:00:00.000Z',
  };
  const event: AgentEvent = { type: 'tool/end', toolCallId: 'image-1', responseMessageId: 'owner', isError: false };

  it('attaches only imported vault refs and preserves tool ownership', () => {
    expect(attachImportedMediaToEvent(event, [asset])).toEqual({
      ...event,
      attachments: [{ id: asset.id, kind: 'media', path: asset.absolutePath, mimeType: asset.mimeType, byteSize: 10, source: 'generated' }],
    });
  });

  it('deduplicates assets on replay without losing existing attachments', () => {
    const first = attachImportedMediaToEvent(event, [asset]);
    expect(attachImportedMediaToEvent(first, [asset, asset])).toEqual(first);
  });

  it('keeps failed tools and non-tool events unchanged', () => {
    const failed = { ...event, isError: true };
    expect(attachImportedMediaToEvent(failed, [asset])).toBe(failed);
    const text: AgentEvent = { type: 'message/text_delta', messageId: 'owner', delta: 'done' };
    expect(attachImportedMediaToEvent(text, [asset])).toBe(text);
    expect(attachImportedMediaToEvent(event, [])).toBe(event);
  });
});

describe('manifest-declared media directories', () => {
  it('expands both documented templates under the declared base', () => {
    expect(resolveOutputDirectoryRoot(DIRECTORIES[0]!, context())).toBe(
      '/home/fixture/vendor/sessions/%2Fwork%2Fproject/backend-1',
    );
    expect(resolveOutputDirectoryRoot(DIRECTORIES[2]!, context())).toBe('/work/project/.vendor/out');
  });

  it('refuses a directory the manifest never declared', () => {
    const proposal = { directoryId: 'secrets', relativePath: 'auth.json', kind: 'image' as const, importKey: 'k' };
    expect(resolveMediaSource(proposal, context())).toBeUndefined();
  });

  it('refuses a kind mismatch and traversal out of the declared root', () => {
    expect(resolveMediaSource({ directoryId: 'images', relativePath: 'a.png', kind: 'video', importKey: 'k' }, context())).toBeUndefined();
    expect(resolveMediaSource({ directoryId: 'images', relativePath: '../../auth.json', kind: 'image', importKey: 'k' }, context())).toBeUndefined();
  });

  it('resolves an allowed proposal inside its declared root', () => {
    const resolved = resolveMediaSource({ directoryId: 'images', relativePath: 'frame.png', kind: 'image', importKey: 'k' }, context());
    expect(resolved).toEqual({
      sourceRoot: '/home/fixture/vendor/sessions/%2Fwork%2Fproject/backend-1',
      sourcePath: '/home/fixture/vendor/sessions/%2Fwork%2Fproject/backend-1/frame.png',
    });
  });

  it('refuses an unsafe backend session id instead of building a path from it', () => {
    const root = resolveOutputDirectoryRoot(DIRECTORIES[0]!, context({ backendSessionId: '../escape' }));
    expect(root).toBeUndefined();
  });

  it('logs and skips an undeclared proposal without touching the vault', async () => {
    const push = vi.fn();
    const asset = await importAgentPluginMedia({
      proposal: { directoryId: 'secrets', relativePath: 'auth.json', kind: 'image', importKey: 'k' },
      context: context(),
      push,
    });
    expect(asset).toBeUndefined();
    expect(push).toHaveBeenCalledWith(expect.objectContaining({ type: 'host/log', level: 'warn' }));
  });
});
