// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { HostPush } from '@piwin/contracts';
import { HostClient } from '../host/host-client';
import type { RightPanelTab } from '../right-panel/right-panel';
import { useBrowserInspectorReveal } from './use-browser-inspector-reveal';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function Probe(props: {
  hostClient: HostClient;
  openInspector: (tab: RightPanelTab) => void;
}): ReactElement {
  useBrowserInspectorReveal(props.hostClient, props.openInspector);
  return <div />;
}

describe('useBrowserInspectorReveal', () => {
  let container: HTMLElement;
  let root: Root;
  let previousActEnvironment: boolean | undefined;

  beforeEach(() => {
    previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  it('opens the Browser inspector when the agent takes the workbench', () => {
    const client = new HostClient({ transport: 'mock' });
    const openInspector = vi.fn();
    act(() => {
      root.render(<Probe hostClient={client} openInspector={openInspector} />);
    });

    const listeners = (client as unknown as { listeners: Set<(m: HostPush) => void> }).listeners;
    act(() => {
      for (const listener of listeners) {
        listener({ type: 'browser/controller', owner: 'agent', ts: Date.now() });
      }
    });

    expect(openInspector).toHaveBeenCalledWith('browser');
  });

  it('does not open on user lock', () => {
    const client = new HostClient({ transport: 'mock' });
    const openInspector = vi.fn();
    act(() => {
      root.render(<Probe hostClient={client} openInspector={openInspector} />);
    });

    const listeners = (client as unknown as { listeners: Set<(m: HostPush) => void> }).listeners;
    act(() => {
      for (const listener of listeners) {
        listener({ type: 'browser/controller', owner: 'user', ts: Date.now() });
      }
    });

    expect(openInspector).not.toHaveBeenCalled();
  });

  it('does not refocus the Browser inspector for page refreshes or mirror-start echoes', () => {
    const client = new HostClient({ transport: 'mock' });
    const openInspector = vi.fn();
    act(() => root.render(<Probe hostClient={client} openInspector={openInspector} />));
    const listeners = (client as unknown as { listeners: Set<(message: HostPush) => void> }).listeners;
    const emit = (message: HostPush): void => act(() => {
      for (const listener of listeners) listener(message);
    });
    emit({ type: 'browser/controller', owner: 'agent', reason: 'agent-write', ts: 1 });
    expect(openInspector).toHaveBeenCalledExactlyOnceWith('browser');
    openInspector.mockClear();

    emit({ type: 'browser/state', url: 'https://linux.do/t/topic/2904802', lifecycle: 'ready', ts: 2 });
    emit({ type: 'browser/controller', owner: 'agent', reason: 'mirror-start', ts: 3 });
    expect(openInspector).not.toHaveBeenCalled();
  });
});
