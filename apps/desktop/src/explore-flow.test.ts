import { describe, expect, it } from 'vitest';
import type { ChatMessageUi, ToolCardUi } from './chat-reducer';
import {
  buildExploreFlowRoles,
  exploreFlowRolesEqual,
  type ExploreFlowRole,
} from './explore-flow';

function readTool(toolCallId: string, path: string, status: ToolCardUi['status'] = 'done'): ToolCardUi {
  return {
    toolCallId,
    toolName: 'read',
    status,
    output: 'file body',
    presentation: {
      kind: 'filesystem',
      title: 'Read',
      actionVerb: 'Read',
      targetPaths: [path],
      durationMs: 20,
    },
  };
}

function grepTool(toolCallId: string, status: ToolCardUi['status'] = 'done'): ToolCardUi {
  return {
    toolCallId,
    toolName: 'grep',
    status,
    output: 'matches',
    presentation: {
      kind: 'filesystem',
      title: 'Search',
      actionVerb: 'Searched',
      summary: 'clusterToolCalls',
    },
  };
}

function editTool(toolCallId: string): ToolCardUi {
  return {
    toolCallId,
    toolName: 'edit',
    status: 'done',
    output: 'ok',
    presentation: {
      kind: 'filesystem',
      title: 'Edit',
      actionVerb: 'Edited',
      targetPaths: ['src/foo.ts'],
      changedPaths: ['src/foo.ts'],
    },
  };
}

function assistantStep(
  id: string,
  input: {
    thinking?: string;
    thinkingStartedAt?: number;
    thinkingEndedAt?: number;
    tools?: ToolCardUi[];
    text?: string;
    status?: ChatMessageUi['status'];
  } = {},
): ChatMessageUi {
  return {
    id,
    role: 'assistant',
    text: input.text ?? '',
    thinking: input.thinking ?? '',
    tools: input.tools ?? [],
    attachments: [],
    status: input.status ?? 'done',
    ...(input.thinkingStartedAt !== undefined
      ? { thinkingStartedAt: input.thinkingStartedAt }
      : {}),
    ...(input.thinkingEndedAt !== undefined ? { thinkingEndedAt: input.thinkingEndedAt } : {}),
  };
}

function userMessage(id: string): ChatMessageUi {
  return { id, role: 'user', text: 'do it', thinking: '', tools: [], attachments: [], status: 'done' };
}

describe('buildExploreFlowRoles', () => {
  it('merges consecutive thought+read steps across messages into one anchored group', () => {
    const roles = buildExploreFlowRoles([
      userMessage('u1'),
      assistantStep('m1', {
        thinking: 'planning the read',
        thinkingStartedAt: 1_000,
        thinkingEndedAt: 3_000,
        tools: [readTool('t1', 'src/a.ts')],
      }),
      assistantStep('m2', { tools: [grepTool('t2')] }),
      assistantStep('m3', { tools: [readTool('t3', 'src/b.ts')] }),
    ]);

    const anchor = roles.get('m1');
    expect(anchor?.kind).toBe('anchor');
    if (anchor?.kind !== 'anchor') return;
    expect(roles.get('m2')).toEqual({ kind: 'member', anchorMessageId: 'm1' });
    expect(roles.get('m3')).toEqual({ kind: 'member', anchorMessageId: 'm1' });
    expect(anchor.group.items.map((item) => item.kind)).toEqual([
      'thought',
      'tool',
      'tool',
      'tool',
    ]);
    expect(anchor.group.toolCount).toBe(3);
    expect(anchor.group.fileCount).toBe(2);
    expect(anchor.group.searchCount).toBe(1);
    expect(anchor.group.thoughtCount).toBe(1);
    const thought = anchor.group.items[0];
    expect(thought?.kind === 'thought' && thought.seconds).toBe(2);
    expect(anchor.group.isLive).toBe(false);
  });

  it('keeps a single read as a plain row (no group under two tools)', () => {
    const roles = buildExploreFlowRoles([
      assistantStep('m1', { thinking: 'look once', tools: [readTool('t1', 'src/a.ts')] }),
      assistantStep('m2', { text: 'answer' }),
    ]);
    expect(roles.size).toBe(0);
  });

  it('starts a new run on narration plus explore tools and merges following steps', () => {
    const roles = buildExploreFlowRoles([
      assistantStep('m1', {
        text: '我先查一下实时语音和会话绑定。',
        thinking: 'look up the binder',
        tools: [grepTool('t1'), readTool('t2', 'docs/voice.md')],
      }),
      assistantStep('m2', { tools: [grepTool('t3'), grepTool('t4'), readTool('t5', 'src/live.ts')] }),
    ]);

    const anchor = roles.get('m1');
    expect(anchor?.kind).toBe('anchor');
    if (anchor?.kind !== 'anchor') return;
    expect(roles.get('m2')).toEqual({ kind: 'member', anchorMessageId: 'm1' });
    expect(anchor.group.items.map((item) => item.kind)).toEqual([
      'tool',
      'tool',
      'tool',
      'tool',
      'tool',
    ]);
    expect(anchor.group.toolCount).toBe(5);
    expect(anchor.group.searchCount).toBe(3);
    expect(anchor.group.thoughtCount).toBe(0);
  });

  it('does not join a narration opener onto a preceding silent explore run', () => {
    const roles = buildExploreFlowRoles([
      assistantStep('m1', { tools: [readTool('t1', 'src/a.ts'), readTool('t2', 'src/b.ts')] }),
      assistantStep('m2', {
        text: '再确认一下 Desktop 焦点会话。',
        tools: [grepTool('t3'), readTool('t4', 'src/c.ts')],
      }),
    ]);

    expect(roles.get('m1')?.kind).toBe('anchor');
    expect(roles.get('m2')?.kind).toBe('anchor');
    const first = roles.get('m1');
    const second = roles.get('m2');
    if (first?.kind !== 'anchor' || second?.kind !== 'anchor') return;
    expect(first.group.toolCount).toBe(2);
    expect(second.group.toolCount).toBe(2);
  });

  it('breaks the run on answer text, edits, and user messages', () => {
    const roles = buildExploreFlowRoles([
      assistantStep('m1', { tools: [readTool('t1', 'src/a.ts')] }),
      assistantStep('m2', { tools: [readTool('t2', 'src/b.ts')] }),
      assistantStep('m3', { tools: [editTool('t3')] }),
      assistantStep('m4', { tools: [readTool('t4', 'src/c.ts')] }),
      userMessage('u2'),
      assistantStep('m5', { tools: [readTool('t5', 'src/d.ts')] }),
    ]);

    expect(roles.get('m1')?.kind).toBe('anchor');
    expect(roles.get('m2')?.kind).toBe('member');
    expect(roles.get('m3')).toBeUndefined();
    // m4 and m5 are isolated single reads split by the edit and the user turn.
    expect(roles.get('m4')).toBeUndefined();
    expect(roles.get('m5')).toBeUndefined();
  });

  it('folds a trailing answer thought into the group but keeps its own row', () => {
    const roles = buildExploreFlowRoles([
      assistantStep('m1', { tools: [readTool('t1', 'src/a.ts')] }),
      assistantStep('m2', { tools: [readTool('t2', 'src/b.ts')] }),
      assistantStep('m3', {
        thinking: 'now I know the answer',
        thinkingStartedAt: 0,
        thinkingEndedAt: 5_000,
        text: 'Here is the summary.',
      }),
    ]);

    const anchor = roles.get('m1');
    expect(anchor?.kind).toBe('anchor');
    if (anchor?.kind !== 'anchor') return;
    expect(roles.get('m3')).toEqual({ kind: 'fold-thought', anchorMessageId: 'm1' });
    const lastItem = anchor.group.items[anchor.group.items.length - 1];
    expect(lastItem?.kind).toBe('thought');
    expect(lastItem?.kind === 'thought' && lastItem.seconds).toBe(5);
  });

  it('marks the trailing open run live only while the stream is active', () => {
    const messages = [
      assistantStep('m1', { tools: [readTool('t1', 'src/a.ts')] }),
      assistantStep('m2', {
        status: 'streaming',
        tools: [readTool('t2', 'src/b.ts', 'running')],
      }),
    ];
    const liveRoles = buildExploreFlowRoles(messages, { streamActive: true });
    const liveAnchor = liveRoles.get('m1');
    expect(liveAnchor?.kind === 'anchor' && liveAnchor.group.isLive).toBe(true);

    const settled = buildExploreFlowRoles(
      [
        assistantStep('m1', { tools: [readTool('t1', 'src/a.ts')] }),
        assistantStep('m2', { tools: [readTool('t2', 'src/b.ts')] }),
      ],
      { streamActive: false },
    );
    const settledAnchor = settled.get('m1');
    expect(settledAnchor?.kind === 'anchor' && settledAnchor.group.isLive).toBe(false);
  });

  it('keeps a live run open across an empty streaming message/start placeholder', () => {
    const established = [
      assistantStep('m1', { tools: [readTool('t1', 'src/a.ts')] }),
      assistantStep('m2', { tools: [readTool('t2', 'src/b.ts')] }),
    ];
    const withPlaceholder = buildExploreFlowRoles(
      [...established, assistantStep('m3', { status: 'streaming', tools: [] })],
      { streamActive: true },
    );
    const withoutPlaceholder = buildExploreFlowRoles(established, { streamActive: true });

    const liveAnchor = withPlaceholder.get('m1');
    expect(liveAnchor?.kind).toBe('anchor');
    if (liveAnchor?.kind !== 'anchor') return;
    expect(liveAnchor.group.isLive).toBe(true);
    expect(liveAnchor.group.toolCount).toBe(2);
    expect(withPlaceholder.get('m3')).toEqual({ kind: 'member', anchorMessageId: 'm1' });
    expect(
      exploreFlowRolesEqual(liveAnchor, withoutPlaceholder.get('m1') as ExploreFlowRole),
    ).toBe(true);
  });

  it('does not split a live run when the placeholder sits between explore steps', () => {
    const roles = buildExploreFlowRoles(
      [
        assistantStep('m1', { tools: [readTool('t1', 'src/a.ts')] }),
        assistantStep('gap', { status: 'streaming', tools: [] }),
        assistantStep('m2', { tools: [readTool('t2', 'src/b.ts')] }),
      ],
      { streamActive: true },
    );

    const anchor = roles.get('m1');
    expect(anchor?.kind).toBe('anchor');
    if (anchor?.kind !== 'anchor') return;
    expect(roles.get('m2')).toEqual({ kind: 'member', anchorMessageId: 'm1' });
    expect(anchor.group.toolCount).toBe(2);
    expect(anchor.group.isLive).toBe(true);
    expect(roles.get('gap')).toEqual({ kind: 'member', anchorMessageId: 'm1' });
  });

  it('joins the same live run after the placeholder gains a tool', () => {
    const roles = buildExploreFlowRoles(
      [
        assistantStep('m1', { tools: [readTool('t1', 'src/a.ts')] }),
        assistantStep('m2', { tools: [readTool('t2', 'src/b.ts')] }),
        assistantStep('m3', {
          status: 'streaming',
          tools: [readTool('t3', 'src/c.ts', 'running')],
        }),
      ],
      { streamActive: true },
    );

    const anchor = roles.get('m1');
    expect(anchor?.kind).toBe('anchor');
    if (anchor?.kind !== 'anchor') return;
    expect(roles.get('m3')).toEqual({ kind: 'member', anchorMessageId: 'm1' });
    expect(anchor.group.toolCount).toBe(3);
    expect(anchor.group.isLive).toBe(true);
    expect(anchor.group.items.map((item) => (item.kind === 'tool' ? item.tool.toolCallId : item.kind))).toEqual([
      't1',
      't2',
      't3',
    ]);
  });

  it('settles a running explore group when a user follow-up breaks the run', () => {
    const roles = buildExploreFlowRoles(
      [
        assistantStep('m1', { tools: [readTool('t1', 'src/a.ts')] }),
        assistantStep('m2', {
          status: 'streaming',
          tools: [readTool('t2', 'src/b.ts', 'running')],
        }),
        userMessage('u2'),
      ],
      { streamActive: true },
    );

    const anchor = roles.get('m1');
    expect(anchor?.kind).toBe('anchor');
    if (anchor?.kind !== 'anchor') return;
    expect(anchor.group.hasRunning).toBe(true);
    expect(anchor.group.isLive).toBe(false);
  });

  it('excludes error steps and messages with generation tools or citations', () => {
    const roles = buildExploreFlowRoles([
      assistantStep('m1', { tools: [readTool('t1', 'src/a.ts')] }),
      assistantStep('m2', { tools: [readTool('t2', 'src/b.ts')], status: 'error' }),
      assistantStep('m3', { tools: [readTool('t3', 'src/c.ts')] }),
    ]);
    // The error step splits the flow; each side has only one read.
    expect(roles.size).toBe(0);
  });
});

describe('exploreFlowRolesEqual', () => {
  it('compares member roles by anchor and anchor groups by item identity', () => {
    const messages = [
      assistantStep('m1', { tools: [readTool('t1', 'src/a.ts')] }),
      assistantStep('m2', { tools: [readTool('t2', 'src/b.ts')] }),
    ];
    const first = buildExploreFlowRoles(messages);
    const second = buildExploreFlowRoles(messages);
    expect(
      exploreFlowRolesEqual(first.get('m1') as ExploreFlowRole, second.get('m1') as ExploreFlowRole),
    ).toBe(true);
    expect(
      exploreFlowRolesEqual(first.get('m2') as ExploreFlowRole, second.get('m2') as ExploreFlowRole),
    ).toBe(true);

    const grown = buildExploreFlowRoles([
      ...messages,
      assistantStep('m3', { tools: [readTool('t3', 'src/c.ts')] }),
    ]);
    expect(
      exploreFlowRolesEqual(first.get('m1') as ExploreFlowRole, grown.get('m1') as ExploreFlowRole),
    ).toBe(false);
  });
});
