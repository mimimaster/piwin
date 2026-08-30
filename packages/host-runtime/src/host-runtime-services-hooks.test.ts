import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { HostPush } from '@piwin/contracts';
import { hookEventForAgentEvent, notifyForegroundSessionTurnTerminal } from './host-runtime-services.js';
import type { HostRuntimeKernel } from './host-runtime-kernel.js';
import { RunRegistry } from './run-registry.js';

describe('hookEventForAgentEvent', () => {
  it('does not map usage/update or session/aborted to turn_end', () => {
    expect(
      hookEventForAgentEvent({
        type: 'usage/update',
        sessionId: 's1',
        usage: { sessionId: 's1', updatedAt: '2026-08-30T00:00:00.000Z' },
      }),
    ).toBeNull();
    expect(hookEventForAgentEvent({ type: 'session/aborted', sessionId: 's1' })).toBeNull();
  });

  it('keeps agent_start, turn_start, tool_execution_end, and agent_end', () => {
    expect(hookEventForAgentEvent({ type: 'session/started', sessionId: 's1' })).toBe('agent_start');
    expect(hookEventForAgentEvent({ type: 'session/ended', sessionId: 's1' })).toBe('agent_end');
    expect(hookEventForAgentEvent({ type: 'message/start', messageId: 'm1', role: 'user' })).toBe(
      'turn_start',
    );
    expect(
      hookEventForAgentEvent({ type: 'tool/end', toolCallId: 't1', isError: false }),
    ).toBe('tool_execution_end');
  });
});

describe('notifyForegroundSessionTurnTerminal', () => {
  it('T14b: one session-turn terminal fires turn_end once; subagent-task does not', async () => {
    const occupancyTerminals: string[] = [];
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-turn-end-'));
    const deps = {
      turnEndHooksFired: new Set<string>(),
      sessionProjects: new Map(),
      options: { piwinRoot: rootDir },
      push: (_message: HostPush) => undefined,
      sessionContextCoordinator: {
        noteRunTerminal: async (input: { runId: string }) => {
          occupancyTerminals.push(input.runId);
        },
      },
    } as unknown as HostRuntimeKernel;
    const registry = new RunRegistry({
      onRunTerminal: (run) => {
        notifyForegroundSessionTurnTerminal(deps, run);
      },
    });
    const parent = registry.createForegroundRun('session-1');
    const child = registry.create({
      kind: 'subagent-task',
      sessionId: 'session-1',
      parentRunId: parent.runId,
    });
    const startedChild = registry.start(child.runId);
    expect(startedChild?.status).toBe('running');
    expect(registry.terminate(child.runId, 'completed', 'completed')).toBeDefined();
    expect(deps.turnEndHooksFired.size).toBe(0);
    expect(occupancyTerminals).toEqual([]);

    expect(registry.terminate(parent.runId, 'completed', 'completed')).toBeDefined();
    expect(deps.turnEndHooksFired.size).toBe(1);
    expect(deps.turnEndHooksFired.has(parent.runId)).toBe(true);
    expect(occupancyTerminals).toEqual([parent.runId]);

    notifyForegroundSessionTurnTerminal(deps, registry.get(parent.runId) ?? parent);
    expect(deps.turnEndHooksFired.size).toBe(1);
  });
});
