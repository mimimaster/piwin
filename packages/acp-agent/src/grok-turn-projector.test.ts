import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '@piwin/contracts';
import { GrokTurnProjector } from './grok-turn-projector.js';

/** Sanitized shapes from the grok 1.0.41 probe (no real paths or secrets). */
const WRITE_TOOL_CALL = {
  sessionUpdate: 'tool_call',
  toolCallId: 'call-1',
  title: 'write',
  status: 'pending',
  rawInput: { path: '/tmp/ws/note.txt', content: 'hi' },
  _meta: { 'x.ai/tool': { name: 'write', kind: 'edit', namespace: 'builtin', read_only: false } },
};
const WRITE_TOOL_DETAIL = {
  sessionUpdate: 'tool_call_update',
  toolCallId: 'call-1',
  kind: 'edit',
  title: 'Write `/tmp/ws/note.txt`',
  content: [{ type: 'diff', path: '/tmp/ws/note.txt', oldText: null, newText: 'hi' }],
  locations: [{ path: '/tmp/ws/note.txt' }],
};
const SHELL_TOOL_CALL = {
  sessionUpdate: 'tool_call',
  toolCallId: 'call-2',
  title: 'run_terminal_command',
  rawInput: { command: 'rm note.txt' },
  _meta: { 'x.ai/tool': { name: 'run_terminal_command', read_only: false } },
};

function createProjector(): GrokTurnProjector {
  let counter = 0;
  return new GrokTurnProjector({
    runId: 'run-1',
    createMessageId: () => {
      counter += 1;
      return `msg-${counter}`;
    },
    now: () => '2026-09-29T00:00:00.000Z',
  });
}

function types(events: readonly AgentEvent[]): string[] {
  return events.map((event) => event.type);
}

describe('GrokTurnProjector', () => {
  it('allocates one assistant message per contiguous text run', () => {
    const projector = createProjector();
    const first = projector.project({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'Hel' },
    });
    const second = projector.project({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'lo' },
    });
    expect(types(first.events)).toEqual(['message/start', 'message/text_delta']);
    expect(types(second.events)).toEqual(['message/text_delta']);
    expect(first.events[0]).toMatchObject({ messageId: 'msg-1', role: 'assistant', runId: 'run-1' });
    expect(types(projector.finish('completed'))).toEqual(['message/end']);
  });

  it('merges the three-phase tool lifecycle into one card', () => {
    const projector = createProjector();
    projector.project({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'ok' } });
    const start = projector.project(WRITE_TOOL_CALL).events;
    expect(types(start)).toEqual(['message/end', 'tool/start']);
    expect(start[1]).toMatchObject({
      type: 'tool/start',
      toolCallId: 'call-1',
      toolName: 'write',
      responseMessageId: 'msg-1',
      presentation: { kind: 'other', title: 'write', targetPaths: ['/tmp/ws/note.txt'] },
    });

    const detail = projector.project(WRITE_TOOL_DETAIL).events;
    expect(detail).toHaveLength(1);
    expect(detail[0]).toMatchObject({
      type: 'tool/update',
      presentation: {
        kind: 'filesystem',
        title: 'Write `/tmp/ws/note.txt`',
        actionVerb: 'Editing',
        changedPaths: ['/tmp/ws/note.txt'],
      },
    });

    expect(types(projector.project({ sessionUpdate: 'tool_call_update', toolCallId: 'call-1', status: 'in_progress' }).events)).toEqual(['tool/update']);
    const end = projector.project({ sessionUpdate: 'tool_call_update', toolCallId: 'call-1', status: 'completed' }).events;
    expect(end[0]).toMatchObject({
      type: 'tool/end',
      isError: false,
      presentation: { actionVerb: 'Edited', durationMs: 0 },
    });
    // Late frames after terminal are ignored.
    expect(projector.project({ sessionUpdate: 'tool_call_update', toolCallId: 'call-1', status: 'in_progress' }).events).toEqual([]);
  });

  it('projects shell command, output and exit code', () => {
    const projector = createProjector();
    projector.project(SHELL_TOOL_CALL);
    projector.project({ sessionUpdate: 'tool_call_update', toolCallId: 'call-2', kind: 'execute', title: 'Execute `rm note.txt`' });
    const end = projector.project({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'call-2',
      status: 'failed',
      rawOutput: { exit_code: 1, output: 'rm: no such file', truncated: false, timed_out: false },
    }).events;
    expect(end[0]).toMatchObject({
      type: 'tool/end',
      isError: true,
      presentation: {
        kind: 'shell',
        command: 'rm note.txt',
        actionVerb: 'Ran command',
        exitCode: 1,
        output: { text: 'rm: no such file' },
        error: { category: 'execution', message: 'Exited with code 1' },
      },
    });
  });

  it('replays a load-time completed tool_call as start + end', () => {
    const projector = createProjector();
    const events = projector.project({ ...WRITE_TOOL_CALL, ...WRITE_TOOL_DETAIL, sessionUpdate: 'tool_call', status: 'completed' }).events;
    expect(types(events)).toEqual(['tool/start', 'tool/end']);
  });

  it('terminates open tools when the turn is cancelled', () => {
    const projector = createProjector();
    projector.project(SHELL_TOOL_CALL);
    const events = projector.finish('aborted');
    expect(events[0]).toMatchObject({ type: 'tool/end', toolCallId: 'call-2', isError: true });
  });

  it('surfaces title, mode, commands and plan as signals', () => {
    const projector = createProjector();
    expect(projector.project({ sessionUpdate: 'session_info_update', title: '  Fix bug ' }).signals).toEqual([{ kind: 'title', title: 'Fix bug' }]);
    expect(projector.project({ sessionUpdate: 'current_mode_update', currentModeId: 'plan' }).signals).toEqual([{ kind: 'mode', modeId: 'plan' }]);
    expect(projector.project({ sessionUpdate: 'available_commands_update', availableCommands: [{ name: 'compact' }] }).signals[0]?.kind).toBe('commands');
    expect(projector.project({ sessionUpdate: 'plan', entries: [] }).signals[0]?.kind).toBe('plan');
  });

  it('maps thought chunks to thinking deltas', () => {
    const projector = createProjector();
    const events = projector.project({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'hmm' } }).events;
    expect(types(events)).toEqual(['message/start', 'message/thinking_delta']);
  });

  it('ignores unknown updates and malformed input', () => {
    const projector = createProjector();
    expect(projector.project(null)).toEqual({ events: [], signals: [] });
    expect(projector.project({ sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'x' } })).toEqual({ events: [], signals: [] });
  });
});
