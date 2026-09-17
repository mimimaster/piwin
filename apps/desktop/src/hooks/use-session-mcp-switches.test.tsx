// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HostCommand, HostResponse } from '@piwin/contracts';
import type { HostClient } from '../host-client';
import { useSessionMcpSwitches, type SessionMcpSwitches } from './use-session-mcp-switches.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type HarnessProps = { activeSessionId: string | null; sessionDisabledServerIds?: string[] };

function fakeHostClient(
  request: (command: HostCommand) => Promise<HostResponse>,
  supported = true,
): HostClient {
  return {
    request,
    supportsCommand: () => supported,
  } as unknown as HostClient;
}

describe('useSessionMcpSwitches', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  function renderHook(hostClient: HostClient) {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    let captured: SessionMcpSwitches | undefined;
    function Harness(props: HarnessProps): null {
      captured = useSessionMcpSwitches({
        hostClient,
        activeSessionId: props.activeSessionId,
        sessionDisabledServerIds: props.sessionDisabledServerIds,
      });
      return null;
    }
    const render = async (props: HarnessProps) => {
      await act(async () => {
        root?.render(<Harness {...props} />);
        await Promise.resolve();
      });
    };
    const run = async (fn: () => void) => {
      await act(async () => {
        fn();
        await Promise.resolve();
      });
    };
    return {
      render,
      run,
      latest: (): SessionMcpSwitches => {
        if (captured === undefined) throw new Error('useSessionMcpSwitches was not rendered');
        return captured;
      },
    };
  }

  it('holds draft switches locally and exposes them for session/create', async () => {
    const request = vi.fn();
    const { render, run, latest } = renderHook(fakeHostClient(request));
    await render({ activeSessionId: null });

    await run(() => latest().setServerEnabled('github', false));
    expect(latest().disabledServerIds).toEqual(['github']);
    expect(latest().draftDisabledServerIds).toEqual(['github']);
    expect(request).not.toHaveBeenCalled();

    await run(() => latest().clearDraft());
    expect(latest().draftDisabledServerIds).toEqual([]);
  });

  it('commits an existing session optimistically until the index push catches up', async () => {
    const request = vi.fn(
      async (command: HostCommand): Promise<HostResponse> => ({
        type: 'response',
        command: command.type,
        success: true,
        data: {},
      }),
    );
    const { render, run, latest } = renderHook(fakeHostClient(request));
    await render({ activeSessionId: 's1' });

    await run(() => latest().setServerEnabled('github', false));
    expect(request).toHaveBeenCalledWith({
      type: 'session/set-mcp-servers',
      sessionId: 's1',
      disabledServerIds: ['github'],
    });
    expect(latest().disabledServerIds).toEqual(['github']);
    expect(latest().draftDisabledServerIds).toEqual([]);

    await render({ activeSessionId: 's1', sessionDisabledServerIds: ['github'] });
    await run(() => latest().setServerEnabled('github', true));
    expect(request).toHaveBeenLastCalledWith({
      type: 'session/set-mcp-servers',
      sessionId: 's1',
      disabledServerIds: [],
    });
  });

  it('rolls back and reports when the Host rejects the change', async () => {
    const request = vi.fn(
      async (command: HostCommand): Promise<HostResponse> => ({
        type: 'response',
        command: command.type,
        success: false,
        error: 'Unknown session: s1',
      }),
    );
    const { render, run, latest } = renderHook(fakeHostClient(request));
    await render({ activeSessionId: 's1' });

    await run(() => latest().setServerEnabled('github', false));
    expect(latest().disabledServerIds).toEqual([]);
    expect(latest().error).toBe('Unknown session: s1');
  });

  it('reports unsupported Hosts so the flyout renders read-only', async () => {
    const { render, latest } = renderHook(fakeHostClient(vi.fn(), false));
    await render({ activeSessionId: 's1' });
    expect(latest().supported).toBe(false);
  });
});
