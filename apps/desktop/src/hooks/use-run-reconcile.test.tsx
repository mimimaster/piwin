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
  private foregroundRunResponses: ScriptedResponse[] | undefined;

  registerSequenceGapHandler(handler: HostSequenceGapHandler | null): void {
    this.gapHandler = handler;
  }

  request(command: HostCommand): Promise<HostResponse> {
    this.requests.push(command);
    if (command.type === 'session/foreground-run') {
      const scripted = this.foregroundRunResponses?.shift() ?? this.foregroundRunResponse;
      if (scripted?.kind === 'fail') {
        return Promise.resolve({
          type: 'response',
          command: command.type,
          success: false,
          error: 'host unavailable',
        });
      }
      const run = scripted?.kind === 'run' ? scripted.run : null;
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
    this.foregroundRunResponses = undefined;
  }

  scriptForegroundRunSequence(...responses: ScriptedResponse[]): void {
    this.foregroundRunResponses = [...responses];
    this.foregroundRunResponse = responses.at(-1);
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

type ProbeProps = {
  activeSessionId: string | null;
  activeRunId: string | null;
  runLive: boolean;
  hostReady?: boolean;
  catchUpEpoch?: number;
  foregroundAdmission?: 'unknown' | 'reconciling' | 'ready';
};

function mountProbe(
  hostClient: HostClient,
  dispatch: (action: ChatUiAction) => void,
  props: ProbeProps,
): {
  root: Root;
  container: HTMLElement;
  rerender: (next: ProbeProps) => void;
} {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  function Probe(probeProps: ProbeProps): null {
    useRunReconcile({
      hostClient,
      dispatch,
      activeSessionId: probeProps.activeSessionId,
      activeRunId: probeProps.activeRunId,
      runLive: probeProps.runLive,
      ...(probeProps.hostReady === undefined ? {} : { hostReady: probeProps.hostReady }),
      ...(probeProps.catchUpEpoch === undefined ? {} : { catchUpEpoch: probeProps.catchUpEpoch }),
      ...(probeProps.foregroundAdmission === undefined
        ? {}
        : { foregroundAdmission: probeProps.foregroundAdmission }),
    });
    return null;
  }
  act(() => {
    root.render(<Probe {...props} />);
  });
  return {
    root,
    container,
    rerender: (next) => {
      act(() => {
        root.render(<Probe {...next} />);
      });
    },
  };
}

async function waitForAdmission(actions: ChatUiAction[], admission: 'ready' | 'unknown'): Promise<void> {
  await act(async () => {
    await vi.waitFor(() => {
      expect(
        actions.some(
          (action) => action.type === 'foreground/admission' && action.admission === admission,
        ),
      ).toBe(true);
    });
  });
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
    await waitForAdmission(actions, 'ready');
    fake.requests.length = 0;
    const actionCountAfterAdmit = actions.length;

    await act(async () => {
      fake.emitGap();
    });

    expect(fake.requests.map((command) => command.type)).toEqual([
      'permission/pending-list',
      'session/foreground-run',
      'session/messages',
    ]);
    expect(actions.slice(actionCountAfterAdmit).map((action) => action.type)).toEqual([
      'session/load-messages',
      'run/terminal',
    ]);
    root.unmount();
    container.remove();
  });

  it('on a sequence gap before ACK, ignores a null Host run instead of wiping the optimistic turn', async () => {
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
    await waitForAdmission(actions, 'ready');
    const actionCountAfterAdmit = actions.length;

    await act(async () => {
      fake.emitGap();
    });

    expect(actions.slice(actionCountAfterAdmit).map((action) => action.type)).toEqual([]);
    root.unmount();
    container.remove();
  });

  it('on a sequence gap with a known run id and no Host run, clears stale streaming state', async () => {
    const fake = new FakeHostClient();
    fake.scriptForegroundRun({ kind: 'run', run: null });
    const actions: ChatUiAction[] = [];
    const dispatch = (action: ChatUiAction): void => {
      actions.push(action);
    };
    const { root, container } = mountProbe(fake as unknown as HostClient, dispatch, {
      activeSessionId: 'session-1',
      activeRunId: 'run-1',
      runLive: true,
    });
    await waitForAdmission(actions, 'ready');
    const actionCountAfterAdmit = actions.length;

    await act(async () => {
      fake.emitGap();
    });

    expect(actions.slice(actionCountAfterAdmit).map((action) => action.type)).toEqual([
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
    const actions: ChatUiAction[] = [];
    const dispatch = vi.fn((action: ChatUiAction) => actions.push(action));
    const { root, container } = mountProbe(fake as unknown as HostClient, dispatch, {
      activeSessionId: 'session-1',
      activeRunId: 'run-1',
      runLive: true,
    });
    await waitForAdmission(actions, 'ready');
    fake.requests.length = 0;
    dispatch.mockClear();

    await act(async () => {
      fake.emitGap();
    });

    expect(fake.requests.map((command) => command.type)).toEqual([
      'permission/pending-list',
      'session/foreground-run',
    ]);
    expect(dispatch).not.toHaveBeenCalled();
    root.unmount();
    container.remove();
  });

  it('uses bounded post-admission checks so a missed terminal push cannot leave the run live', async () => {
    vi.useFakeTimers();
    try {
      const fake = new FakeHostClient();
      const { endedAt: _endedAt, ...runningBase } = terminalRun();
      fake.scriptForegroundRunSequence(
        { kind: 'run', run: { ...runningBase, status: 'running' } },
        { kind: 'run', run: { ...runningBase, status: 'running' } },
        { kind: 'run', run: { ...runningBase, status: 'running' } },
        { kind: 'run', run: null },
      );
      const actions: ChatUiAction[] = [];
      const { root, container } = mountProbe(
        fake as unknown as HostClient,
        (action) => {
          actions.push(action);
        },
        {
          activeSessionId: 'session-1',
          activeRunId: 'run-1',
          runLive: true,
        },
      );

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      fake.requests.length = 0;

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });

      expect(fake.requests.map((command) => command.type)).toEqual([
        'session/foreground-run',
        'session/foreground-run',
        'session/foreground-run',
        'session/messages',
        'session/foreground-run',
        'session/messages',
      ]);
      expect(actions.map((action) => action.type)).toContain('run/stale-clear');
      root.unmount();
      container.remove();
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears leftover working when admission finds no Host run and the UI is idle', async () => {
    const fake = new FakeHostClient();
    fake.scriptForegroundRun({ kind: 'run', run: null });
    const actions: ChatUiAction[] = [];
    const { root, container } = mountProbe(fake as unknown as HostClient, (action) => {
      actions.push(action);
    }, {
      activeSessionId: 'session-1',
      activeRunId: null,
      runLive: false,
    });
    await waitForAdmission(actions, 'ready');

    expect(actions.map((action) => action.type)).toContain('run/stale-clear');
    expect(
      actions.find((action) => action.type === 'run/stale-clear'),
    ).toEqual({ type: 'run/stale-clear', sessionId: 'session-1' });
    root.unmount();
    container.remove();
  });

  it('reconciles on window focus but stays quiet when no run is live', async () => {
    const fake = new FakeHostClient();
    fake.scriptForegroundRun({ kind: 'run', run: null });
    const actions: ChatUiAction[] = [];
    const dispatch = (action: ChatUiAction): void => {
      actions.push(action);
    };
    const { root, container } = mountProbe(fake as unknown as HostClient, dispatch, {
      activeSessionId: 'session-1',
      activeRunId: null,
      runLive: false,
    });
    await waitForAdmission(actions, 'ready');
    fake.requests.length = 0;

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(fake.requests).toHaveLength(0);

    root.unmount();
    container.remove();
  });

  it('reconciles when the Host socket becomes ready again', async () => {
    const fake = new FakeHostClient();
    fake.scriptForegroundRun({ kind: 'run', run: terminalRun() });
    const actions: ChatUiAction[] = [];
    const { root, container } = mountProbe(fake as unknown as HostClient, (action) => {
      actions.push(action);
    }, {
      activeSessionId: 'session-1',
      activeRunId: 'run-1',
      runLive: true,
      hostReady: true,
    });

    await act(async () => {
      await vi.waitFor(() => {
        expect(actions.some((action) => action.type === 'run/terminal')).toBe(true);
      });
    });

    expect(fake.requests.map((command) => command.type)).toContain('session/messages');
    expect(actions.map((action) => action.type)).toContain('session/load-messages');
    expect(actions.map((action) => action.type)).toContain('run/terminal');
    root.unmount();
    container.remove();
  });

  it('on catch-up epoch while idle, reloads the active transcript', async () => {
    const fake = new FakeHostClient();
    const actions: ChatUiAction[] = [];
    const { root, container } = mountProbe(fake as unknown as HostClient, (action) => {
      actions.push(action);
    }, {
      activeSessionId: 'session-1',
      activeRunId: null,
      runLive: false,
      hostReady: true,
      catchUpEpoch: 1,
    });

    await act(async () => {
      await vi.waitFor(() => {
        expect(fake.requests.some((command) => command.type === 'session/messages')).toBe(true);
      });
    });

    expect(fake.requests.map((command) => command.type)).toContain('session/messages');
    expect(actions.map((action) => action.type)).toContain('session/load-messages');
    root.unmount();
    container.remove();
  });

  it('leaves admission unknown when session/foreground-run fails', async () => {
    const fake = new FakeHostClient();
    fake.scriptForegroundRun({ kind: 'fail' });
    const actions: ChatUiAction[] = [];
    const { root, container } = mountProbe(fake as unknown as HostClient, (action) => {
      actions.push(action);
    }, {
      activeSessionId: 'session-1',
      activeRunId: null,
      runLive: false,
    });
    await waitForAdmission(actions, 'unknown');
    expect(
      actions.filter((action) => action.type === 'foreground/admission').map((action) =>
        action.type === 'foreground/admission' ? action.admission : undefined,
      ),
    ).toEqual(['reconciling', 'unknown']);
    root.unmount();
    container.remove();
  });

  it('retries a failed admit while Host is ready so Send is not stuck until session switch', async () => {
    vi.useFakeTimers();
    try {
      const fake = new FakeHostClient();
      // Mount runs selection-admit and hostReady-admit; both fail while Host is
      // up and must stay in reconciling (not sticky unknown), then backoff.
      fake.scriptForegroundRun({ kind: 'fail' });
      const actions: ChatUiAction[] = [];
      let admission: 'unknown' | 'reconciling' | 'ready' = 'reconciling';
      const dispatch = (action: ChatUiAction): void => {
        actions.push(action);
        if (action.type === 'foreground/admission') {
          admission = action.admission;
        }
      };
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = createRoot(container);
      function StatefulProbe(props: {
        admission: 'unknown' | 'reconciling' | 'ready';
      }): null {
        useRunReconcile({
          hostClient: fake as unknown as HostClient,
          dispatch,
          activeSessionId: 'session-1',
          activeRunId: null,
          runLive: false,
          hostReady: true,
          foregroundAdmission: props.admission,
        });
        return null;
      }
      act(() => {
        root.render(<StatefulProbe admission={admission} />);
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(admission).toBe('reconciling');
      expect(admission).not.toBe('unknown');
      act(() => {
        root.render(<StatefulProbe admission={admission} />);
      });

      fake.scriptForegroundRun({ kind: 'run', run: null });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(admission).toBe('ready');
      expect(actions.map((action) => action.type)).toContain('run/stale-clear');
      root.unmount();
      container.remove();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not clear a live projection when admission finds no Host run yet', async () => {
    const fake = new FakeHostClient();
    fake.scriptForegroundRun({ kind: 'run', run: null });
    const actions: ChatUiAction[] = [];
    const { root, container } = mountProbe(fake as unknown as HostClient, (action) => {
      actions.push(action);
    }, {
      activeSessionId: 'session-1',
      activeRunId: 'run-1',
      runLive: true,
      foregroundAdmission: 'reconciling',
    });
    await waitForAdmission(actions, 'ready');
    expect(actions.map((action) => action.type)).not.toContain('run/stale-clear');
    root.unmount();
    container.remove();
  });

  it('re-admits when hostReady becomes true after a not-ready gap', async () => {
    const fake = new FakeHostClient();
    fake.scriptForegroundRun({ kind: 'fail' });
    const actions: ChatUiAction[] = [];
    const props = {
      activeSessionId: 'session-1',
      activeRunId: null,
      runLive: false,
      hostReady: false,
    };
    const { root, container, rerender } = mountProbe(
      fake as unknown as HostClient,
      (action) => {
        actions.push(action);
      },
      props,
    );
    await waitForAdmission(actions, 'unknown');
    fake.scriptForegroundRun({ kind: 'run', run: null });
    rerender({ ...props, hostReady: true });
    await waitForAdmission(actions, 'ready');
    expect(
      actions
        .filter((action) => action.type === 'foreground/admission')
        .map((action) => (action.type === 'foreground/admission' ? action.admission : undefined)),
    ).toEqual(['reconciling', 'unknown', 'reconciling', 'ready']);
    root.unmount();
    container.remove();
  });

  it('re-admits when the same session returns to reconciling', async () => {
    const fake = new FakeHostClient();
    fake.scriptForegroundRun({ kind: 'run', run: null });
    const actions: ChatUiAction[] = [];
    const props = {
      activeSessionId: 'session-1',
      activeRunId: null,
      runLive: false,
      foregroundAdmission: 'reconciling' as const,
    };
    const { root, container, rerender } = mountProbe(
      fake as unknown as HostClient,
      (action) => {
        actions.push(action);
      },
      props,
    );
    const readyCount = (): number =>
      actions.filter(
        (action) => action.type === 'foreground/admission' && action.admission === 'ready',
      ).length;
    await act(async () => {
      await vi.waitFor(() => {
        expect(readyCount()).toBeGreaterThanOrEqual(1);
      });
    });
    const firstForegroundRuns = fake.requests.filter(
      (command) => command.type === 'session/foreground-run',
    ).length;
    expect(firstForegroundRuns).toBeGreaterThanOrEqual(1);

    rerender({ ...props, foregroundAdmission: 'ready' });
    rerender({ ...props, foregroundAdmission: 'reconciling' });
    await act(async () => {
      await vi.waitFor(() => {
        expect(
          fake.requests.filter((command) => command.type === 'session/foreground-run').length,
        ).toBeGreaterThan(firstForegroundRuns);
        expect(readyCount()).toBeGreaterThanOrEqual(2);
      });
    });
    root.unmount();
    container.remove();
  });
});
