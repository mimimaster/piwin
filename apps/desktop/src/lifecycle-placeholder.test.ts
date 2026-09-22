import { describe, expect, it } from 'vitest';
import type { ChatMessageUi, ToolCardUi } from './chat-ui-types.js';
import { resolveHiddenLifecyclePlaceholderIds } from './lifecycle-placeholder.js';

function assistant(partial: Partial<ChatMessageUi> & Pick<ChatMessageUi, 'id'>): ChatMessageUi {
  return {
    role: 'assistant',
    text: '',
    thinking: '',
    tools: [],
    attachments: [],
    status: 'done',
    runId: 'run-1',
    ...partial,
  };
}

function user(id: string): ChatMessageUi {
  return { id, role: 'user', text: 'do it', thinking: '', tools: [], attachments: [], status: 'done' };
}

const readTool: ToolCardUi = {
  toolCallId: 'r-1',
  toolName: 'read',
  status: 'done',
  output: 'src',
};

function resolve(
  messages: ChatMessageUi[],
  overrides: Partial<Parameters<typeof resolveHiddenLifecyclePlaceholderIds>[0]> = {},
): ReadonlySet<string> {
  return resolveHiddenLifecyclePlaceholderIds({
    messages,
    streaming: true,
    showThinking: true,
    permissionPending: false,
    ...overrides,
  });
}

describe('resolveHiddenLifecyclePlaceholderIds', () => {
  it('hides the empty placeholder that follows a text answer', () => {
    // The reported shape: a long answer with no tools, then `message/start`.
    const hidden = resolve([
      user('u1'),
      assistant({ id: 'a1', text: '说明：这是一个纯 Canvas 2D 渲染的箱庭' }),
      assistant({ id: 'a2', status: 'streaming' }),
    ]);
    expect([...hidden]).toEqual(['a2']);
  });

  it('hides the empty placeholder that follows a tool round', () => {
    const hidden = resolve([
      user('u1'),
      assistant({ id: 'a1', tools: [readTool] }),
      assistant({ id: 'a2', status: 'streaming' }),
    ]);
    expect([...hidden]).toEqual(['a2']);
  });

  it('hides a thinking-only placeholder when reasoning display is off', () => {
    const messages = [
      user('u1'),
      assistant({ id: 'a1', text: 'An answer.' }),
      assistant({ id: 'a2', status: 'streaming', thinking: '继续想下一段代码…' }),
    ];
    expect([...resolve(messages, { showThinking: false })]).toEqual(['a2']);
    // With reasoning visible the row paints a thought, so it keeps its place.
    expect([...resolve(messages, { showThinking: true })]).toEqual([]);
  });

  it('keeps the first assistant row of a turn', () => {
    // Nothing renders above it: it owns the identity header and the
    // sent-but-no-token-yet state.
    expect([...resolve([user('u1'), assistant({ id: 'a1', status: 'streaming' })])]).toEqual([]);
  });

  it('keeps a row that carries an error', () => {
    const hidden = resolve([
      user('u1'),
      assistant({ id: 'a1', text: 'An answer.' }),
      assistant({ id: 'a2', status: 'error', error: 'provider failed' }),
    ]);
    expect([...hidden]).toEqual([]);
  });

  it('keeps every row while a permission gate is open', () => {
    const hidden = resolve(
      [
        user('u1'),
        assistant({ id: 'a1', text: 'An answer.' }),
        assistant({ id: 'a2', status: 'streaming' }),
      ],
      { permissionPending: true },
    );
    expect([...hidden]).toEqual([]);
  });

  it('hides nothing once the thread has settled', () => {
    const hidden = resolve(
      [
        user('u1'),
        assistant({ id: 'a1', text: 'An answer.' }),
        assistant({ id: 'a2', status: 'streaming' }),
      ],
      { streaming: false },
    );
    expect([...hidden]).toEqual([]);
  });

  it('keeps a settled empty row for the row guard to prune', () => {
    const hidden = resolve([
      user('u1'),
      assistant({ id: 'a1', text: 'An answer.' }),
      assistant({ id: 'a2', status: 'done' }),
    ]);
    expect([...hidden]).toEqual([]);
  });

  it('keeps rows that render their own chrome', () => {
    const hidden = resolve([
      user('u1'),
      assistant({ id: 'a1', text: 'An answer.' }),
      assistant({
        id: 'a2',
        status: 'streaming',
        subagentActivity: {
          childSessionId: 'child-1',
          displayName: 'Explorer',
          taskSummary: 'Search',
          state: 'running',
          updatedAt: '2026-09-22T00:00:00.000Z',
        },
      }),
    ]);
    expect([...hidden]).toEqual([]);
  });

  it('hides several placeholders in one turn', () => {
    const hidden = resolve([
      user('u1'),
      assistant({ id: 'a1', text: 'First part.' }),
      assistant({ id: 'a2', status: 'streaming' }),
      assistant({ id: 'a3', text: 'Second part.' }),
      assistant({ id: 'a4', status: 'streaming' }),
    ]);
    expect([...hidden].sort()).toEqual(['a2', 'a4']);
  });
});
