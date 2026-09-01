import { describe, expect, it } from 'vitest';
import {
  chatUiReducer,
  createInitialChatUiState,
  mapTranscriptMessagesToUi,
} from './chat-reducer';

describe('chatUiReducer session and context', () => {
  it('keeps explicit Skill provenance on the active prompt until the run ends', () => {
    let state = chatUiReducer(createInitialChatUiState(), {
      type: 'session/set',
      sessionId: 'skill-session',
    });
    state = chatUiReducer(state, {
      type: 'user/send',
      text: '/writing-plans add auth',
      skill: { skillId: 'writing-plans', name: 'writing-plans' },
    });
    expect(state.activeSkill).toEqual({ skillId: 'writing-plans', name: 'writing-plans' });

    state = chatUiReducer(state, { type: 'error', message: 'skill failed' });
    expect(state.activeSkill).toBeNull();
  });

  it('clears the prior project transcript while loading another project', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, {
      type: 'session/add',
      sessionId: 'prior-session',
      name: 'Prior project chat',
    });
    state = chatUiReducer(state, {
      type: 'user/send',
      text: 'This belongs to the prior project',
    });

    state = chatUiReducer(state, {
      type: 'project/set',
      path: '/tmp/another-project',
      trusted: false,
    });

    expect(state.sessions).toEqual([]);
    expect(state.activeSessionId).toBeNull();
    expect(state.messages).toEqual([]);
    expect(state.streaming).toBe(false);
  });

  it('keeps a newer permission prompt when an earlier request resolves', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, {
      type: 'permission/show',
      prompt: {
        requestId: 'mcp-connect-first',
        sessionId: 'session-1',
        action: 'mcp:tool-call',
        detail: 'first-server/tool',
        defaultDecision: 'ask',
      },
    });
    state = chatUiReducer(state, {
      type: 'permission/show',
      prompt: {
        requestId: 'mcp-connect-second',
        sessionId: 'session-1',
        action: 'mcp:tool-call',
        detail: 'second-server/tool',
        defaultDecision: 'ask',
      },
    });

    state = chatUiReducer(state, {
      type: 'permission/clear',
      requestId: 'mcp-connect-first',
    });

    expect(state.permissionPrompt?.requestId).toBe('mcp-connect-second');
  });

  it('clears the permission prompt when the host settles the request', () => {
    let state = createInitialChatUiState();
    state = { ...state, activeSessionId: 'session-1' };
    state = chatUiReducer(state, {
      type: 'permission/show',
      prompt: {
        requestId: 'mcp-connect-first',
        sessionId: 'session-1',
        action: 'mcp:tool-call',
        detail: 'first-server/tool',
        defaultDecision: 'ask',
      },
    });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 'session-1',
      event: {
        type: 'permission/resolved',
        requestId: 'mcp-connect-first',
        decision: 'deny',
      },
    });
    expect(state.permissionPrompt).toBeNull();
  });

  it('hydrates history from session/load-messages including attachments', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, {
      type: 'session/load-messages',
      sessionId: 's1',
      messages: [
        {
          id: 'u1',
          role: 'user',
          text: 'with image',
          createdAt: new Date().toISOString(),
          status: 'done',
          attachments: [
            {
              id: 'a1',
              kind: 'media',
              path: '/tmp/.piwin/media/s/a.png',
              mimeType: 'image/png',
              byteSize: 10,
              source: 'paste',
            },
          ],
        },
        {
          id: 'a2',
          role: 'assistant',
          text: 'seen',
          createdAt: new Date().toISOString(),
          status: 'done',
        },
      ],
    });
    expect(state.activeSessionId).toBe('s1');
    expect(state.messages).toHaveLength(2);
    const firstAttachment = state.messages[0]?.attachments[0];
    expect(
      firstAttachment && firstAttachment.kind === 'media' ? firstAttachment.path : '',
    ).toContain('a.png');
    expect(state.messages[1]?.text).toBe('seen');
  });

  it('restores a paused checkpoint from session/load-messages', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, {
      type: 'session/load-messages',
      sessionId: 's1',
      messages: [],
      pauseCheckpoint: {
        checkpointId: 'ckpt-1',
        sessionId: 's1',
        sourceRunId: 'run-paused',
        createdAt: new Date().toISOString(),
        transcriptRevision: 1,
        status: 'active',
      },
    });
    expect(state.runTerminal).toMatchObject({
      kind: 'paused',
      checkpointId: 'ckpt-1',
    });
    expect(state.lastTerminalRunId).toBe('run-paused');
  });

  it('projects legacy mode wrappers to the user-facing body on hydrate', () => {
    const wrappedUserText = [
      '[piwin-mode:agent]',
      '[piwin-prompt-meta kind="mode:agent" version="2" applies="every-turn"]',
      'Operating contract for this turn:',
      "Success: satisfy the user's stated goal with the smallest correct change.",
      '',
      '---',
      'User:',
      '排查刻度条间距',
    ].join('\n');

    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, {
      type: 'session/load-messages',
      sessionId: 's1',
      messages: [
        {
          id: 'u1',
          role: 'user',
          text: wrappedUserText,
          createdAt: new Date().toISOString(),
          status: 'done',
          attachments: [
            {
              id: 'a1',
              kind: 'media',
              path: '/tmp/.piwin/media/s/shot.png',
              mimeType: 'image/png',
              byteSize: 42,
              source: 'paste',
            },
          ],
        },
        {
          id: 'a2',
          role: 'assistant',
          text: 'ok',
          createdAt: new Date().toISOString(),
          status: 'done',
        },
      ],
    });

    expect(state.messages[0]?.text).toBe('排查刻度条间距');
    expect(state.messages[0]?.text).not.toContain('piwin-mode');
    expect(state.messages[0]?.text).not.toContain('Operating contract');
    const media = state.messages[0]?.attachments[0];
    expect(media && media.kind === 'media' ? media.path : '').toContain('shot.png');
    expect(state.messages[1]?.text).toBe('ok');
  });

  it('mapTranscriptMessagesToUi preserves voice-delegation source on user rows', () => {
    const [userMessage] = mapTranscriptMessagesToUi([
      {
        id: 'u-voice',
        role: 'user',
        text: 'open the file',
        createdAt: '2026-08-28T00:00:00.000Z',
        status: 'done',
        source: 'voice-delegation',
        voiceCallId: 'live_1',
      },
    ]);
    expect(userMessage?.source).toBe('voice-delegation');
    expect(userMessage?.voiceCallId).toBe('live_1');
  });

  it('mapTranscriptMessagesToUi does not throw when a user row is missing text', () => {
    const [userMessage] = mapTranscriptMessagesToUi([
      {
        id: 'u-missing-text',
        role: 'user',
        createdAt: '2026-08-23T00:00:00.000Z',
        status: 'done',
      } as import('@piwin/contracts').SessionTranscriptMessage,
    ]);
    expect(userMessage?.text).toBe('');
  });

  it('mapTranscriptMessagesToUi keeps assistant text raw and strips user wrappers', () => {
    const [userMessage, assistantMessage] = mapTranscriptMessagesToUi([
      {
        id: 'u1',
        role: 'user',
        text: '[piwin-mode:agent]\nOperating contract\n\n---\nUser:\nhello',
        createdAt: '2026-08-07T00:00:00.000Z',
        status: 'done',
      },
      {
        id: 'a1',
        role: 'assistant',
        text: 'raw assistant reply with [piwin-mode:agent] mention',
        createdAt: '2026-08-07T00:00:01.000Z',
        status: 'done',
      },
    ]);
    expect(userMessage?.text).toBe('hello');
    expect(assistantMessage?.text).toBe('raw assistant reply with [piwin-mode:agent] mention');
  });

  it('hydrates persisted reasoning boundaries for a fixed thought duration', () => {
    const [assistantMessage] = mapTranscriptMessagesToUi([
      {
        id: 'a-thinking',
        role: 'assistant',
        text: 'answer',
        thinking: 'reasoning',
        createdAt: '2026-08-12T08:00:00.000Z',
        status: 'done',
        thinkingStartedAt: '2026-08-12T08:00:01.000Z',
        thinkingEndedAt: '2026-08-12T08:00:05.000Z',
      },
    ]);

    expect(assistantMessage).toMatchObject({
      thinkingStartedAt: Date.parse('2026-08-12T08:00:01.000Z'),
      thinkingEndedAt: Date.parse('2026-08-12T08:00:05.000Z'),
    });
  });

  it('bounds both canonical and structured tool output during transcript hydrate', () => {
    const largeOutput = 'x'.repeat(10 * 1024 * 1024);
    const [assistantMessage] = mapTranscriptMessagesToUi([
      {
        id: 'a-large-tool',
        role: 'assistant',
        text: 'done',
        createdAt: '2026-08-07T00:00:01.000Z',
        status: 'done',
        tools: [
          {
            toolCallId: 'tool-large',
            toolName: 'large-output',
            status: 'done',
            output: largeOutput,
            presentation: {
              kind: 'other',
              title: 'Large output',
              output: { text: largeOutput },
            },
          },
        ],
      },
    ]);

    const tool = assistantMessage?.tools[0];
    expect(new TextEncoder().encode(tool?.output ?? '').byteLength).toBeLessThanOrEqual(256 * 1024);
    expect(tool?.presentation?.output?.text).toBe(tool?.output);
    expect(tool?.presentation?.output?.truncated).toBe(true);
  });

  it('MSG-001: mapTranscriptMessagesToUi preserves model snapshot on assistant messages and handles legacy rows without model', () => {
    const [assistantWithModel, legacyAssistant] = mapTranscriptMessagesToUi([
      {
        id: 'a-model',
        role: 'assistant',
        text: 'hello from model',
        createdAt: '2026-08-18T00:00:01.000Z',
        status: 'done',
        model: {
          protocol: 'anthropic-compatible',
          providerId: 'anthropic',
          modelId: 'claude-sonnet-4',
        },
      },
      {
        id: 'a-legacy',
        role: 'assistant',
        text: 'hello from legacy',
        createdAt: '2026-08-18T00:00:02.000Z',
        status: 'done',
      },
    ]);

    expect(assistantWithModel?.model).toEqual({
      protocol: 'anthropic-compatible',
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4',
    });
    expect(legacyAssistant?.model).toBeUndefined();
  });

  it('maps reply-writer attribution and applies live rewrite status', () => {
    const [assistant] = mapTranscriptMessagesToUi([
      {
        id: 'a-writer',
        role: 'assistant',
        text: '登录路径已经改好了。',
        createdAt: '2026-08-20T00:00:01.000Z',
        status: 'done',
        replyWriter: {
          language: 'zh-CN',
          sourceText: '登录 路径 已改',
          model: { protocol: 'openai-compatible', providerId: 'openai', modelId: 'gpt-4.1' },
        },
      },
    ]);
    expect(assistant?.replyWriter).toEqual({
      language: 'zh-CN',
      model: { protocol: 'openai-compatible', providerId: 'openai', modelId: 'gpt-4.1' },
    });

    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: { type: 'message/start', messageId: 'a1', role: 'assistant', runId: 'r1' },
    });
    state = chatUiReducer(state, {
      type: 'reply-writer/updated',
      sessionId: 's1',
      messageId: 'a1',
      status: 'started',
    });
    expect(state.messages[0]?.replyWriterPending).toBe(true);
    state = chatUiReducer(state, {
      type: 'reply-writer/updated',
      sessionId: 's1',
      messageId: 'a1',
      status: 'applied',
      language: 'zh-CN',
      model: { protocol: 'openai-compatible', providerId: 'openai', modelId: 'gpt-4.1' },
    });
    expect(state.messages[0]?.replyWriterPending).toBe(false);
    expect(state.messages[0]?.replyWriter?.model.modelId).toBe('gpt-4.1');
  });

  it('tracks compaction banner state', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: { type: 'compaction/start' },
    });
    expect(state.compacting).toBe(true);
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: { type: 'compaction/end', ok: true, message: 'done' },
    });
    expect(state.compacting).toBe(false);
    expect(state.lastCompactionMessage).toBe('done');
  });

  it('stores compaction detail fields without inventing tokens', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: {
        type: 'compaction/end',
        ok: true,
        message: 'done',
        summary: 'kept recent tools',
        tokensBefore: 1000,
        tokensAfter: 400,
        durationMs: 42,
      },
    });
    expect(state.lastCompactionMessage).toBe('done');
    expect(state.lastCompactionSummary).toBe('kept recent tools');
    expect(state.lastCompactionTokensBefore).toBe(1000);
    expect(state.lastCompactionTokensAfter).toBe(400);
    expect(state.lastCompactionDurationMs).toBe(42);
    state = chatUiReducer(state, { type: 'compaction/dismiss' });
    expect(state.lastCompactionMessage).toBeNull();
    expect(state.lastCompactionSummary).toBeNull();
  });

  it('updates measured context occupancy after a successful compaction', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: {
        type: 'usage/update',
        sessionId: 's1',
        usage: {
          sessionId: 's1',
          tokensUsed: 900_000,
          tokensLimit: 1_000_000,
          updatedAt: new Date(0).toISOString(),
          source: 'pi-contextUsage',
        },
      },
    });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: { type: 'compaction/end', ok: true, tokensAfter: 120_000 },
    });

    expect(state.contextUsage).toMatchObject({
      tokensUsed: 120_000,
      totalTokens: 120_000,
      contextRatio: 0.12,
      source: 'pi-contextUsage',
    });
  });

  it('stores usage/update on contextUsage', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: {
        type: 'usage/update',
        sessionId: 's1',
        usage: {
          sessionId: 's1',
          totalTokens: 42,
          tokensLimit: 128000,
          updatedAt: '2026-07-21T00:00:00.000Z',
          source: 'host-estimate',
        },
      },
    });
    expect(state.contextUsage?.totalTokens).toBe(42);
  });

  it('stores leftover usage/update on contextUsage without occupancy gating', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: {
        type: 'usage/update',
        sessionId: 's1',
        usage: {
          sessionId: 's1',
          totalTokens: 300_726,
          cacheReadTokens: 294_656,
          updatedAt: '2026-08-09T09:47:07.479Z',
          source: 'assistant-usage',
        },
      },
    });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: {
        type: 'usage/update',
        sessionId: 's1',
        usage: {
          sessionId: 's1',
          totalTokens: 409,
          updatedAt: '2026-08-09T09:47:07.485Z',
          source: 'host-estimate',
        },
      },
    });
    expect(state.contextUsage?.totalTokens).toBe(409);
  });

  it('hydrates context usage with resumed messages and clears it when switching sessions', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, {
      type: 'session/load-messages',
      sessionId: 's1',
      messages: [],
      contextUsage: {
        sessionId: 's1',
        totalTokens: 505_510,
        cacheReadTokens: 503_680,
        updatedAt: '2026-08-09T11:24:22.004Z',
        source: 'assistant-usage',
      },
    });
    expect(state.contextUsage?.totalTokens).toBe(505_510);

    state = chatUiReducer(state, {
      type: 'session/set',
      sessionId: 's2',
      awaitTranscript: true,
    });
    expect(state.contextUsage).toBeNull();
  });

  it('ignores stream and usage events from an inactive session', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 'visible-session' });

    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 'background-subagent',
      event: { type: 'message/start', messageId: 'background-message', role: 'assistant' },
    });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 'background-subagent',
      event: {
        type: 'usage/update',
        sessionId: 'background-subagent',
        usage: {
          sessionId: 'background-subagent',
          totalTokens: 999,
          updatedAt: '2026-07-21T00:00:00.000Z',
          source: 'host-estimate',
        },
      },
    });

    expect(state.messages).toEqual([]);
    expect(state.contextUsage).toBeNull();
  });

  it('session/branch-switched replaces active transcript', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, {
      type: 'session/load-messages',
      sessionId: 's1',
      messages: [
        {
          id: 'u1',
          role: 'user',
          text: 'one',
          createdAt: '2026-07-21T00:00:00.000Z',
          status: 'done',
        },
        {
          id: 'a1',
          role: 'assistant',
          text: 'two',
          createdAt: '2026-07-21T00:00:01.000Z',
          status: 'done',
        },
      ],
    });
    state = chatUiReducer(state, {
      type: 'session/branch-switched',
      sessionId: 's1',
      messages: [
        {
          id: 'u1',
          role: 'user',
          text: 'one',
          createdAt: '2026-07-21T00:00:00.000Z',
          status: 'done',
        },
      ],
    });
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]?.id).toBe('u1');
  });

  it('clears the working marker when switching conversation branches', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, { type: 'user/send', text: 'one' });
    state = chatUiReducer(state, { type: 'run/accepted', runId: 'run-1' });
    expect(state.workingSessionIds).toEqual({ s1: true });

    state = chatUiReducer(state, {
      type: 'session/branch-switched',
      sessionId: 's1',
      messages: [
        {
          id: 'u1',
          role: 'user',
          text: 'one',
          createdAt: '2026-07-21T00:00:00.000Z',
          status: 'done',
        },
      ],
    });

    expect(state.workingSessionIds).toEqual({});
    expect(state.streaming).toBe(false);
    expect(state.runPhase).toBe('idle');
  });

  it('session/branch-switched clips the target and later rows in place', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, {
      type: 'session/load-messages',
      sessionId: 's1',
      messages: [
        {
          id: 'u1',
          role: 'user',
          text: 'one',
          createdAt: '2026-07-21T00:00:00.000Z',
          status: 'done',
        },
        {
          id: 'a1',
          role: 'assistant',
          text: 'two',
          createdAt: '2026-07-21T00:00:01.000Z',
          status: 'done',
        },
        {
          id: 'u2',
          role: 'user',
          text: 'three',
          createdAt: '2026-07-21T00:00:02.000Z',
          status: 'done',
        },
      ],
    });
    state = chatUiReducer(state, {
      type: 'session/branch-switched',
      sessionId: 's1',
      clipBeforeMessageId: 'u2',
    });
    expect(state.messages.map((message) => message.id)).toEqual(['u1', 'a1']);
  });

  it('session/branch-switched clips after the target, keeping that row', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, {
      type: 'session/load-messages',
      sessionId: 's1',
      messages: [
        {
          id: 'u1',
          role: 'user',
          text: 'one',
          createdAt: '2026-07-21T00:00:00.000Z',
          status: 'done',
        },
        {
          id: 'a1',
          role: 'assistant',
          text: 'two',
          createdAt: '2026-07-21T00:00:01.000Z',
          status: 'done',
        },
      ],
    });
    state = chatUiReducer(state, {
      type: 'session/branch-switched',
      sessionId: 's1',
      clipAfterMessageId: 'u1',
    });
    expect(state.messages.map((message) => message.id)).toEqual(['u1']);
  });
});
