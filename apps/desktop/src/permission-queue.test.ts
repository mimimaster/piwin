import { describe, expect, it } from 'vitest';
import type { PermissionPromptUi } from './chat-ui-types';
import {
  activeSessionPermissionPrompt,
  activeSessionPermissionQueue,
  dequeuePermissionPrompt,
  dropPermissionPromptsForRun,
  enqueuePermissionPrompt,
  MAX_PERMISSION_QUEUE,
  parsePendingPermissionList,
  permissionQueueFields,
  reconcilePermissionQueue,
} from './permission-queue';

function prompt(
  requestId: string,
  overrides: Partial<PermissionPromptUi> = {},
): PermissionPromptUi {
  return {
    requestId,
    sessionId: 'session-1',
    action: 'bash',
    detail: requestId,
    defaultDecision: 'ask',
    ...overrides,
  };
}

describe('permission queue', () => {
  it('appends distinct request ids and keeps the head stable', () => {
    const first = prompt('a', { runId: 'run-1' });
    const second = prompt('b', { runId: 'run-1' });
    const queued = enqueuePermissionPrompt(enqueuePermissionPrompt([], first), second);
    expect(queued.map((item) => item.requestId)).toEqual(['a', 'b']);
    expect(permissionQueueFields(queued).permissionPrompt?.requestId).toBe('a');
  });

  it('ignores a duplicate request id', () => {
    const first = prompt('a');
    const original = enqueuePermissionPrompt([], first);
    const next = enqueuePermissionPrompt(original, prompt('a', { detail: 'changed' }));
    expect(next).toBe(original);
  });

  it('surfaces the next prompt after the head is cleared', () => {
    const queued = [prompt('a'), prompt('b')];
    const remaining = dequeuePermissionPrompt(queued, 'a');
    expect(permissionQueueFields(remaining).permissionPrompt?.requestId).toBe('b');
  });

  it('drops every prompt for a finished run and keeps others', () => {
    const queued = [
      prompt('a', { runId: 'run-1' }),
      prompt('b', { runId: 'run-1' }),
      prompt('c', { runId: 'run-2' }),
    ];
    const remaining = dropPermissionPromptsForRun(queued, 'run-1');
    expect(remaining.map((item) => item.requestId)).toEqual(['c']);
  });

  it('caps the queue instead of growing unbounded', () => {
    let queue: PermissionPromptUi[] = [];
    for (let index = 0; index < MAX_PERMISSION_QUEUE + 4; index += 1) {
      queue = enqueuePermissionPrompt(queue, prompt(`id-${index}`));
    }
    expect(queue).toHaveLength(MAX_PERMISSION_QUEUE);
    expect(queue[0]?.requestId).toBe('id-0');
  });
});

describe('reconcilePermissionQueue', () => {
  it('merges host pending-list into a non-empty queue without duplicating ids', () => {
    const local = [prompt('a'), prompt('b')];
    const remote = [prompt('b'), prompt('c')];
    const merged = reconcilePermissionQueue(local, remote);
    expect(merged.map((item) => item.requestId)).toEqual(['b', 'c']);
  });

  it('returns the local array when the host list is already represented', () => {
    const local = [prompt('a'), prompt('b')];
    const next = reconcilePermissionQueue(local, [prompt('a'), prompt('b')]);
    expect(next).toBe(local);
  });

  it('parses pending-list payloads and ignores malformed rows', () => {
    const parsed = parsePendingPermissionList({
      permissions: [
        {
          requestId: 'a',
          sessionId: 'session-1',
          action: 'bash',
          detail: 'ls',
          defaultDecision: 'ask',
          runId: 'run-1',
        },
        { requestId: 'bad' },
        'nope',
      ],
    });
    expect(parsed).toEqual([
      {
        requestId: 'a',
        sessionId: 'session-1',
        action: 'bash',
        detail: 'ls',
        defaultDecision: 'ask',
        runId: 'run-1',
      },
    ]);
  });

  it('restores the outside-directory facts after reconnect', () => {
    const [prompt] = parsePendingPermissionList({
      permissions: [{
        requestId: 'job-1',
        sessionId: 'session-1',
        action: 'process:start',
        detail: 'cwd-outside-workspace: /other\n$ pnpm dev',
        defaultDecision: 'ask',
        context: {
          kind: 'command',
          summary: 'Run a process outside this workspace',
          outsideWorkspace: true,
          cwd: '/other',
          command: 'pnpm dev',
        },
      }],
    });
    expect(prompt?.context).toMatchObject({
      outsideWorkspace: true,
      cwd: '/other',
      command: 'pnpm dev',
    });
  });
});

describe('active session permission view', () => {
  const foreign = prompt('foreign', { sessionId: 'session-2' });
  const own = prompt('own', { sessionId: 'session-1' });
  const child = prompt('child', { sessionId: 'child-1' });
  const childSummary = {
    id: 'child-1',
    scope: { kind: 'project' as const, projectPath: '/repo' },
    workingDirectory: '/repo',
    projectPath: '/repo',
    updatedAt: '2026-09-22T00:00:00.000Z',
    messageCount: 0,
    parentSessionId: 'session-1',
    kind: 'subagent' as const,
  };

  it('does not let another session head block the active session', () => {
    const state = {
      permissionQueue: [foreign, own],
      activeSessionId: 'session-1',
      subagentChildren: {},
    };
    expect(activeSessionPermissionPrompt(state)?.requestId).toBe('own');
  });

  it('returns no prompt when only other sessions are waiting', () => {
    const state = {
      permissionQueue: [foreign],
      activeSessionId: 'session-1',
      subagentChildren: {},
    };
    expect(activeSessionPermissionPrompt(state)).toBeNull();
  });

  it('includes subagent children of the active session', () => {
    const state = {
      permissionQueue: [foreign, child, own],
      activeSessionId: 'session-1',
      subagentChildren: { 'child-1': childSummary },
    };
    expect(activeSessionPermissionQueue(state).map((item) => item.requestId)).toEqual([
      'child',
      'own',
    ]);
  });

  it('is empty without an active session', () => {
    expect(
      activeSessionPermissionQueue({
        permissionQueue: [own],
        activeSessionId: null,
        subagentChildren: {},
      }),
    ).toEqual([]);
  });
});
