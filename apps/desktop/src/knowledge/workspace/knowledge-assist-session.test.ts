import { describe, expect, it } from 'vitest';
import type { HostPush, SessionResumeData, SessionTranscriptMessage } from '@piwin/contracts';
import { MockHostBackend } from '../../host/host-client-mock.js';
import {
  applyAssistPush,
  buildKnowledgeAssistCreateInput,
  buildKnowledgeAssistPromptInput,
  buildKnowledgeAssistWikiWriteInput,
  defaultKnowledgeAssistPrompt,
  emptyKnowledgeAssistState,
  messagesFromResume,
} from './knowledge-assist-session.js';

function userMessage(id: string, text: string): SessionTranscriptMessage {
  return {
    id,
    role: 'user',
    text,
    createdAt: '2026-01-01T00:00:00.000Z',
    status: 'done',
  };
}

describe('knowledge-assist-session', () => {
  it('creates an independent Host session (no parent, no main history)', () => {
    const input = buildKnowledgeAssistCreateInput({
      projectPath: '/tmp/project',
      baseId: 'base-1',
      title: 'sleep-debt.md',
      locale: 'zh-CN',
    });
    expect(input.parentSessionId).toBeUndefined();
    expect(input.sessionName).toBe('助读 · sleep-debt.md');
    expect(input.knowledgeBaseIds).toEqual(['base-1']);
    expect(input.scope).toEqual({ kind: 'project', projectPath: '/tmp/project' });
  });

  it('sends only the knowledge selection as context', () => {
    const prompt = buildKnowledgeAssistPromptInput({
      text: defaultKnowledgeAssistPrompt('en'),
      contextRef: {
        kind: 'knowledge-selection',
        baseId: 'base-1',
        scope: 'selection',
        relativePath: 'notes/sleep-debt.md',
        lineStart: 3,
        snapshotText: 'Sleep debt',
        label: 'sleep-debt.md · 3',
      },
    });
    expect(prompt.text).toBe('Explain this passage');
    expect(prompt.contextRefs).toHaveLength(1);
    expect(prompt.contextRefs?.[0]?.kind).toBe('knowledge-selection');
  });

  it('turns the asked range into wiki source metadata', () => {
    const write = buildKnowledgeAssistWikiWriteInput({
      documentTitle: 'sleep-debt.md',
      answer: 'Debt is hours owed to sleep.',
      contextRef: {
        kind: 'knowledge-selection',
        baseId: 'base-1',
        scope: 'selection',
        relativePath: 'notes/sleep-debt.md',
        lineStart: 3,
        lineEnd: 8,
        snapshotText: 'Sleep debt',
        label: 'sleep-debt.md · 3–8',
      },
    });
    expect(write.title).toBe('sleep-debt.md');
    expect(write.content).toContain('hours owed');
    expect(write.sources).toEqual([
      {
        baseId: 'base-1',
        relativePath: 'notes/sleep-debt.md',
        lineStart: 3,
        lineEnd: 8,
        snapshotText: 'Sleep debt',
      },
    ]);
  });

  it('resume of an empty assist session does not invent main-session rows', () => {
    expect(messagesFromResume([])).toEqual([]);
    expect(messagesFromResume([userMessage('main-1', 'hello from main')])).toEqual([
      { id: 'main-1', role: 'user', text: 'hello from main' },
    ]);
  });

  it('streams assistant text and clears running on abort', () => {
    let state = emptyKnowledgeAssistState();
    const start: HostPush = {
      type: 'event',
      sessionId: 'assist-1',
      event: {
        type: 'message/start',
        messageId: 'a1',
        role: 'assistant',
        runId: 'run-1',
      },
    };
    const delta: HostPush = {
      type: 'event',
      sessionId: 'assist-1',
      event: { type: 'message/text_delta', messageId: 'a1', delta: 'Hello', runId: 'run-1' },
    };
    const abort: HostPush = {
      type: 'event',
      sessionId: 'assist-1',
      event: { type: 'session/aborted', sessionId: 'assist-1', runId: 'run-1' },
    };
    state = applyAssistPush(state, start, 'assist-1');
    state = applyAssistPush(state, delta, 'assist-1');
    expect(state.running).toBe(true);
    expect(state.messages[0]?.text).toBe('Hello');
    state = applyAssistPush(state, abort, 'assist-1');
    expect(state.running).toBe(false);
    expect(state.messages[0]?.text).toBe('Hello');
  });

  it('mock Host: a new assist session does not inherit the main transcript', async () => {
    const backend = new MockHostBackend(
      () => {},
      () => 'sdk',
    );
    const main = await backend.handle(
      { type: 'session/create', input: { scope: { kind: 'general' } } },
      'main-create',
    );
    if (!main.success) throw new Error(main.error);
    const mainId = (main.data as { sessionId: string }).sessionId;
    const prompted = await backend.handle(
      { type: 'session/prompt', sessionId: mainId, input: { text: 'hello from main' } },
      'main-prompt',
    );
    if (!prompted.success) throw new Error(prompted.error);
    const assist = await backend.handle(
      {
        type: 'session/create',
        input: buildKnowledgeAssistCreateInput({
          baseId: 'base-1',
          title: 'sleep-debt.md',
          locale: 'en',
        }),
      },
      'assist-create',
    );
    if (!assist.success) throw new Error(assist.error);
    const assistId = (assist.data as { sessionId: string }).sessionId;
    expect(assistId).not.toBe(mainId);
    const resumed = await backend.handle(
      { type: 'session/resume', sessionId: assistId },
      'assist-resume',
    );
    if (!resumed.success) throw new Error(resumed.error);
    const messages = (resumed.data as SessionResumeData).messages;
    expect(messages.some((message) => message.text.includes('hello from main'))).toBe(false);
  });

  it('ignores pushes for another session', () => {
    const start: HostPush = {
      type: 'event',
      sessionId: 'main',
      event: { type: 'message/start', messageId: 'm1', role: 'assistant' },
    };
    const state = applyAssistPush(emptyKnowledgeAssistState(), start, 'assist-1');
    expect(state.messages).toEqual([]);
    expect(state.running).toBe(false);
  });
});
