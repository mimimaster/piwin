import { describe, expect, it, vi } from 'vitest';
import { reconcilePendingPermissions } from './reconcile-pending-permissions';

describe('reconcilePendingPermissions', () => {
  it('narrows the merge to one session so a pane takes only its own prompts', async () => {
    const dispatch = vi.fn();
    const entry = (requestId: string, sessionId: string) => ({
      requestId,
      sessionId,
      action: 'bash',
      detail: 'ls',
      defaultDecision: 'ask',
    });
    await reconcilePendingPermissions({
      hostClient: {
        supportsCommand: () => true,
        request: async () => ({
          type: 'response',
          command: 'permission/pending-list',
          success: true,
          data: {
            permissions: [entry('mine', 'session-pane'), entry('theirs', 'session-main')],
          },
        }),
      },
      dispatch,
      sessionId: 'session-pane',
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'permission/reconcile',
      permissions: [entry('mine', 'session-pane')],
    });
  });

  it('is a no-op when the host does not advertise pending-list', async () => {
    const dispatch = vi.fn();
    const request = vi.fn();
    await reconcilePendingPermissions({
      hostClient: {
        supportsCommand: () => false,
        request,
      },
      dispatch,
    });
    expect(request).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('merges a pending-list payload into the queue', async () => {
    const dispatch = vi.fn();
    await reconcilePendingPermissions({
      hostClient: {
        supportsCommand: (type) => type === 'permission/pending-list',
        request: async () => ({
          type: 'response',
          command: 'permission/pending-list',
          success: true,
          data: {
            permissions: [
              {
                requestId: 'a',
                sessionId: 'session-1',
                action: 'bash',
                detail: 'ls',
                defaultDecision: 'ask',
              },
            ],
          },
        }),
      },
      dispatch,
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'permission/reconcile',
      permissions: [
        {
          requestId: 'a',
          sessionId: 'session-1',
          action: 'bash',
          detail: 'ls',
          defaultDecision: 'ask',
        },
      ],
    });
  });
});
