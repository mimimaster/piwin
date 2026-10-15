// @vitest-environment happy-dom
/**
 * The orchestration pill is owned per conversation by the Host session index:
 * picks are written through `session/set-composer-profile`, and a resume
 * answer restores them after a reload (when the park cache is empty).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { HostCommand, HostResponse, PiwinConfig } from '@piwin/contracts';
import { useComposerOrchestrationControls } from './use-composer-orchestration-controls';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Controls = ReturnType<typeof useComposerOrchestrationControls>;

type ProbeSnapshot = {
  controls: Controls;
  schemeId: string;
  delegationDisabled: boolean;
};

function Probe(props: {
  activeSessionId: string | null;
  request: (command: HostCommand) => Promise<HostResponse>;
  onRender: (snapshot: ProbeSnapshot) => void;
}): null {
  const [schemeId, setSchemeId] = useState('off');
  const [delegationDisabled, setDelegationDisabled] = useState(false);
  const controls = useComposerOrchestrationControls({
    hostClient: { request: props.request } as never,
    activeSessionId: props.activeSessionId,
    config: {} as PiwinConfig,
    orchestrationSchemeId: schemeId,
    setOrchestrationSchemeId: setSchemeId,
    delegationDisabled,
    setDelegationDisabled,
  });
  props.onRender({ controls, schemeId, delegationDisabled });
  return null;
}

describe('useComposerOrchestrationControls', () => {
  let container: HTMLDivElement;
  let root: Root;
  let latest: ProbeSnapshot | null;
  const request = vi.fn<(command: HostCommand) => Promise<HostResponse>>();

  function current(): ProbeSnapshot {
    if (latest === null) throw new Error('probe did not render');
    return latest;
  }

  function render(activeSessionId: string | null): void {
    act(() => {
      root.render(
        <Probe
          activeSessionId={activeSessionId}
          request={request}
          onRender={(snapshot) => {
            latest = snapshot;
          }}
        />,
      );
    });
  }

  function profileCommands(): HostCommand[] {
    return request.mock.calls
      .map(([command]) => command)
      .filter((command) => command.type === 'session/set-composer-profile');
  }

  beforeEach(() => {
    latest = null;
    request.mockReset();
    request.mockResolvedValue({
      id: 'r',
      type: 'response',
      command: 'session/set-composer-profile',
      success: true,
      data: { ok: true },
    } as HostResponse);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('writes a live-session pick to the Host session profile', () => {
    render('s1');
    act(() => current().controls.selectOrchestrationScheme('ultra-code'));
    act(() => current().controls.selectDelegationDisabled(true));

    expect(current().schemeId).toBe('ultra-code');
    expect(profileCommands()).toEqual([
      { type: 'session/set-composer-profile', sessionId: 's1', orchestrationSchemeId: 'ultra-code' },
      { type: 'session/set-composer-profile', sessionId: 's1', delegationDisabled: true },
    ]);
  });

  it('does not write while the composer is still a draft', () => {
    render(null);
    act(() => current().controls.selectOrchestrationScheme('ultra-code'));
    expect(profileCommands()).toEqual([]);
  });

  it('hands the draft pick to the session the first send created', () => {
    render(null);
    act(() => current().controls.selectOrchestrationScheme('ultra-code'));
    act(() => current().controls.bindOrchestrationSession('s-new'));

    expect(profileCommands()).toEqual([
      {
        type: 'session/set-composer-profile',
        sessionId: 's-new',
        orchestrationSchemeId: 'ultra-code',
        delegationDisabled: false,
      },
    ]);
  });

  it('restores the Host-stored scheme after a reload emptied the park cache', () => {
    render('s1');
    expect(current().schemeId).toBe('off');

    act(() =>
      current().controls.restoreSessionOrchestration({
        sessionId: 's1',
        orchestrationSchemeId: 'ultra-code',
        delegationDisabled: true,
      }),
    );

    expect(current().schemeId).toBe('ultra-code');
    expect(current().delegationDisabled).toBe(true);
    expect(profileCommands()).toEqual([]);
  });

  it('ignores a resume answer for a session that is no longer active', () => {
    render('s2');
    act(() =>
      current().controls.restoreSessionOrchestration({
        sessionId: 's1',
        orchestrationSchemeId: 'ultra-code',
      }),
    );
    expect(current().schemeId).toBe('off');
  });

  it('keeps a pick made after switching in over a late resume answer', () => {
    render('s1');
    act(() => current().controls.selectOrchestrationScheme('review'));
    act(() =>
      current().controls.restoreSessionOrchestration({
        sessionId: 's1',
        orchestrationSchemeId: 'ultra-code',
      }),
    );
    expect(current().schemeId).toBe('review');
  });

  it('keeps the parked scheme when the Host has nothing stored', () => {
    render('s1');
    act(() => current().controls.selectOrchestrationScheme('ultra-code'));
    act(() =>
      current().controls.resetOrchestrationForSessionChange({
        previousSessionId: 's1',
        nextSessionId: 's2',
      }),
    );
    render('s2');
    act(() =>
      current().controls.resetOrchestrationForSessionChange({
        previousSessionId: 's2',
        nextSessionId: 's1',
      }),
    );
    render('s1');
    act(() => current().controls.restoreSessionOrchestration({ sessionId: 's1' }));

    expect(current().schemeId).toBe('ultra-code');
  });
});
