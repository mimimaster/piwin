import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi, afterEach } from 'vitest';
import type {
  ContextUsageSnapshot,
  HostPush,
  SessionSearchResult,
  SessionTranscriptMessage,
} from '@piwin/contracts';
import { createDefaultWalkthroughConfig } from '@piwin/contracts';
import { getSessionRecord } from '@piwin/session';
import { HostRuntime } from './host-runtime.js';
import { savePiwinConfig } from './config-store.js';
import { getPiwinSessionIndexPath } from './paths.js';

/** Wait for a new top-level Run terminal push for the session after `fromIndex`. */
async function waitForTerminal(
  pushes: HostPush[],
  sessionId: string,
  fromIndex: number,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const terminal = pushes
      .slice(fromIndex)
      .find(
        (push) =>
          push.type === 'run/terminal' &&
          push.run.sessionId === sessionId,
      );
    if (terminal) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for Run terminal for ${sessionId}`);
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.PIWIN_TEST_LLM_KEY;
});

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
      input: { projectPath, sessionName: 'demo-chat' },
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
          push.type === 'run/terminal' &&
          push.run.sessionId === sessionId,
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
      (push) => push.type === 'event' && push.event.type === 'usage/update',
    );
    expect(usageEvents.length).toBeGreaterThan(0);
    const usage = (usageEvents[0] as { event: { usage: ContextUsageSnapshot } }).event.usage;
    expect(usage.totalTokens ?? usage.tokensUsed).toBeTruthy();

    await runtime.dispose();
  });

  it('rebuilds a fresh shell after truncate so a revert resend does not duplicate history', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-truncate-rebuild-'));
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
      input: { projectPath, sessionName: 'revert-demo' },
    });
    expect(created.success).toBe(true);
    if (!created.success) throw new Error(created.error);
    const sessionId = (created.data as { sessionId: string }).sessionId;

    const prompt1 = await runtime.handleCommand({
      type: 'session/prompt',
      sessionId,
      input: { text: 'old-message-to-be-reverted' },
    });
    expect(prompt1.success).toBe(true);
    if (!prompt1.success) throw new Error(prompt1.error);
    await waitForTerminal(pushes, sessionId, 0);

    const messagesBefore = await runtime.handleCommand({ type: 'session/messages', sessionId });
    if (!messagesBefore.success) throw new Error(messagesBefore.error);
    const before = (messagesBefore.data as { messages: SessionTranscriptMessage[] }).messages;
    const firstUser = before.find((message) => message.role === 'user');
    expect(firstUser).toBeTruthy();
    const beforeUserCount = before.filter((message) => message.role === 'user').length;

    // Revert: truncate at the first user message, then resend the edited text.
    const truncated = await runtime.handleCommand({
      type: 'session/truncate-from',
      sessionId,
      messageId: firstUser!.id,
    });
    expect(truncated.success).toBe(true);
    if (!truncated.success) throw new Error(truncated.error);

    // Before the dropSession fix this prompt failed with "Unknown session"
    // because truncate-from removed the session from the host map but the
    // stale adapter shell was reused (or no shell existed for requireSession).
    const prompt2 = await runtime.handleCommand({
      type: 'session/prompt',
      sessionId,
      input: { text: 'edited-message-after-revert' },
    });
    expect(prompt2.success).toBe(true);
    if (!prompt2.success) throw new Error(prompt2.error);
    await waitForTerminal(pushes, sessionId, pushes.length);

    const messagesAfter = await runtime.handleCommand({ type: 'session/messages', sessionId });
    expect(messagesAfter.success).toBe(true);
    if (!messagesAfter.success) throw new Error(messagesAfter.error);
    const after = (messagesAfter.data as { messages: SessionTranscriptMessage[] }).messages;
    const afterUserCount = after.filter((message) => message.role === 'user').length;
    // The reverted (edited) message replaces the pre-truncation turn instead of
    // duplicating it: one user turn, not the original + edited copy.
    expect(afterUserCount).toBe(1);
    expect(after.map((message) => message.text)).toContain('edited-message-after-revert');
    expect(after.map((message) => message.text)).not.toContain('old-message-to-be-reverted');
    // Regression guard: the user message count must not have grown.
    expect(afterUserCount).toBeLessThanOrEqual(beforeUserCount);

    await runtime.dispose();
  });

  it('auto-names a session after the first completed exchange and retries until success', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-auto-name-trigger-'));
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
      input: { projectPath },
    });
    if (!created.success) throw new Error(created.error);
    const sessionId = (created.data as { sessionId: string }).sessionId;

    // First exchange: the session must be named (text fallback) after one prompt.
    const prompt1 = await runtime.handleCommand({
      type: 'session/prompt',
      sessionId,
      input: { text: 'Refactor the auth module' },
    });
    expect(prompt1.success).toBe(true);
    if (!prompt1.success) throw new Error(prompt1.error);
    await waitForTerminal(pushes, sessionId, 0);

    // Auto-naming is fire-and-forget; wait for it to finish.
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const found = pushes.find(
        (push) => push.type === 'session/name-updated' && push.sessionId === sessionId,
      );
      if (found) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const nameUpdated = pushes.find(
      (push) => push.type === 'session/name-updated' && push.sessionId === sessionId,
    );
    expect(nameUpdated).toBeTruthy();
    if (nameUpdated && nameUpdated.type === 'session/name-updated') {
      expect(nameUpdated.nameSource).toBe('text');
      expect(nameUpdated.name.length).toBeGreaterThan(0);
    }
    const indexPath = getPiwinSessionIndexPath(rootDir);
    const record = await getSessionRecord(indexPath, sessionId);
    expect(record?.nameSource).toBe('text');
    expect(record?.name?.length).toBeGreaterThan(0);

    // A user-set name must never be overwritten by a later exchange.
    const renamed = await runtime.handleCommand({
      type: 'session/rename',
      sessionId,
      name: 'my manual name',
    });
    expect(renamed.success).toBe(true);
    const prompt2 = await runtime.handleCommand({
      type: 'session/prompt',
      sessionId,
      input: { text: 'another message' },
    });
    expect(prompt2.success).toBe(true);
    if (!prompt2.success) throw new Error(prompt2.error);
    await waitForTerminal(pushes, sessionId, pushes.length);
    const recordAfter = await getSessionRecord(indexPath, sessionId);
    expect(recordAfter?.name).toBe('my manual name');
    expect(recordAfter?.nameSource).toBe('user');

    await runtime.dispose();
  });

  it('passes the assistant reply to the LLM title generator', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-auto-name-llm-'));
    const pushes: HostPush[] = [];
    process.env.PIWIN_TEST_LLM_KEY = 'sk-test';
    await savePiwinConfig(
      {
        hostMode: 'sdk',
        agentMock: true,
        providers: [
          {
            id: 'llm-title',
            protocol: 'openai-compatible',
            name: 'LLM Title',
            baseUrl: 'https://llm-title.example/v1',
            apiKeyEnv: 'PIWIN_TEST_LLM_KEY',
            enabled: true,
            models: [{ id: 'title-model' }],
          },
        ],
        media: {
          maxPasteBytes: 10 * 1024 * 1024,
          allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
        },
        artifact: { enabled: true, triggerMode: 'automatic', decisionPrompt: { mode: 'default', customPrompt: '' }, maxBytes: 100 * 1024 },
        walkthrough: {
          ...createDefaultWalkthroughConfig(),
          autoGenerate: false,
        },
      },
      rootDir,
    );
    const requestBodies: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        requestBodies.push(init?.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({ choices: [{ message: { content: 'Model title' } }] }),
        } as unknown as Response;
      }),
    );
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
      input: { projectPath },
    });
    if (!created.success) throw new Error(created.error);
    const sessionId = (created.data as { sessionId: string }).sessionId;

    await runtime.handleCommand({
      type: 'session/prompt',
      sessionId,
      input: {
        text: 'Refactor the auth module',
        model: {
          protocol: 'openai-compatible',
          providerId: 'llm-title',
          modelId: 'title-model',
        },
      },
    });
    await waitForTerminal(pushes, sessionId, 0);

    // Wait for the LLM title generator (not just interim text naming on send).
    // Interim text name also emits session/name-updated with nameSource "text".
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const llmNamed = pushes.find(
        (push) =>
          push.type === 'session/name-updated' &&
          push.sessionId === sessionId &&
          push.nameSource === 'llm',
      );
      if (llmNamed || requestBodies.length > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    // The host must include the mock assistant reply as context for the title.
    expect(requestBodies.length).toBeGreaterThan(0);
    const lastBody = requestBodies[requestBodies.length - 1];
    const bodyString = typeof lastBody === 'string' ? lastBody : JSON.stringify(lastBody);
    expect(bodyString).toContain('Assistant:');
    expect(bodyString).toContain('piwin mock host reply');

    await runtime.dispose();
  });
});
