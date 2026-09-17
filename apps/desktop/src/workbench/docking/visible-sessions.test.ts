import { describe, expect, it } from 'vitest';
import {
  bindConversationPaneSession,
  createConversationPaneLayout,
  PRIMARY_CONVERSATION_PANE_ID,
  splitConversationPane,
} from '../../conversation-pane-layout.js';
import { WORKSPACE_LAYOUT_SCHEMA_VERSION } from './constants.js';
import type { WorkspaceState } from './types.js';
import { selectVisibleSessionIds } from './visible-sessions.js';

function dockingState(input: {
  stage: WorkspaceState['stage'];
  groups: WorkspaceState['groups'];
  views: WorkspaceState['views'];
  rightPanelGroupIds?: string[];
}): WorkspaceState {
  return {
    version: WORKSPACE_LAYOUT_SCHEMA_VERSION,
    stage: input.stage,
    groups: input.groups,
    views: input.views,
    rightPanel: { groupIds: input.rightPanelGroupIds ?? ['right'] },
    activeGroupId: 'g-left',
    focusedViewId: null,
    sessionTargetId: null,
    displayMode: 'normal',
    maximizedGroupId: null,
    reopenStack: [],
  };
}

describe('selectVisibleSessionIds', () => {
  it('returns the foreground session of each stage group and ignores non-session views (AN-T35)', () => {
    const state = dockingState({
      stage: {
        kind: 'split',
        splitId: 'split-1',
        orientation: 'row',
        ratio: 0.5,
        first: { kind: 'group', groupId: 'g-left' },
        second: { kind: 'group', groupId: 'g-right' },
      },
      groups: {
        'g-left': { groupId: 'g-left', viewIds: ['v-sess-b', 'v-changes'], activeViewId: 'v-sess-b' },
        'g-right': { groupId: 'g-right', viewIds: ['v-sess-a', 'v-browser'], activeViewId: 'v-sess-a' },
        right: { groupId: 'right', viewIds: ['v-right-session'], activeViewId: 'v-right-session' },
      },
      views: {
        'v-sess-b': { viewId: 'v-sess-b', kind: 'session', sessionId: 'sess-b' },
        'v-sess-a': { viewId: 'v-sess-a', kind: 'session', sessionId: 'sess-a' },
        'v-changes': { viewId: 'v-changes', kind: 'changes' },
        'v-browser': { viewId: 'v-browser', kind: 'browser' },
        'v-right-session': { viewId: 'v-right-session', kind: 'session', sessionId: 'sess-hidden' },
      },
    });

    expect(
      selectVisibleSessionIds({
        dockingState: state,
        paneLayout: createConversationPaneLayout('ignored-pane'),
        activeSessionId: 'ignored-active',
        conversationCovered: false,
      }),
    ).toEqual(['sess-a', 'sess-b']);
  });

  it('skips a stage group whose foreground view is not a session', () => {
    const state = dockingState({
      stage: {
        kind: 'split',
        splitId: 'split-1',
        orientation: 'row',
        ratio: 0.5,
        first: { kind: 'group', groupId: 'g-left' },
        second: { kind: 'group', groupId: 'g-right' },
      },
      groups: {
        'g-left': { groupId: 'g-left', viewIds: ['v-sess', 'v-canvas'], activeViewId: 'v-canvas' },
        'g-right': { groupId: 'g-right', viewIds: ['v-other'], activeViewId: 'v-other' },
      },
      views: {
        'v-sess': { viewId: 'v-sess', kind: 'session', sessionId: 'background-tab' },
        'v-canvas': { viewId: 'v-canvas', kind: 'canvas' },
        'v-other': { viewId: 'v-other', kind: 'session', sessionId: 'sess-visible' },
      },
    });

    expect(
      selectVisibleSessionIds({
        dockingState: state,
        paneLayout: null,
        activeSessionId: 'active',
        conversationCovered: false,
      }),
    ).toEqual(['sess-visible']);
  });

  it('returns an empty set when conversationCovered and falls back to activeSessionId without docking or panes (AN-T36)', () => {
    const state = dockingState({
      stage: { kind: 'group', groupId: 'g-left' },
      groups: {
        'g-left': { groupId: 'g-left', viewIds: ['v-sess'], activeViewId: 'v-sess' },
      },
      views: {
        'v-sess': { viewId: 'v-sess', kind: 'session', sessionId: 'sess-covered' },
      },
    });

    expect(
      selectVisibleSessionIds({
        dockingState: state,
        paneLayout: createConversationPaneLayout('pane-session'),
        activeSessionId: 'active',
        conversationCovered: true,
      }),
    ).toEqual([]);

    expect(
      selectVisibleSessionIds({
        dockingState: null,
        paneLayout: null,
        activeSessionId: 'active-only',
        conversationCovered: false,
      }),
    ).toEqual(['active-only']);

    expect(
      selectVisibleSessionIds({
        dockingState: null,
        paneLayout: null,
        activeSessionId: null,
        conversationCovered: false,
      }),
    ).toEqual([]);
  });

  it('collects non-null leaf session ids from the old pane layout', () => {
    let layout = createConversationPaneLayout('sess-z');
    layout = splitConversationPane(layout, PRIMARY_CONVERSATION_PANE_ID, 'row', (kind) =>
      kind === 'pane' ? 'pane-2' : 'split-1',
    );
    layout = bindConversationPaneSession(layout, 'pane-2', 'sess-m');

    expect(
      selectVisibleSessionIds({
        dockingState: null,
        paneLayout: layout,
        activeSessionId: 'ignored-active',
        conversationCovered: false,
      }),
    ).toEqual(['sess-m', 'sess-z']);
  });
});
