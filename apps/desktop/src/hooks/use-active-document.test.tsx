// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HostClient } from '../host-client';
import { useActiveDocument } from './use-active-document';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type HostRequestCall = { type: string; input?: { sessionId?: string; assetId?: string } };

function createHostClientFake(): { client: HostClient; request: ReturnType<typeof vi.fn> } {
  const request = vi.fn(async (command: HostRequestCall) => {
    if (command.type === 'project/read-file') {
      return {
        type: 'response' as const,
        command,
        success: true,
        data: { content: '# file body', isBinary: false },
      };
    }
    if (command.type === 'media/read') {
      return {
        type: 'response' as const,
        command,
        success: true,
        data: {
          status: 'ready',
          assetId: command.input?.assetId ?? 'unknown',
          sessionId: command.input?.sessionId ?? 'unknown',
          mimeType: 'image/png',
          byteSize: 4,
          base64Data: 'AQIDBA==',
        },
      };
    }
    if (command.type === 'preview/read-trusted-text') {
      return {
        type: 'response' as const,
        command,
        success: true,
        data: {
          status: 'ready',
          relativePath: 'config.json',
          displayRef: 'config.json',
          content: '{"ok":true}\n',
          byteSize: 12,
          truncated: false,
          readOnly: true,
        },
      };
    }
    return { type: 'response' as const, command, success: false, error: { message: 'nope' } };
  });
  return { client: { request } as unknown as HostClient, request };
}

describe('useActiveDocument', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let latest: ReturnType<typeof useActiveDocument>;
  let reveal: ReturnType<typeof vi.fn>;

  function renderHarness(client: HostClient): void {
    const Harness = () => {
      latest = useActiveDocument({
        hostClient: client,
        revealPreview: reveal,
        activeSessionId: 'session-1',
        projectPath: '/workspace',
        messages: [],
      });
      return null;
    };
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() => root?.render(<Harness />));
  }

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
    }
    container?.remove();
    root = null;
    container = null;
    reveal = vi.fn();
    latest = undefined as unknown as ReturnType<typeof useActiveDocument>;
  });

  it('opens media vault paths as ready session-media without any host read', async () => {
    reveal = vi.fn();
    const { client, request } = createHostClientFake();
    renderHarness(client);

    await act(async () => {
      latest.openDocument({
        title: 'gen.jpg',
        path: '/Users/t/.piwin/media/session-1/0b1c2d.jpg',
      });
    });

    expect(reveal).toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    expect(latest.activeDocument?.status).toBe('ready');
    if (latest.activeDocument?.status === 'ready') {
      expect(latest.activeDocument.provenance).toBe('session-media');
      expect(latest.activeDocument.media?.path).toBe(
        '/Users/t/.piwin/media/session-1/0b1c2d.jpg',
      );
      expect(latest.activeDocument.content).toBe('');
    }
  });

  it('fetches remote media bytes through media/read for structured media targets', async () => {
    reveal = vi.fn();
    const { client, request } = createHostClientFake();
    renderHarness(client);

    await act(async () => {
      latest.openDocument({
        title: 'gen.png',
        target: { kind: 'media', sessionId: 'session-1', assetId: 'asset-9', displayRef: 'gen.png' },
      });
    });

    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[0]).toMatchObject({
      type: 'media/read',
      input: { sessionId: 'session-1', assetId: 'asset-9' },
    });
    expect(latest.activeDocument?.status).toBe('ready');
    if (latest.activeDocument?.status === 'ready') {
      expect(latest.activeDocument.provenance).toBe('session-media');
      expect(latest.activeDocument.media?.dataUrl).toContain('data:image/png;base64,AQIDBA==');
    }
  });

  it('rejects a bare remote-asset path (no session identity) as unavailable', async () => {
    reveal = vi.fn();
    const { client, request } = createHostClientFake();
    renderHarness(client);

    await act(async () => {
      latest.openDocument({ title: 'gen.png', path: 'remote-asset:asset-9' });
    });

    expect(request).not.toHaveBeenCalled();
    expect(latest.activeDocument?.status).toBe('unavailable');
    if (latest.activeDocument?.status === 'unavailable') {
      expect(latest.activeDocument.reason).toBe('media-unavailable');
    }
  });

  it('still reads project text through project/read-file', async () => {
    reveal = vi.fn();
    const { client, request } = createHostClientFake();
    renderHarness(client);

    await act(async () => {
      latest.openDocument({ title: 'foo.md', path: '/workspace/docs/foo.md' });
    });

    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[0]).toMatchObject({
      type: 'project/read-file',
      projectPath: '/workspace',
      relativePath: 'docs/foo.md',
    });
    expect(latest.activeDocument?.status).toBe('ready');
    if (latest.activeDocument?.status === 'ready') {
      expect(latest.activeDocument.content).toBe('# file body');
      expect(latest.activeDocument.provenance).toBe('project-current');
    }
  });

  it('keeps outside-project text as an explicit unavailable state', async () => {
    reveal = vi.fn();
    const { client, request } = createHostClientFake();
    renderHarness(client);

    await act(async () => {
      latest.openDocument({ title: 'outside.md', path: '/tmp/outside.md' });
    });

    expect(request).not.toHaveBeenCalled();
    expect(latest.activeDocument?.status).toBe('unavailable');
    if (latest.activeDocument?.status === 'unavailable') {
      expect(latest.activeDocument.reason).toBe('outside-project');
    }
  });

  it('opens a structured trusted-config target through preview/read-trusted-text', async () => {
    reveal = vi.fn();
    const { client, request } = createHostClientFake();
    renderHarness(client);

    await act(async () => {
      latest.openDocument({
        title: 'config.json',
        target: {
          kind: 'trusted-config',
          relativePath: 'config.json',
          displayRef: 'config.json',
        },
      });
    });

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'preview/read-trusted-text',
        input: { relativePath: 'config.json' },
      }),
    );
    expect(latest.activeDocument?.status).toBe('ready');
    if (latest.activeDocument?.status === 'ready') {
      expect(latest.activeDocument.content).toBe('{"ok":true}\n');
      expect(latest.activeDocument.provenance).toBe('trusted-config');
      expect(latest.activeDocument.readOnly).toBe(true);
    }
  });
});
