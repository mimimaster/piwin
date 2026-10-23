// @vitest-environment happy-dom
/**
 * Session switch drops right-panel full width and folds away a Canvas tab
 * (its target was cleared by the same switch); nothing else resets.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { RightPanelTab } from '../right-panel/right-panel';
import {
  useSessionSwitchPanelReset,
  type UseSessionSwitchPanelResetArgs,
} from './use-session-switch-panel-reset';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function Probe(props: UseSessionSwitchPanelResetArgs): null {
  useSessionSwitchPanelReset(props);
  return null;
}

describe('useSessionSwitchPanelReset', () => {
  let container: HTMLDivElement;
  let root: Root;
  const setFullWidth = vi.fn<(next: boolean) => void>();
  const dismissInspector = vi.fn<() => void>();

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    setFullWidth.mockClear();
    dismissInspector.mockClear();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(input: {
    activeSessionId: string | null;
    rightPanelOpen: boolean;
    rightPanelTab: RightPanelTab | null;
  }): void {
    act(() => {
      root.render(
        <Probe {...input} setFullWidth={setFullWidth} dismissInspector={dismissInspector} />,
      );
    });
  }

  it('does nothing on mount or while the session stays the same', () => {
    render({ activeSessionId: 'session-1', rightPanelOpen: true, rightPanelTab: 'canvas' });
    render({ activeSessionId: 'session-1', rightPanelOpen: true, rightPanelTab: 'browser' });
    render({ activeSessionId: 'session-1', rightPanelOpen: true, rightPanelTab: 'canvas' });

    expect(setFullWidth).not.toHaveBeenCalled();
    expect(dismissInspector).not.toHaveBeenCalled();
  });

  it('exits full width and closes the panel when it showed the Canvas', () => {
    render({ activeSessionId: 'session-1', rightPanelOpen: true, rightPanelTab: 'canvas' });
    render({ activeSessionId: 'session-2', rightPanelOpen: true, rightPanelTab: 'canvas' });

    expect(setFullWidth).toHaveBeenCalledWith(false);
    expect(dismissInspector).toHaveBeenCalledTimes(1);
  });

  it('exits full width but keeps the panel open on a non-Canvas tab', () => {
    render({ activeSessionId: 'session-1', rightPanelOpen: true, rightPanelTab: 'browser' });
    render({ activeSessionId: 'session-2', rightPanelOpen: true, rightPanelTab: 'browser' });

    expect(setFullWidth).toHaveBeenCalledWith(false);
    expect(dismissInspector).not.toHaveBeenCalled();
  });

  it('leaves a closed panel alone even when its last tab was the Canvas', () => {
    render({ activeSessionId: 'session-1', rightPanelOpen: false, rightPanelTab: 'canvas' });
    render({ activeSessionId: null, rightPanelOpen: false, rightPanelTab: 'canvas' });

    expect(setFullWidth).toHaveBeenCalledWith(false);
    expect(dismissInspector).not.toHaveBeenCalled();
  });
});
