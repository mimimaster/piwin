import { describe, expect, it } from 'vitest';
import { createWorkspaceState } from '../workbench/docking/view-commands.js';
import { createSequentialIdFactory } from '../workbench/docking/ids.js';
import { hasVisibleBrowserPresentation } from './browser-presentation-visibility.js';

const BASE: Parameters<typeof hasVisibleBrowserPresentation>[0] = {
  covered: false, phone: false, rightPanelOpen: true, rightPanelBrowser: false,
  dockingState: null, miniDismissed: false,
  activity: { url: 'https://fixture.invalid/', owner: 'idle' },
};

function workspace(active: 'chat' | 'browser') {
  const state = createWorkspaceState(createSequentialIdFactory());
  const group = state.groups[state.activeGroupId];
  if (group === undefined) throw new Error('Missing initial group');
  state.views.chat = { viewId: 'chat', kind: 'session', sessionId: 'a' };
  state.views.browser = { viewId: 'browser', kind: 'browser' };
  group.viewIds = ['chat', 'browser'];
  group.activeViewId = active;
  return state;
}

describe('browser presentation demand', () => {
  it('does not retain pictures for a docked Browser while a non-docked inspector tab is selected', () => {
    const state = workspace('chat');
    const stage = state.groups[state.activeGroupId];
    const rightId = state.rightPanel.groupIds[0];
    const right = rightId === undefined ? undefined : state.groups[rightId];
    if (stage === undefined || right === undefined) throw new Error('missing tool groups');
    stage.viewIds = ['chat'];
    right.viewIds = ['browser'];
    right.activeViewId = 'browser';
    expect(hasVisibleBrowserPresentation({ ...BASE, dockingState: state })).toBe(false);
    expect(hasVisibleBrowserPresentation({ ...BASE, dockingState: state,
      rightPanelBrowser: true, rightDockedBodyVisible: false })).toBe(false);
    // A restored first tab can be visible before a controlled tab request exists.
    expect(hasVisibleBrowserPresentation({ ...BASE, dockingState: state,
      rightDockedBodyVisible: true })).toBe(true);
  });

  it('keeps a stage browser visible when the inspector body is hidden', () => {
    expect(hasVisibleBrowserPresentation({ ...BASE, dockingState: workspace('browser'),
      rightDockedBodyVisible: false })).toBe(true);
  });
  it('does not retain a frame lease just because an inactive browser tab exists', () => {
    expect(hasVisibleBrowserPresentation({ ...BASE, dockingState: workspace('chat') })).toBe(false);
    expect(hasVisibleBrowserPresentation({ ...BASE, dockingState: workspace('browser') })).toBe(true);
  });
  it('stops demand when the mini is dismissed and no full surface is visible', () => {
    expect(hasVisibleBrowserPresentation({ ...BASE, rightPanelOpen: false })).toBe(true);
    expect(hasVisibleBrowserPresentation({ ...BASE, rightPanelOpen: false, miniDismissed: true })).toBe(false);
  });
  it('does not decode pictures for a phone activity chip', () => {
    expect(hasVisibleBrowserPresentation({ ...BASE, rightPanelOpen: false, phone: true })).toBe(false);
  });
  it('keeps an explicitly opened full browser even when its mini was dismissed', () => {
    expect(hasVisibleBrowserPresentation({ ...BASE, rightPanelBrowser: true, miniDismissed: true })).toBe(true);
  });
  it('releases full and mini presentation when the workspace is covered', () => {
    expect(hasVisibleBrowserPresentation({ ...BASE, covered: true, rightPanelBrowser: true })).toBe(false);
    expect(hasVisibleBrowserPresentation({ ...BASE, covered: true, dockingState: workspace('browser') })).toBe(false);
  });
  it('does not count a browser in a group hidden by maximize or focus', () => {
    const state = workspace('browser');
    state.groups.other = { groupId: 'other', viewIds: ['chat'], activeViewId: 'chat' };
    state.stage = { kind: 'split', splitId: 'split', orientation: 'row', ratio: 0.5,
      first: state.stage, second: { kind: 'group', groupId: 'other' } };
    expect(hasVisibleBrowserPresentation({ ...BASE, dockingState: state })).toBe(true);
    state.displayMode = 'maximized';
    state.maximizedGroupId = 'other';
    expect(hasVisibleBrowserPresentation({ ...BASE, dockingState: state })).toBe(false);
    state.displayMode = 'focused';
    state.activeGroupId = 'other';
    expect(hasVisibleBrowserPresentation({ ...BASE, dockingState: state })).toBe(false);
  });
});
