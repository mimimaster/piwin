// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ExecutionRunRecord, HostCommand, HostResponse } from '@piwin/contracts';
import type { HostClient, HostSequenceGapHandler } from '../host-client.js';
import type { ChatUiAction } from '../chat-reducer.js';
import { useRunReconcile } from './use-run-reconcile.js';

type ScriptedResponse =
  | { kind: 'run'; run: ExecutionRunRecord | null }
  | { kind: 'fail' };

class FakeHostClient {
  readonly requests: HostCommand[] = [];
  private gapHandler: HostSequenceGapHandler | null = null;
  private foregroundRunResponse: ScriptedResponse | undefined;

  registerSequenceGapHandler(handler: HostSequenceGapHandler | null): void {
    this.gapHandler = handler;
  }

  request(command: HostCommand): Promise<HostResponse> {
    this.requests.push(command);
    if (command.type === 'session/foreground-run') {
      if (this.foregroundRunResponse?.kind === 'fail') {
        return Promise.resolve({
          type: 'response',
          command: command.type,
          success: false,
          error: 'host unavailable',
        });
      }
      const run = this.foregroundRunResponse?.kind === 'run' ? this.foregroundRunResponse.run : null;
      return Promise.resolve({
        type: 'response',
        command: command.type,
        success: true,
        data: { sessionId: command.sessionId, run },
      });
    }
    if (command.type === 'session/messages') {
      return Promise.resolve({
        type: 'response',
        command: command.type,
        success: true,
        data: { sessionId: command.sessionId, messages: [] },
      });
    }
    return Promise.resolve({
      type: 'response',
      command: command.type,
      success: false,
      error: 'unexpected command in test',
    });
  }

  scriptForegroundRun(response: ScriptedResponse): void {
    this.foregroundRunResponse = response;
  }

  emitGap(): void {
    this.gapHandler?.({
      hostInstanceId: 'host-1',
      missedFromSeq: 3,
      receivedFromSeq: 5,
    });
  }
}

function terminalRun(): ExecutionRunRecord {
  return {
    runId: 'run-1',
    kind: 'session-turn',
    rootRunId: 'run-1',
    sessionId: 'session-1',
    status: 'completed',
    endedAt: '2026-08-15T17:04:53.000Z',
    terminalCode: 'completed',
  };
}

function mountProbe(
  hostClient: HostClient,
  dispatch: (action: ChatUiAction) => void,
  props: { activeSessionId: string | null; activeRunId: string | null; runLive: boolean },
): { root: Root; container: HTMLElement } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  function Probe(): null {
    useRunReconcile({
      hostClient,
      dispatch,
      activeSessionId: props.activeSessionId,
      activeRunId: props.activeRunId,
      runLive: props.runLive,
    });
    return null;
  }
  act(() => {
    root.render(<Probe />);
  });
  return { root, container };
}

describe('useRunReconcile', () => {
  it('on a sequence gap, rehydrates the transcript then applies the Host terminal record', async () => {
    const fake = new FakeHostClient();
    fake.scriptForegroundRun({ kind: 'run', run: terminalRun() });
    const actions: ChatUiAction[] = [];
    const dispatch = vi.fn((action: ChatUiAction) => actions.push(action));
    const { root, container } = mountProbe(fake as unknown as HostClient, dispatch, {
      activeSessionId: 'session-1',
      activeRunId: 'run-1',
      runLive: true,
    });

    await act(async () => {
      fake.emitGap();
    });

    expect(fake.requests.map((command) => command.type)).toEqual([
      'session/foreground-run',
      'session/messages',
    ]);
    expect(actions.map((action) => action.type)).toEqual([
      'session/load-messages',
      'run/terminal',
    ]);
    root.unmount();
    container.remove();
  });

  it('on a sequence gap with no registry run, clears stale streaming state', async () => {
    const fake = new FakeHostClient();
    fake.scriptForegroundRun({ kind: 'run', run: null });
    const actions: ChatUiAction[] = [];
    const dispatch = (action: ChatUiAction): void => {
      actions.push(action);
    };
    const { root, container } = mountProbe(fake as unknown as HostClient, dispatch, {
      activeSessionId: 'session-1',
      activeRunId: null,
      runLive: true,
    });

    await act(async () => {
      fake.emitGap();
    });

    expect(actions.map((action) => action.type)).toEqual([
      'session/load-messages',
      'run/stale-clear',
    ]);
    root.unmount();
    container.remove();
  });

  it('does nothing while the Host still reports an active run', async () => {
    const fake = new FakeHostClient();
    const { endedAt: _endedAt, ...runningBase } = terminalRun();
    fake.scriptForegroundRun({
      kind: 'run',
      run: { ...runningBase, status: 'running' },
    });
    const dispatch = vi.fn();
    const { root, container } = mountProbe(fake as unknown as HostClient, dispatch, {
      activeSessionId: 'session-1',
      activeRunId: 'run-1',
      runLive: true,
    });

    await act(async () => {
      fake.emitGap();
    });

    expect(fake.requests.map((command) => command.type)).toEqual(['session/foreground-run']);
    expect(dispatch).not.toHaveBeenCalled();
    root.unmount();
    container.remove();
  });

  it('reconciles on window focus but stays quiet when no run is live', async () => {
    const fake = new FakeHostClient();
    fake.scriptForegroundRun({ kind: 'run', run: null });
    const dispatch = vi.fn();
    const { root, container } = mountProbe(fake as unknown as HostClient, dispatch, {
      activeSessionId: 'session-1',
      activeRunId: null,
      runLive: false,
    });

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(fake.requests).toHaveLength(0);

    root.unmount();
    container.remove();
  });
});
