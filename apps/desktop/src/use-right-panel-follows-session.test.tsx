// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { RightPanelTab } from './right-panel-sections';
import { useRightPanelFollowsSession } from './use-right-panel-follows-session';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Snapshot = { openTabs: RightPanelTab[]; activeTab: RightPanelTab | null };

describe('useRightPanelFollowsSession', () => {
  let root: Root | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    window.localStorage.clear();
  });

  function mount(): {
    setSession: (sessionId: string | null) => void;
    open: (tab: RightPanelTab) => void;
    current: () => Snapshot;
  } {
    let snapshot: Snapshot = { openTabs: [], activeTab: null };
    let openTab: (tab: RightPanelTab) => void = () => undefined;
    function Probe(props: { sessionId: string | null }): null {
      const [openTabs, setOpenTabs] = useState<RightPanelTab[]>([]);
      const [activeTab, setActiveTab] = useState<RightPanelTab | null>(null);
      useRightPanelFollowsSession({
        sessionId: props.sessionId,
        openTabs,
        activeTab,
        setOpenTabs,
        onTabChange: setActiveTab,
        keepsTab: () => true,
      });
      snapshot = { openTabs, activeTab };
      openTab = (tab) => {
        setOpenTabs((current) => (current.includes(tab) ? current : [...current, tab]));
        setActiveTab(tab);
      };
      return null;
    }
    const mountedRoot = createRoot(document.createElement('div'));
    root = mountedRoot;
    act(() => mountedRoot.render(<Probe sessionId="a" />));
    return {
      setSession: (sessionId) => act(() => mountedRoot.render(<Probe sessionId={sessionId} />)),
      open: (tab) => act(() => openTab(tab)),
      current: () => snapshot,
    };
  }

  it('swaps tabs per session; a new session inherits them without side chats', () => {
    const mounted = mount();
    mounted.open('files');
    mounted.open('sideChat');
    expect(mounted.current()).toEqual({ openTabs: ['files', 'sideChat'], activeTab: 'sideChat' });

    mounted.setSession('b');
    expect(mounted.current()).toEqual({ openTabs: ['files'], activeTab: null });
    mounted.open('notes');

    mounted.setSession('a');
    expect(mounted.current()).toEqual({ openTabs: ['files', 'sideChat'], activeTab: 'sideChat' });

    mounted.setSession('b');
    expect(mounted.current()).toEqual({ openTabs: ['files', 'notes'], activeTab: 'notes' });
  });
});
