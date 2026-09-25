import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PromptInput, SessionHandle } from '@piwin/contracts';
import { COMPLETED_STOP_OUTCOME, USER_AUTHORED_GENERATION } from '@piwin/contracts';
import {
  createSessionRecord,
  openSessionTranscriptStore,
  upsertSessionRecord,
} from '@piwin/session';
import { getPiwinSessionIndexPath } from '../paths.js';
import { handleSessionLiveCommand } from './session-live-commands.js';
import { createPromptContext, createSilentSessionHandle } from './session-live-test-context.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function sessionWithPromptCapture(base: SessionHandle): {
  session: SessionHandle;
  received: PromptInput[];
} {
  const received: PromptInput[] = [];
  const session: SessionHandle = {
    ...base,
    async prompt(input) {
      received.push(input);
      return COMPLETED_STOP_OUTCOME;
    },
  };
  return { session, received };
}

describe('session/prompt lastPreview', () => {
  it('stores the user-visible prompt, not artifact host-theme/context injection', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-turn-preview-'));
    roots.push(rootDir);
    const { session, received } = sessionWithPromptCapture(createSilentSessionHandle());
    const { context } = createPromptContext(session);
    context.piwinRoot = rootDir;
    context.resolveIsConversationChat = async () => true;
    await upsertSessionRecord(
      getPiwinSessionIndexPath(rootDir),
      createSessionRecord({
        id: session.id,
        projectPath: rootDir,
        scope: { kind: 'general' },
        name: 'preview-clean',
      }),
    );
    const previews: string[] = [];
    context.touchSession = async (_sessionId, previewText) => {
      previews.push(previewText);
    };

    const response = await handleSessionLiveCommand(
      {
        type: 'session/prompt',
        sessionId: session.id,
        input: {
          text: 'Fix the login bug',
          inlineArtifactWidthPx: 680,
          artifactHostTheme: 'dark',
        },
      },
      undefined,
      context,
    );
    expect(response).toMatchObject({ success: true });
    await vi.waitFor(() => expect(context.getForegroundRun(session.id)).toBeUndefined());
    expect(received).toHaveLength(1);
    expect(received[0]?.text).toContain('[piwin-artifact-host-theme]');
    expect(received[0]?.text).toContain('[piwin-inline-artifact-layout]');
    expect(received[0]?.text).toContain('Fix the login bug');
    expect(previews).toEqual(['Fix the login bug']);
    expect(previews[0]).not.toContain('[piwin-');
  });

  it('keeps a non-empty preview when retry reuses the stored user row with empty command text', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-turn-preview-retry-'));
    roots.push(rootDir);
    const { session } = sessionWithPromptCapture(createSilentSessionHandle());
    const { context } = createPromptContext(session);
    context.piwinRoot = rootDir;
    const store = await openSessionTranscriptStore({
      dbPath: join(rootDir, 'transcript.sqlite3'),
      sessionId: session.id,
      projectPath: '/tmp/project',
    });
    const appended = await store.appendMessage({
      id: 'user-retry',
      runtimeGenerationId: USER_AUTHORED_GENERATION,
      backendMessageId: 'user-retry',
      role: 'user',
      text: 'same question as before',
      status: 'done',
      createdAt: '2026-08-27T00:00:00.000Z',
    });
    expect(appended.ok).toBe(true);
    const assistant = await store.appendMessage({
      id: 'assistant-retry',
      runtimeGenerationId: 'gen-a',
      backendMessageId: 'assistant-retry',
      role: 'assistant',
      text: 'first answer',
      status: 'done',
      createdAt: '2026-08-27T00:00:01.000Z',
    });
    expect(assistant.ok).toBe(true);
    context.getTranscriptStore = async () => store;
    context.disposeLiveSession = async () => undefined;
    const previews: string[] = [];
    context.touchSession = async (_sessionId, previewText) => {
      previews.push(previewText);
    };

    const response = await handleSessionLiveCommand(
      {
        type: 'session/prompt',
        sessionId: session.id,
        input: { text: '', retryUserMessageId: 'user-retry', keepPreviousAttempt: true },
      },
      undefined,
      context,
    );
    expect(response).toMatchObject({ success: true });
    await vi.waitFor(() => expect(context.getForegroundRun(session.id)).toBeUndefined());
    expect(previews).toEqual(['same question as before']);
    expect(previews[0]?.length).toBeGreaterThan(0);
    store.close();
  });
});
