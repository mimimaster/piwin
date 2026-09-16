import { describe, expect, it } from 'vitest';
import { createSequentialIdFactory } from './ids.js';
import { createWorkspaceState, openSessionView } from './view-commands.js';
import { resolveSidebarDragSource } from './session-drag-source.js';

describe('sidebar drag source', () => {
  it('drags an unopened session as a new view request', () => {
    const createId = createSequentialIdFactory();
    const state = createWorkspaceState(createId);
    expect(resolveSidebarDragSource(state, 's1')).toEqual({
      kind: 'unopened-session',
      sessionId: 's1',
    });
  });

  it('drags an already-open session as that view, so an edge drop moves it', () => {
    const createId = createSequentialIdFactory();
    const opened = openSessionView(createWorkspaceState(createId), 's1', createId);
    if (!opened.ok) throw new Error(opened.message);
    const viewId = Object.keys(opened.state.views)[0];
    expect(resolveSidebarDragSource(opened.state, 's1')).toEqual({ kind: 'view', viewId });
  });

  it('carries the project scope key for cross-project rejection', () => {
    const createId = createSequentialIdFactory();
    const state = createWorkspaceState(createId);
    expect(resolveSidebarDragSource(state, 's1', 'project:/a')).toEqual({
      kind: 'unopened-session',
      sessionId: 's1',
      projectScopeKey: 'project:/a',
    });
  });
});
