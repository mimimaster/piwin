import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type {
  ContextUsageSnapshot,
  HostPush,
  SessionSearchResult,
  SessionTranscriptMessage,
} from '@piwin/contracts';
import { HostRuntime } from './host-runtime.js';

describe('CE-CHAT session ops', () => {
  it('pins, searches, truncates, and emits usage in mock agent mode', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-chat-ops-'));
    const pushes: HostPush[] = [];
    const runtime = new HostRuntime({
      mode: 'sdk',
      mock: true,
      piwinRoot: rootDir,
      onPush: (message) => pushes.push(message),
    });

    const projectPath = join(rootDir, 'proj');
    await runtime.handleCommand({ type: 'project/open', path: projectPath });
    await runtime.handleCommand({ type: 'project/trust', path: projectPath });

    const created = await runtime.handleCommand({
      type: 'session/create',
      input: { projectPath, sessionName: 'demo-chat', executionMode: 'agent' },
    });
    expect(created.success).toBe(true);
    if (!created.success) throw new Error(created.error);
    const sessionId = (created.data as { sessionId: string }).sessionId;

    const prompt1 = await runtime.handleCommand({
      type: 'session/prompt',
      sessionId,
      input: { text: 'unique-widget-refactor-please' },
    });
    expect(prompt1.success).toBe(true);
    if (!prompt1.success) throw new Error(prompt1.error);
    const accepted = prompt1.data as { runId?: string; sessionId: string };
    expect(typeof accepted.runId).toBe('string');

    // Wait for background turn terminal (ADR 0015 prompt ack).
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const terminal = pushes.find(
        (push) =>
          push.type === 'event' &&
          push.event.type === 'run/terminal' &&
          push.event.sessionId === sessionId,
      );
      if (terminal) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    let listed = await runtime.handleCommand({ type: 'session/list', projectPath });
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (
        listed.success &&
        (listed.data as { sessions: Array<{ id: string }> }).sessions.some(
          (session) => session.id === sessionId,
        )
      ) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
      listed = await runtime.handleCommand({ type: 'session/list', projectPath });
    }

    const pin = await runtime.handleCommand({ type: 'session/pin', sessionId });
    expect(pin.success).toBe(true);

    listed = await runtime.handleCommand({ type: 'session/list', projectPath });
    expect(listed.success).toBe(true);
    if (!listed.success) throw new Error(listed.error);
    const sessions = (listed.data as { sessions: Array<{ id: string; isPinned?: boolean }> })
      .sessions;
    expect(sessions[0]?.id).toBe(sessionId);
    expect(sessions[0]?.isPinned).toBe(true);

    const search = await runtime.handleCommand({
      type: 'session/search',
      query: { query: 'unique-widget', projectPath },
    });
    expect(search.success).toBe(true);
    if (!search.success) throw new Error(search.error);
    const hits = (search.data as SessionSearchResult).hits;
    expect(hits.some((hit) => hit.sessionId === sessionId)).toBe(true);

    const messagesResp = await runtime.handleCommand({ type: 'session/messages', sessionId });
    expect(messagesResp.success).toBe(true);
    if (!messagesResp.success) throw new Error(messagesResp.error);
    const messages = (messagesResp.data as { messages: SessionTranscriptMessage[] }).messages;
    expect(messages.length).toBeGreaterThanOrEqual(2);
    const userMessage = messages.find((message) => message.role === 'user');
    expect(userMessage).toBeTruthy();

    const truncated = await runtime.handleCommand({
      type: 'session/truncate-from',
      sessionId,
      messageId: userMessage!.id,
    });
    expect(truncated.success).toBe(true);
    if (!truncated.success) throw new Error(truncated.error);
    const truncData = truncated.data as {
      remainingCount: number;
      messages: SessionTranscriptMessage[];
    };
    expect(truncData.remainingCount).toBe(0);
    expect(truncData.messages).toHaveLength(0);

    const usageEvents = pushes.filter(
      (push) =>
        push.type === 'event' &&
        push.event.type === 'usage/update',
    );
    expect(usageEvents.length).toBeGreaterThan(0);
    const usage = (usageEvents[0] as { event: { usage: ContextUsageSnapshot } }).event.usage;
    expect(usage.totalTokens ?? usage.tokensUsed).toBeTruthy();

    await runtime.dispose();
  });

  it('chat mode does not emit mock tool events', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-chat-mode-'));
    const pushes: HostPush[] = [];
    const runtime = new HostRuntime({
      mode: 'sdk',
      mock: true,
      piwinRoot: rootDir,
      onPush: (message) => pushes.push(message),
    });
    const projectPath = join(rootDir, 'proj');
    await runtime.handleCommand({ type: 'project/open', path: projectPath });
    await runtime.handleCommand({ type: 'project/trust', path: projectPath });
    const created = await runtime.handleCommand({
      type: 'session/create',
      input: { projectPath, executionMode: 'chat' },
    });
    if (!created.success) throw new Error(created.error);
    const sessionId = (created.data as { sessionId: string }).sessionId;
    await runtime.handleCommand({
      type: 'session/prompt',
      sessionId,
      input: { text: 'hello chat mode' },
    });
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const terminal = pushes.find(
        (push) =>
          push.type === 'event' &&
          push.event.type === 'run/terminal' &&
          push.event.sessionId === sessionId,
      );
      if (terminal) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const toolStarts = pushes.filter(
      (push) => push.type === 'event' && push.event.type === 'tool/start',
    );
    expect(toolStarts).toHaveLength(0);
    await runtime.dispose();
  });
});
