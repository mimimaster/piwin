import { describe, expect, it } from 'vitest';
import type { MobileTranscriptMessage } from '../../mobile-transcript.js';
import { buildTranscriptEntries, describeTurnState, describeWork } from './turn-model.js';

function user(id: string, text: string): MobileTranscriptMessage {
  return { id, role: 'user', text, createdAt: '2026-09-25T03:22:00.000Z', status: 'done' };
}

function assistant(
  id: string,
  runId: string,
  patch: Partial<MobileTranscriptMessage> = {},
): MobileTranscriptMessage {
  return {
    id,
    role: 'assistant',
    text: '',
    createdAt: '2026-09-25T03:22:01.000Z',
    status: 'done',
    runId,
    model: { providerId: 'deepseek', modelId: 'deepseek-flash' },
    ...patch,
  };
}

const bash = {
  id: 'call-1',
  name: 'bash',
  status: 'done' as const,
  presentation: { kind: 'shell' as const, title: 'bash', command: 'ls -la', exitCode: 0 },
};

const write = {
  id: 'call-2',
  name: 'write_file',
  status: 'done' as const,
  presentation: {
    kind: 'filesystem' as const,
    title: 'write_file',
    targetPaths: ['perm-test.txt'],
    changedPaths: ['perm-test.txt'],
  },
};

describe('buildTranscriptEntries', () => {
  it('folds every Pi step of one run into a single turn with the answer as prose', () => {
    const entries = buildTranscriptEntries([
      user('u1', '创建文件然后 ls'),
      assistant('a1', 'r1', { thinking: '先写文件', toolCalls: [write] }),
      assistant('a2', 'r1', { thinking: '再列目录', toolCalls: [bash] }),
      assistant('a3', 'r1', { text: '好了，3 个文件。', endedAt: '2026-09-25T03:22:13.000Z' }),
    ]);
    expect(entries.map((entry) => entry.kind)).toEqual(['user', 'turn']);
    const turn = entries[1]?.kind === 'turn' ? entries[1].turn : undefined;
    expect(turn?.steps.map((step) => step.kind)).toEqual(['thinking', 'tool', 'thinking', 'tool']);
    expect(turn?.prose?.text).toBe('好了，3 个文件。');
    expect(turn?.toolCount).toBe(2);
    expect(turn?.fileCount).toBe(1);
    expect(turn?.changedPaths).toEqual(['perm-test.txt']);
    expect(turn?.status).toBe('done');
    expect(turn !== undefined ? describeTurnState(turn) : '').toBe('工作了 12 秒');
    expect(turn !== undefined ? describeWork(turn) : '').toBe('2 个工具 · 1 个文件');
  });

  it('keeps text that precedes tool calls as narration, not prose', () => {
    const entries = buildTranscriptEntries([
      user('u1', 'go'),
      assistant('a1', 'r1', { text: '我先看一下目录。', toolCalls: [bash] }),
    ]);
    const turn = entries[1]?.kind === 'turn' ? entries[1].turn : undefined;
    expect(turn?.steps[0]).toMatchObject({ kind: 'narration', text: '我先看一下目录。' });
    expect(turn?.prose).toBeUndefined();
  });

  it('starts a new turn when the run changes even without a user message', () => {
    const entries = buildTranscriptEntries([
      user('u1', 'go'),
      assistant('a1', 'r1', { text: 'one' }),
      assistant('a2', 'r2', { text: 'two' }),
    ]);
    expect(entries.map((entry) => entry.kind)).toEqual(['user', 'turn', 'turn']);
  });

  it('marks the active run as running between steps', () => {
    const entries = buildTranscriptEntries(
      [user('u1', 'go'), assistant('a1', 'r1', { toolCalls: [bash] })],
      { activeRunId: 'r1' },
    );
    const turn = entries[1]?.kind === 'turn' ? entries[1].turn : undefined;
    expect(turn?.status).toBe('running');
  });

  it('adds a pending turn while the Host has not answered yet', () => {
    const entries = buildTranscriptEntries([user('u1', 'go')], {
      activeRunId: 'r9',
      awaitingResponse: true,
    });
    expect(entries.map((entry) => entry.kind)).toEqual(['user', 'turn']);
    const turn = entries[1]?.kind === 'turn' ? entries[1].turn : undefined;
    expect(turn !== undefined ? describeTurnState(turn) : '').toBe('正在思考');
  });

  it('keeps Host-queued user rows out of the transcript until admitted', () => {
    const entries = buildTranscriptEntries(
      [user('u1', 'go'), assistant('a1', 'r1', { toolCalls: [bash] }), user('u2', '排队的话')],
      { activeRunId: 'r1', awaitingResponse: true, queuedUserMessageIds: new Set(['u2']) },
    );
    expect(entries.map((entry) => entry.kind)).toEqual(['user', 'turn']);
    const turn = entries[1]?.kind === 'turn' ? entries[1].turn : undefined;
    expect(turn?.status).toBe('running');
  });

  it('folds an in-run intervention into the same turn', () => {
    const interject: MobileTranscriptMessage = {
      ...user('u2', '最后一步改成 echo'),
      instructionDelivery: {
        kind: 'run-intervention',
        instructionId: 'i1',
        status: 'applied',
        targetRunId: 'r1',
        revision: 2,
      },
    };
    const entries = buildTranscriptEntries([
      user('u1', 'go'),
      assistant('a1', 'r1', { toolCalls: [bash] }),
      interject,
      assistant('a2', 'r1', { text: '按插话完成。' }),
    ]);
    expect(entries.map((entry) => entry.kind)).toEqual(['user', 'turn']);
    const turn = entries[1]?.kind === 'turn' ? entries[1].turn : undefined;
    expect(turn?.steps.map((step) => step.kind)).toEqual(['tool', 'intervention']);
    expect(turn?.prose?.text).toBe('按插话完成。');
  });

  it('keeps the answer as prose when the run ends with an empty assistant message', () => {
    const entries = buildTranscriptEntries([
      user('u1', 'go'),
      assistant('a1', 'r1', { toolCalls: [bash] }),
      assistant('a2', 'r1', { text: '完成了。' }),
      assistant('a3', 'r1', { text: '' }),
    ]);
    const turn = entries[1]?.kind === 'turn' ? entries[1].turn : undefined;
    expect(turn?.prose?.text).toBe('完成了。');
    expect(turn?.steps.map((step) => step.kind)).toEqual(['tool']);
  });

  it('reports failed and cancelled outcomes', () => {
    const failed = buildTranscriptEntries([user('u1', 'go'), assistant('a1', 'r1', { outcome: 'failed' })]);
    const cancelled = buildTranscriptEntries([
      user('u1', 'go'),
      assistant('a1', 'r1', { outcome: 'cancelled' }),
    ]);
    expect(failed[1]?.kind === 'turn' ? failed[1].turn.status : '').toBe('failed');
    expect(cancelled[1]?.kind === 'turn' ? cancelled[1].turn.status : '').toBe('cancelled');
  });
});
