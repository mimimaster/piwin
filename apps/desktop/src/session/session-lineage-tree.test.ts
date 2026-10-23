import { describe, expect, it } from 'vitest';
import type {
  ProductSessionLineageNode,
  ProductSessionLineageView,
  ProductSessionOrigin,
} from '@piwin/contracts';
import {
  buildSessionLineageTree,
  getDirectForkCountsByMessageId,
} from './session-lineage-tree';

function createForkOrigin(
  rootSessionId: string,
  sourceSessionId: string,
  sourceMessageId: string,
): ProductSessionOrigin {
  return {
    kind: 'fork',
    rootSessionId,
    sourceSessionId,
    sourceMessageId,
    sourceMessageRole: 'assistant',
    sourceMessagePreview: `Response ${sourceMessageId}`,
    sourceMessageCreatedAt: '2026-08-09T09:00:00.000Z',
    workspaceStrategy: 'shared',
    createdAt: '2026-08-09T09:01:00.000Z',
  };
}

function createNode(
  sessionId: string,
  updatedAt: string,
  origin?: ProductSessionOrigin,
): ProductSessionLineageNode {
  return {
    sessionId,
    ...(origin ? { origin } : {}),
    name: sessionId,
    isArchived: false,
    updatedAt,
  };
}

describe('buildSessionLineageTree', () => {
  it('attaches first-level and nested forks to their immediate source', () => {
    const view: ProductSessionLineageView = {
      rootSessionId: 'root',
      activeSessionId: 'root',
      rootMissing: false,
      nodes: [
        createNode('root', '2026-08-09T09:00:00.000Z'),
        createNode('branch-old', '2026-08-09T09:02:00.000Z', createForkOrigin('root', 'root', 'msg-1')),
        createNode('branch-new', '2026-08-09T09:03:00.000Z', createForkOrigin('root', 'root', 'msg-2')),
        createNode(
          'nested-branch',
          '2026-08-09T09:04:00.000Z',
          createForkOrigin('root', 'branch-new', 'branch-msg-1'),
        ),
      ],
    };

    const tree = buildSessionLineageTree(view);

    expect(tree.detached).toHaveLength(0);
    expect(tree.root?.sessionId).toBe('root');
    expect(tree.root?.children.map((node) => node.sessionId)).toEqual([
      'branch-new',
      'branch-old',
    ]);
    expect(tree.root?.children[0]?.children.map((node) => node.sessionId)).toEqual([
      'nested-branch',
    ]);
  });

  it('keeps a deleted root visible as a non-navigable placeholder', () => {
    const view: ProductSessionLineageView = {
      rootSessionId: 'deleted-root',
      activeSessionId: 'branch-a',
      rootMissing: true,
      nodes: [
        createNode(
          'branch-a',
          '2026-08-09T09:02:00.000Z',
          createForkOrigin('deleted-root', 'deleted-root', 'msg-1'),
        ),
        createNode(
          'branch-b',
          '2026-08-09T09:03:00.000Z',
          createForkOrigin('deleted-root', 'branch-a', 'branch-msg-1'),
        ),
      ],
    };

    const tree = buildSessionLineageTree(view);

    expect(tree.root?.sessionId).toBe('deleted-root');
    expect(tree.root?.isMissingRoot).toBe(true);
    expect(tree.root?.children[0]?.sessionId).toBe('branch-a');
    expect(tree.root?.children[0]?.children[0]?.sessionId).toBe('branch-b');
    expect(tree.detached).toHaveLength(0);
  });

  it('does not drop detached records when an origin points outside the projection', () => {
    const view: ProductSessionLineageView = {
      rootSessionId: 'root',
      activeSessionId: 'root',
      rootMissing: false,
      nodes: [
        createNode('root', '2026-08-09T09:00:00.000Z'),
        createNode(
          'orphan',
          '2026-08-09T09:05:00.000Z',
          createForkOrigin('root', 'missing-source', 'msg-1'),
        ),
      ],
    };

    const tree = buildSessionLineageTree(view);

    expect(tree.root?.children).toHaveLength(0);
    expect(tree.detached.map((node) => node.sessionId)).toEqual(['orphan']);
  });
});

describe('getDirectForkCountsByMessageId', () => {
  it('counts only forks directly created from the active session', () => {
    const view: ProductSessionLineageView = {
      rootSessionId: 'root',
      activeSessionId: 'root',
      rootMissing: false,
      nodes: [
        createNode('root', '2026-08-09T09:00:00.000Z'),
        createNode('branch-a', '2026-08-09T09:01:00.000Z', createForkOrigin('root', 'root', 'msg-1')),
        createNode('branch-b', '2026-08-09T09:02:00.000Z', createForkOrigin('root', 'root', 'msg-1')),
        createNode(
          'nested',
          '2026-08-09T09:03:00.000Z',
          createForkOrigin('root', 'branch-a', 'branch-msg-1'),
        ),
      ],
    };

    expect(getDirectForkCountsByMessageId(view)).toEqual({ 'msg-1': 2 });
    expect(getDirectForkCountsByMessageId(null)).toEqual({});
  });
});
