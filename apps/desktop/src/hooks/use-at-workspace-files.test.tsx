// @vitest-environment happy-dom
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HostCommand, HostResponse } from '@piwin/contracts';
import type { HostClient } from '../host-client';
import { useAtWorkspaceFiles } from './use-at-workspace-files';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function listDirResponse(
  relativePath: string,
  entries: ReadonlyArray<{ name: string; relativePath: string; kind: 'file' | 'directory' }>,
): HostResponse {
  return {
    type: 'response',
    command: 'project/list-dir',
    success: true,
    data: { projectPath: '/p', relativePath, entries },
  };
}

describe('useAtWorkspaceFiles', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
  });

  function renderHook(hostClient: Pick<HostClient, 'request' | 'supportsCommand'>): {
    current: ReturnType<typeof useAtWorkspaceFiles>;
  } {
    const captured: { current: ReturnType<typeof useAtWorkspaceFiles> } = { current: [] };
    const stableClient = hostClient as HostClient;
    function Harness(): ReactElement | null {
      captured.current = useAtWorkspaceFiles({
        hostClient: stableClient,
        projectPath: '/p',
        projectTrusted: true,
      });
      return null;
    }
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(<Harness />);
    });
    return captured;
  }

  it('indexes files through project/list-dir without reading the filesystem', async () => {
    const request = vi.fn(async (_command: HostCommand): Promise<HostResponse> =>
      listDirResponse('', [{ name: 'README.md', relativePath: 'README.md', kind: 'file' }]),
    );
    const captured = renderHook({
      request,
      supportsCommand: () => true,
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(captured.current).toEqual([{ relativePath: 'README.md', kind: 'file' }]);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith({ type: 'project/list-dir', projectPath: '/p' });
  });

  it('stays empty when the project is untrusted', () => {
    const request = vi.fn();
    const captured: { current: ReturnType<typeof useAtWorkspaceFiles> } = { current: [] };
    function Harness(): ReactElement | null {
      captured.current = useAtWorkspaceFiles({
        hostClient: {
          request,
          supportsCommand: () => true,
        } as unknown as HostClient,
        projectPath: '/p',
        projectTrusted: false,
      });
      return null;
    }
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(<Harness />);
    });
    expect(captured.current).toEqual([]);
    expect(request).not.toHaveBeenCalled();
  });

  it('stays empty when list-dir is unavailable', () => {
    const request = vi.fn();
    const captured: { current: ReturnType<typeof useAtWorkspaceFiles> } = { current: [] };
    function Harness(): ReactElement | null {
      captured.current = useAtWorkspaceFiles({
        hostClient: {
          request,
          supportsCommand: () => false,
        } as unknown as HostClient,
        projectPath: '/p',
        projectTrusted: true,
      });
      return null;
    }
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(<Harness />);
    });
    expect(captured.current).toEqual([]);
    expect(request).not.toHaveBeenCalled();
  });
});
