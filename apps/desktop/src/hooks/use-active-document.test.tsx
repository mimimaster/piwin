// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HostClient } from '../host-client';
import { useActiveDocument } from './use-active-document';
import type { DocumentContentMessage } from '../resolve-document-content';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type HostRequestCall = {
  type: string;
  projectPath?: string;
  relativePath?: string;
  query?: string;
  skillId?: string;
  legacyPath?: string;
  sessionId?: string;
  messageId?: string;
  toolCallId?: string;
  input?: { sessionId?: string; assetId?: string; absolutePath?: string };
};

function createHostClientFake(options?: {
  projectRead?:
    | {
        success: true;
        isBinary?: boolean;
        content?: string;
        mimeHint?: string;
        byteSize?: number;
        previewDataUrl?: string;
        absolutePath?: string;
      }
    | { success: false };
  /** `project/find-file` answer for a missed chip path. */
  findFile?:
    | { success: true; matches: Array<{ relativePath: string }>; truncated?: boolean }
    | { success: false; error?: string };
  /** Make the local-Host ingest (`preview/read-local-file`) miss. */
  localPreviewUnavailable?: { reason: string } | boolean;
  /** Per-relative-path read override; falls back to `projectRead`. */
  projectReadByPath?: Record<string, { success: false } | { success: true; content: string }>;
}): { client: HostClient; request: ReturnType<typeof vi.fn> } {
  const request = vi.fn(async (command: HostRequestCall) => {
    if (command.type === 'project/find-file') {
      const findFile = options?.findFile;
      if (!findFile || findFile.success === false) {
        return {
          type: 'response' as const,
          command,
          success: false,
          error:
            findFile && findFile.success === false && findFile.error
              ? findFile.error
              : { message: 'find-file unavailable' },
        };
      }
      return {
        type: 'response' as const,
        command,
        success: true,
        data: {
          projectPath: command.projectPath ?? '/workspace',
          query: command.query ?? '',
          matches: findFile.matches,
          truncated: findFile.truncated === true,
        },
      };
    }
    if (command.type === 'project/read-file') {
      const override = command.relativePath
        ? options?.projectReadByPath?.[command.relativePath]
        : undefined;
      if (override?.success === false) {
        return {
          type: 'response' as const,
          command,
          success: false,
          error: { message: 'cannot stat file' },
        };
      }
      if (override?.success === true) {
        return {
          type: 'response' as const,
          command,
          success: true,
          data: {
            content: override.content,
            isBinary: false,
            byteSize: override.content.length,
            absolutePath: `${command.projectPath ?? '/workspace'}/${command.relativePath ?? ''}`,
          },
        };
      }
      if (options?.projectRead?.success === false) {
        return {
          type: 'response' as const,
          command,
          success: false,
          error: { message: 'cannot stat file' },
        };
      }
      const isBinary = options?.projectRead?.isBinary === true;
      return {
        type: 'response' as const,
        command,
        success: true,
        data: {
          content: isBinary ? '' : (options?.projectRead?.content ?? '# file body'),
          isBinary,
          ...(options?.projectRead?.mimeHint
            ? { mimeHint: options.projectRead.mimeHint }
            : {}),
          ...(options?.projectRead?.byteSize !== undefined
            ? { byteSize: options.projectRead.byteSize }
            : {}),
          ...(options?.projectRead?.previewDataUrl
            ? { previewDataUrl: options.projectRead.previewDataUrl }
            : {}),
          ...(options?.projectRead?.absolutePath
            ? { absolutePath: options.projectRead.absolutePath }
            : {}),
        },
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
    if (command.type === 'preview/read-local-file') {
      const absolutePath = command.input?.absolutePath ?? '';
      if (options?.localPreviewUnavailable) {
        return {
          type: 'response' as const,
          command,
          success: true,
          data: {
            status: 'unavailable',
            reason:
              typeof options.localPreviewUnavailable === 'object'
                ? options.localPreviewUnavailable.reason
                : 'not-found',
          },
        };
      }
      if (absolutePath.includes('missing')) {
        return {
          type: 'response' as const,
          command,
          success: true,
          data: { status: 'unavailable', reason: 'not-found' },
        };
      }
      if (/\.(zip|bin)$/i.test(absolutePath)) {
        return {
          type: 'response' as const,
          command,
          success: true,
          data: {
            status: 'unavailable',
            reason: 'binary',
            suggestion: '该文件不是可预览的文本或图片。',
          },
        };
      }
      if (/\.(png|jpe?g|gif|webp)$/i.test(absolutePath)) {
        return {
          type: 'response' as const,
          command,
          success: true,
          data: {
            status: 'ready',
            kind: 'media',
            asset: {
              id: 'ingested-1',
              sessionId: command.input?.sessionId ?? 'session-1',
              absolutePath: `/Users/t/.piwin/media/${command.input?.sessionId ?? 'session-1'}/ingested-1.png`,
              mimeType: 'image/png',
              byteSize: 12,
              createdAt: '2026-08-22T00:00:00.000Z',
              name: 'ncg-boot2.png',
            },
          },
        };
      }
      return {
        type: 'response' as const,
        command,
        success: true,
        data: {
          status: 'ready',
          kind: 'text',
          content: '# local file\n',
          byteSize: 13,
          truncated: false,
          readOnly: true,
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
    if (command.type === 'session/tool-output') {
      return {
        type: 'response' as const,
        command,
        success: true,
        data: {
          status: 'ready',
          output: '# Image Generation\n\nSnapshot body.\n',
          truncated: false,
        },
      };
    }
    if (command.type === 'skills/read') {
      return {
        type: 'response' as const,
        command,
        success: true,
        data: {
          status: 'ready',
          skillId: command.skillId ?? 'imagegen',
          name: command.skillId ?? 'imagegen',
          displayRef: `skill:${command.skillId ?? 'imagegen'}`,
          content: '# current skill\n',
          provenance: 'current-resource',
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

  function renderHarness(
    client: HostClient,
    options?: {
      projectPath?: string | null;
      messages?: readonly DocumentContentMessage[];
    },
  ): void {
    const Harness = () => {
      latest = useActiveDocument({
        hostClient: client,
        revealPreview: reveal,
        activeSessionId: 'session-1',
        projectPath: options?.projectPath === undefined ? '/workspace' : options.projectPath,
        messages: options?.messages ?? [],
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

  it('previews a `.svg` chip from the transcript instead of outside-project', async () => {
    reveal = vi.fn();
    const svg = '<svg viewBox="0 0 100 60"><circle cx="50" cy="30" r="20" /></svg>';
    const { client, request } = createHostClientFake();
    renderHarness(client, {
      projectPath: null,
      messages: [
        {
          text: [
            '2D 鹈鹕 SVG 生成',
            '',
            '```svg',
            svg,
            '```',
            '',
            '你可以直接将这段 SVG 保存为 `.svg` 文件在浏览器中打开查看。',
          ].join('\n'),
        },
      ],
    });

    await act(async () => {
      latest.openDocument({ title: '.svg', path: '.svg' });
    });

    expect(request).not.toHaveBeenCalled();
    expect(latest.activeDocument?.status).toBe('ready');
    if (latest.activeDocument?.status === 'ready') {
      expect(latest.activeDocument.title).toBe('SVG');
      expect(latest.activeDocument.content).toBe(svg);
      expect(latest.activeDocument.provenance).toBe('transcript');
      expect(latest.activeDocument.filePath).toBe('.svg');
    }
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
      expect(latest.activeDocument.media?.dataUrl).toMatch(/^(blob:|data:)/);
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

  it('previews /tmp text on the local Host instead of outside-project', async () => {
    reveal = vi.fn();
    const { client, request } = createHostClientFake();
    renderHarness(client);

    await act(async () => {
      latest.openDocument({ title: 'outside.md', path: '/tmp/outside.md' });
    });

    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[0]).toMatchObject({
      type: 'preview/read-local-file',
      input: { sessionId: 'session-1', absolutePath: '/tmp/outside.md' },
    });
    expect(latest.activeDocument?.status).toBe('ready');
    if (latest.activeDocument?.status === 'ready') {
      expect(latest.activeDocument.content).toBe('# local file\n');
      expect(latest.activeDocument.readOnly).toBe(true);
    }
  });

  it('previews a clicked /tmp image as session media on the local Host', async () => {
    reveal = vi.fn();
    const { client, request } = createHostClientFake();
    renderHarness(client);

    await act(async () => {
      latest.openDocument({ title: 'ncg-boot2.png', path: '/tmp/ncg-boot2.png' });
    });

    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[0]).toMatchObject({
      type: 'preview/read-local-file',
      input: { sessionId: 'session-1', absolutePath: '/tmp/ncg-boot2.png' },
    });
    expect(latest.activeDocument?.status).toBe('ready');
    if (latest.activeDocument?.status === 'ready') {
      expect(latest.activeDocument.provenance).toBe('session-media');
      expect(latest.activeDocument.media?.path).toBe(
        '/Users/t/.piwin/media/session-1/ingested-1.png',
      );
    }
  });

  it('keeps a missing /tmp image as unavailable after ingest fails', async () => {
    reveal = vi.fn();
    const { client } = createHostClientFake();
    renderHarness(client);

    await act(async () => {
      latest.openDocument({ title: 'missing.png', path: '/tmp/missing.png' });
    });

    expect(latest.activeDocument?.status).toBe('unavailable');
    if (latest.activeDocument?.status === 'unavailable') {
      expect(latest.activeDocument.reason).toBe('not-found');
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

  it('does not report not-found when a project zip is binary', async () => {
    reveal = vi.fn();
    const { client, request } = createHostClientFake({
      projectRead: { success: true, isBinary: true },
    });
    renderHarness(client);

    await act(async () => {
      latest.openDocument({ title: 'out.zip', path: 'cropped-portraits-16.zip' });
    });

    expect(request.mock.calls.some((call) => call[0]?.type === 'preview/read-local-file')).toBe(
      false,
    );
    expect(latest.activeDocument?.status).toBe('unavailable');
    if (latest.activeDocument?.status === 'unavailable') {
      expect(latest.activeDocument.reason).toBe('binary');
      expect(latest.activeDocument.reason).not.toBe('not-found');
    }
  });

  it('opens a project image from previewDataUrl without local ingest', async () => {
    reveal = vi.fn();
    const { client, request } = createHostClientFake({
      projectRead: {
        success: true,
        isBinary: true,
        mimeHint: 'image/png',
        byteSize: 16,
        previewDataUrl: 'data:image/png;base64,AAAA',
        absolutePath: '/workspace/icon.png',
      },
    });
    renderHarness(client);

    await act(async () => {
      latest.openDocument({ title: 'icon.png', path: 'icon.png' });
    });

    expect(request.mock.calls.map((call) => call[0]?.type)).toEqual(['project/read-file']);
    expect(latest.activeDocument?.status).toBe('ready');
    if (latest.activeDocument?.status === 'ready') {
      expect(latest.activeDocument.media?.dataUrl).toBe('data:image/png;base64,AAAA');
      expect(latest.activeDocument.media?.path).toBe('/workspace/icon.png');
    }
  });

  it('falls back to local preview when project/read-file fails', async () => {
    reveal = vi.fn();
    const { client, request } = createHostClientFake({
      projectRead: { success: false },
    });
    renderHarness(client);

    await act(async () => {
      latest.openDocument({ title: 'notes.md', path: 'notes.md' });
    });

    expect(request.mock.calls.map((call) => call[0]?.type)).toEqual([
      'project/read-file',
      // Missed project read: resolve the real place before local ingest.
      'project/find-file',
      'preview/read-local-file',
    ]);
    expect(latest.activeDocument?.status).toBe('ready');
    if (latest.activeDocument?.status === 'ready') {
      expect(latest.activeDocument.content).toBe('# local file\n');
      expect(latest.activeDocument.readOnly).toBe(true);
    }
  });

  it('recovers a historical skill read from the tool snapshot before skills/read', async () => {
    reveal = vi.fn();
    const { client, request } = createHostClientFake();
    renderHarness(client, { projectPath: '/Users/me/Developer/CCursor' });

    await act(async () => {
      latest.openDocument({
        title: 'imagegen',
        path: '/Users/me/.piwin-test/skills/imagegen/SKILL.md',
        target: { kind: 'skill', skillId: 'imagegen', displayRef: 'skill:imagegen' },
        messageId: 'piw-m-skill',
        toolCallId: 'piw-t-skill',
      });
    });

    expect(request.mock.calls.map((call) => call[0]?.type)).toEqual(['session/tool-output']);
    expect(latest.activeDocument?.status).toBe('ready');
    if (latest.activeDocument?.status === 'ready') {
      expect(latest.activeDocument.content).toContain('Snapshot body');
      expect(latest.activeDocument.provenance).toBe('tool-snapshot');
    }
  });

  it('loads the current skill document when no tool snapshot identity is present', async () => {
    reveal = vi.fn();
    const { client, request } = createHostClientFake();
    renderHarness(client, { projectPath: '/Users/me/Developer/CCursor' });

    await act(async () => {
      latest.openDocument({
        title: 'SKILL.md',
        path: '/Users/me/.piwin-test/skills/imagegen/SKILL.md',
      });
    });

    expect(request.mock.calls.map((call) => call[0]?.type)).toEqual(['skills/read']);
    expect(request.mock.calls[0]?.[0]).toMatchObject({
      type: 'skills/read',
      skillId: 'imagegen',
      legacyPath: '/Users/me/.piwin-test/skills/imagegen/SKILL.md',
    });
    expect(latest.activeDocument?.status).toBe('ready');
    if (latest.activeDocument?.status === 'ready') {
      expect(latest.activeDocument.content).toBe('# current skill\n');
      expect(latest.activeDocument.provenance).toBe('current-resource');
    }
  });

  it('resolves a bare file name through project/find-file when the root read misses', async () => {
    reveal = vi.fn();
    const { client, request } = createHostClientFake({
      projectRead: { success: false },
      findFile: {
        success: true,
        matches: [{ relativePath: 'docs/design/inkstone/shots/01-endpoint-loop.png' }],
      },
      projectReadByPath: {
        'docs/design/inkstone/shots/01-endpoint-loop.png': {
          success: true,
          content: 'png-bytes-here',
        },
      },
    });
    renderHarness(client);

    await act(async () => {
      latest.openDocument({ title: '01-endpoint-loop.png', path: '01-endpoint-loop.png' });
    });

    expect(request.mock.calls.map((call) => call[0]?.type)).toEqual([
      'project/read-file',
      'project/find-file',
      'project/read-file',
    ]);
    expect(request.mock.calls[1]?.[0]).toMatchObject({
      type: 'project/find-file',
      projectPath: '/workspace',
      query: '01-endpoint-loop.png',
    });
    expect(request.mock.calls[2]?.[0]).toMatchObject({
      type: 'project/read-file',
      relativePath: 'docs/design/inkstone/shots/01-endpoint-loop.png',
    });
    expect(latest.activeDocument?.status).toBe('ready');
    if (latest.activeDocument?.status === 'ready') {
      expect(latest.activeDocument.displayRef).toBe(
        'docs/design/inkstone/shots/01-endpoint-loop.png',
      );
      expect(latest.activeDocument.content).toBe('png-bytes-here');
    }
  });

  it('reports an ambiguous file name instead of opening one of several matches', async () => {
    reveal = vi.fn();
    const { client, request } = createHostClientFake({
      projectRead: { success: false },
      findFile: {
        success: true,
        matches: [{ relativePath: 'a/README.md' }, { relativePath: 'b/README.md' }],
      },
    });
    renderHarness(client);

    await act(async () => {
      latest.openDocument({ title: 'README.md', path: 'README.md' });
    });

    expect(request.mock.calls.map((call) => call[0]?.type)).toEqual([
      'project/read-file',
      'project/find-file',
    ]);
    expect(latest.activeDocument?.status).toBe('unavailable');
    if (latest.activeDocument?.status === 'unavailable') {
      expect(latest.activeDocument.reason).toBe('ambiguous-file');
    }
  });

  it('does not treat a truncated single match as the only candidate', async () => {
    reveal = vi.fn();
    const { client, request } = createHostClientFake({
      projectRead: { success: false },
      findFile: {
        success: true,
        matches: [{ relativePath: 'a/README.md' }],
        truncated: true,
      },
    });
    renderHarness(client);

    await act(async () => {
      latest.openDocument({ title: 'README.md', path: 'README.md' });
    });

    expect(request.mock.calls.map((call) => call[0]?.type)).toEqual([
      'project/read-file',
      'project/find-file',
      'preview/read-local-file',
    ]);
    expect(latest.activeDocument?.status).toBe('ready');
  });

  it('resolves an absolute chip inside the workspace after the local ingest misses', async () => {
    // The chip names the workspace through /tmp while the session root is the
    // /private/tmp form (same folder) — the shape that used to end in
    // "file not found" for a file that plainly exists.
    reveal = vi.fn();
    const { client, request } = createHostClientFake({
      localPreviewUnavailable: true,
      projectReadByPath: { 'PATH-RETEST.md': { success: true, content: 'path-ok' } },
    });
    renderHarness(client);

    await act(async () => {
      latest.openDocument({
        title: 'PATH-RETEST.md',
        path: '/tmp/workspace/PATH-RETEST.md',
      });
    });

    expect(request.mock.calls.map((call) => call[0]?.type)).toEqual([
      'preview/read-local-file',
      'project/read-file',
    ]);
    expect(request.mock.calls[1]?.[0]).toMatchObject({
      type: 'project/read-file',
      projectPath: '/workspace',
      relativePath: 'PATH-RETEST.md',
    });
    expect(latest.activeDocument?.status).toBe('ready');
    if (latest.activeDocument?.status === 'ready') {
      expect(latest.activeDocument.content).toBe('path-ok');
    }
  });

  it('finds an absolute chip in a subfolder through project/find-file', async () => {
    reveal = vi.fn();
    const { client, request } = createHostClientFake({
      localPreviewUnavailable: true,
      projectRead: { success: false },
      findFile: { success: true, matches: [{ relativePath: 'docs/design/shot.png' }] },
      projectReadByPath: { 'docs/design/shot.png': { success: true, content: 'png-here' } },
    });
    renderHarness(client);

    await act(async () => {
      latest.openDocument({
        title: 'shot.png',
        path: '/tmp/workspace/shot.png',
      });
    });

    expect(request.mock.calls.map((call) => call[0]?.type)).toEqual([
      'preview/read-local-file',
      'project/read-file',
      'project/find-file',
      'project/read-file',
    ]);
    expect(request.mock.calls[2]?.[0]).toMatchObject({
      type: 'project/find-file',
      query: 'shot.png',
    });
    expect(latest.activeDocument?.status).toBe('ready');
    if (latest.activeDocument?.status === 'ready') {
      expect(latest.activeDocument.displayRef).toBe('docs/design/shot.png');
    }
  });

  it('says the workspace folder is gone instead of blaming the file', async () => {
    reveal = vi.fn();
    const { client } = createHostClientFake({
      projectRead: { success: false },
      localPreviewUnavailable: true,
      findFile: { success: false, error: 'project-root-missing' },
    });
    renderHarness(client);

    await act(async () => {
      latest.openDocument({
        title: 'PATH-RETEST.md',
        path: '/tmp/workspace/PATH-RETEST.md',
      });
    });

    expect(latest.activeDocument?.status).toBe('unavailable');
    if (latest.activeDocument?.status === 'unavailable') {
      expect(latest.activeDocument.reason).toBe('project-root-missing');
    }
  });

  it('reports a vanished workspace for a relative project chip too', async () => {
    reveal = vi.fn();
    const { client } = createHostClientFake({
      projectRead: { success: false },
      findFile: { success: false, error: 'project-root-missing' },
    });
    renderHarness(client);

    await act(async () => {
      latest.openDocument({ title: 'notes.md', path: 'notes.md' });
    });

    expect(latest.activeDocument?.status).toBe('unavailable');
    if (latest.activeDocument?.status === 'unavailable') {
      expect(latest.activeDocument.reason).toBe('project-root-missing');
    }
  });
});
