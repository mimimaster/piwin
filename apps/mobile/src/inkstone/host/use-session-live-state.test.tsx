// @vitest-environment happy-dom
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostCommand, HostPush, HostResponse, TurnChangeSummary } from '@piwin/contracts';
import type { HostClient } from '@piwin/host-client';
import { useSessionLiveState, type SessionLiveState } from './use-session-live-state.js';

function summary(overrides: Partial<TurnChangeSummary> = {}): TurnChangeSummary {
  return {
    changeSetId: 'cs-1',
    attemptId: 'at-1',
    sessionId: 's1',
    workspaceId: 'ws',
    userMessageId: null,
    runIds: ['r1'],
    revision: 1,
    captureState: 'ready',
    disposition: 'applied',
    fileCount: 1,
    additions: 1,
    deletions: 0,
    binaryFileCount: 0,
    coverageComplete: true,
    undo: { allowed: true },
    redo: { allowed: false, reason: 'direction-unavailable' },
    expiresAt: null,
    latestOperationId: null,
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;
let latest: SessionLiveState | undefined;

function Probe(props: { client: HostClient }): ReactElement | null {
  latest = useSessionLiveState(props.client, 's1');
  return null;
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  latest = undefined;
});

describe('useSessionLiveState turn changes', () => {
  it('fetches history summaries once per run and keeps a newer pushed revision', async () => {
    let listener: ((push: HostPush) => void) | undefined;
    const request = vi.fn(async (command: HostCommand): Promise<HostResponse> => ({
      type: 'response',
      command: command.type,
      success: true,
      data: command.type === 'turn-changes/list-by-runs' ? { summaries: [summary()] } : {},
    }));
    const client = {
      supportsCommand: (type: string) => type === 'turn-changes/list-by-runs',
      request,
      subscribePush: (next: (push: HostPush) => void) => {
        listener = next;
        return () => undefined;
      },
    } as unknown as HostClient;

    await act(async () => root.render(<Probe client={client} />));
    await act(async () => {
      latest?.ensureTurnChanges(['r1']);
      latest?.ensureTurnChanges(['r1']);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const lookups = request.mock.calls.filter(([command]) => command.type === 'turn-changes/list-by-runs');
    expect(lookups).toHaveLength(1);
    expect(latest?.changesByRunId.get('r1')?.disposition).toBe('applied');

    await act(async () => {
      listener?.({
        type: 'turn-changes/updated',
        workspaceId: 'ws',
        changeSetId: 'cs-1',
        revision: 2,
        summary: summary({ revision: 2, disposition: 'undone' }),
      });
    });
    expect(latest?.changesByRunId.get('r1')?.disposition).toBe('undone');
  });
});
