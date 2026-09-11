// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HostCommand, HostResponse } from '@piwin/contracts';
import { useSessionKnowledgeMounts } from './use-session-knowledge-mounts.js';
import type { KnowledgeMountsValue } from './knowledge-mounts-context.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function ok(command: HostCommand, data: unknown = {}): HostResponse {
  return { type: 'response', command: command.type, success: true, data };
}

/** `useKnowledgeBases` fires `knowledge/bases/list` on mount regardless of session state. */
function mountCalls(request: ReturnType<typeof vi.fn>): unknown[] {
  return request.mock.calls
    .map((args) => args[0] as HostCommand)
    .filter((command) => command.type === 'session/set-knowledge-bases');
}

describe('useSessionKnowledgeMounts', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  function renderHook(request: ReturnType<typeof vi.fn>) {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    let captured: KnowledgeMountsValue | undefined;
    function Harness(props: { activeSessionId: string | null; sessionMountedIds?: string[] }): null {
      captured = useSessionKnowledgeMounts({
        request,
        supported: true,
        activeSessionId: props.activeSessionId,
        sessionMountedIds: props.sessionMountedIds,
        onOpenManager: vi.fn(),
      });
      return null;
    }
    // Flushes the mocked request's resolved promise (e.g. useKnowledgeBases'
    // mount-time list call) inside the same act() so no update escapes it.
    const render = async (props: { activeSessionId: string | null; sessionMountedIds?: string[] }) => {
      await act(async () => {
        root?.render(<Harness {...props} />);
        await Promise.resolve();
      });
    };
    const act1 = async (fn: () => void) => {
      await act(async () => {
        fn();
        await Promise.resolve();
      });
    };
    return {
      render,
      act1,
      latest: (): KnowledgeMountsValue => {
        if (captured === undefined) throw new Error('useSessionKnowledgeMounts was not rendered');
        return captured;
      },
    };
  }

  it('holds a draft mount locally with no active session and issues no request', async () => {
    const request = vi.fn(async (command: HostCommand) => ok(command));
    const { render, act1, latest } = renderHook(request);
    await render({ activeSessionId: null });
    expect(latest().mountedIds).toEqual([]);

    await act1(() => latest().toggle('folder:a'));
    expect(latest().mountedIds).toEqual(['folder:a']);
    expect(mountCalls(request)).toEqual([]);
  });

  it('clearDraft resets the draft with no request', async () => {
    const request = vi.fn(async (command: HostCommand) => ok(command));
    const { render, act1, latest } = renderHook(request);
    await render({ activeSessionId: null });
    await act1(() => latest().mount('folder:a'));
    expect(latest().mountedIds).toEqual(['folder:a']);

    await act1(() => latest().clearDraft());
    expect(latest().mountedIds).toEqual([]);
    expect(mountCalls(request)).toEqual([]);
  });

  it('toggling on an existing session commits via session/set-knowledge-bases', async () => {
    const request = vi.fn(async (command: HostCommand) => ok(command));
    const { render, act1, latest } = renderHook(request);
    await render({ activeSessionId: 'sess-1', sessionMountedIds: [] });

    await act1(() => latest().toggle('folder:a'));

    expect(request).toHaveBeenCalledWith({
      type: 'session/set-knowledge-bases',
      sessionId: 'sess-1',
      baseIds: ['folder:a'],
    });
  });

  it('a session appearing after a draft mount choice does not replay it as a follow-up write', async () => {
    // Regression guard: session/create now carries knowledgeBaseIds directly
    // (see use-composer-send.ts), so this hook must never re-issue
    // session/set-knowledge-bases just because activeSessionId went from
    // null to a real id — that was the exact race this fix closes. Bringing
    // back the old "apply draftIds once session exists" effect would make
    // this test fail.
    const request = vi.fn(async (command: HostCommand) => ok(command));
    const { render, act1, latest } = renderHook(request);
    await render({ activeSessionId: null });
    await act1(() => latest().mount('folder:a'));
    expect(latest().mountedIds).toEqual(['folder:a']);

    // The session now exists with that mount already attached at creation —
    // exactly what session/create.knowledgeBaseIds produces.
    await render({ activeSessionId: 'sess-1', sessionMountedIds: ['folder:a'] });

    expect(mountCalls(request)).toEqual([]);
    expect(latest().mountedIds).toEqual(['folder:a']);
  });

  it('an error surfaces once the Host rejects the requested ids', async () => {
    const request = vi.fn(async (): Promise<HostResponse> => ({
      type: 'response',
      command: 'session/set-knowledge-bases',
      success: false,
      error: 'nope',
    }));
    const { render, act1, latest } = renderHook(request);
    await render({ activeSessionId: 'sess-1', sessionMountedIds: [] });

    await act1(() => latest().toggle('folder:a'));
    expect(latest().error).toBe('nope');
  });
});
