import { mkdir, mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  SessionCompactResult,
  SessionHandoffData,
  SessionIndexDocument,
} from '@piwin/contracts';
import { updateSessionRecord } from '@piwin/session';
import * as handoffStore from '../session-handoff-store.js';
import { HostRuntime } from '../host-runtime.js';
import { getPiwinSessionIndexPath } from '../paths.js';
import {
  MAX_HANDOFF_SUMMARY_CHARS,
  getSessionHandoffPath,
  writeSessionHandoffSummary,
} from '../session-handoff-store.js';
import { createResolveRefsDeps } from './prompt-preparation.js';
import type { SessionLiveContext } from './session-live-context.js';
import { buildHandoffSessionName } from './session-handoff.js';

async function createSession(runtime: HostRuntime, projectPath: string): Promise<string> {
  const created = await runtime.handleCommand({ type: 'session/create', input: { projectPath } });
  if (!created.success) throw new Error(created.error);
  return (created.data as { sessionId: string }).sessionId;
}

async function seedUserTurn(runtime: HostRuntime, sessionId: string, text: string): Promise<void> {
  const seeded = await runtime.handleCommand({
    type: 'session/prompt',
    sessionId,
    input: { text },
  });
  if (!seeded.success) throw new Error(seeded.error);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const messages = await runtime.handleCommand({ type: 'session/messages', sessionId });
    if (
      messages.success &&
      (messages.data as { messages: Array<{ role: string }> }).messages.some(
        (row) => row.role === 'user',
      )
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('seeded user turn never reached the transcript');
}

async function readIndex(rootDir: string): Promise<SessionIndexDocument> {
  return JSON.parse(
    await readFile(getPiwinSessionIndexPath(rootDir), 'utf8'),
  ) as SessionIndexDocument;
}

describe('HostRuntime session/handoff', () => {
  afterEach(() => vi.restoreAllMocks());

  it('rolls back the new session and summary when writing the summary fails', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-handoff-rollback-'));
    const runtime = new HostRuntime({ mode: 'sdk', mock: true, piwinRoot: rootDir });
    try {
      const sourceId = await createSession(runtime, '/tmp/handoff-rollback');
      await seedUserTurn(runtime, sourceId, 'Keep the source intact on failure.');
      const originalWrite = handoffStore.writeSessionHandoffSummary;
      vi.spyOn(handoffStore, 'writeSessionHandoffSummary').mockImplementationOnce(
        async (...args) => {
          await originalWrite(...args);
          throw new Error('Summary disk write failed');
        },
      );

      const response = await runtime.handleCommand({
        type: 'session/handoff',
        sessionId: sourceId,
      });

      expect(response).toMatchObject({
        success: false,
        error: expect.stringContaining('Summary disk write failed'),
      });
      expect((await readIndex(rootDir)).sessions.map((record) => record.id)).toEqual([sourceId]);
      expect(await readdir(join(rootDir, 'sessions'))).toEqual([sourceId]);
    } finally {
      await runtime.dispose();
    }
  });

  it('opens an empty linked session that carries the summary, leaving the source untouched', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-handoff-'));
    const runtime = new HostRuntime({ mode: 'sdk', mock: true, piwinRoot: rootDir });
    const sourceId = await createSession(runtime, '/tmp/handoff-project');
    await runtime.handleCommand({
      type: 'session/rename',
      sessionId: sourceId,
      name: 'Auth refactor',
    });
    await seedUserTurn(runtime, sourceId, 'Keep this context for the next task.');

    const response = await runtime.handleCommand({ type: 'session/handoff', sessionId: sourceId });
    expect(response.success).toBe(true);
    if (!response.success) throw new Error(response.error);
    const data = response.data as SessionHandoffData;

    expect(data.sourceSessionId).toBe(sourceId);
    expect(data.sessionId).not.toBe(sourceId);
    expect(data.origin).toMatchObject({
      kind: 'handoff',
      sourceSessionId: sourceId,
      sourceSessionNameSnapshot: 'Auth refactor',
    });
    expect(data.contextRef).toEqual({
      kind: 'session-handoff',
      sessionId: data.sessionId,
      sourceSessionId: sourceId,
      label: 'Handoff summary',
    });
    expect(data.session.name).toBe('Handoff · Auth refactor');
    expect(data.summaryChars).toBeGreaterThan(0);

    const summary = await readFile(getSessionHandoffPath(rootDir, data.sessionId), 'utf8');
    expect(summary).toContain('Mock summary');

    const index = await readIndex(rootDir);
    const handedOff = index.sessions.find((record) => record.id === data.sessionId);
    expect(handedOff?.origin?.kind).toBe('handoff');
    expect(handedOff?.messageCount ?? 0).toBe(0);
    expect(handedOff?.scope).toEqual({ kind: 'project', projectPath: '/tmp/handoff-project' });

    const sourceMessages = await runtime.handleCommand({
      type: 'session/messages',
      sessionId: sourceId,
    });
    if (!sourceMessages.success) throw new Error(sourceMessages.error);
    expect(
      (sourceMessages.data as { messages: Array<{ text: string }> }).messages.some((row) =>
        row.text.includes('Keep this context for the next task.'),
      ),
    ).toBe(true);
    const newMessages = await runtime.handleCommand({
      type: 'session/messages',
      sessionId: data.sessionId,
    });
    if (!newMessages.success) throw new Error(newMessages.error);
    expect((newMessages.data as { messages: unknown[] }).messages).toHaveLength(0);

    await runtime.dispose();
  });

  it('preserves the source configuration in the fresh session', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-handoff-config-'));
    const runtime = new HostRuntime({ mode: 'sdk', mock: true, piwinRoot: rootDir });
    try {
      const sourceId = await createSession(runtime, '/tmp/handoff-config');
      await seedUserTurn(runtime, sourceId, 'Continue in the same configuration.');
      const source = await updateSessionRecord(
        getPiwinSessionIndexPath(rootDir),
        sourceId,
        (draft) => {
          draft.scope = { kind: 'general' };
          draft.workingDirectory = '/tmp/handoff-custom-cwd';
          draft.thinkingLevel = 'high';
          draft.knowledgeBaseIds = ['knowledge'];
          draft.disabledMcpServerIds = ['disabled-server'];
          draft.orchestrationSchemeId = 'custom-scheme';
          draft.delegationDisabled = true;
        },
      );
      if (!source) throw new Error('source session disappeared');

      const response = await runtime.handleCommand({
        type: 'session/handoff',
        sessionId: sourceId,
      });
      if (!response.success) throw new Error(response.error);
      const { sessionId } = response.data as SessionHandoffData;
      const target = (await readIndex(rootDir)).sessions.find((record) => record.id === sessionId);
      for (const key of [
        'scope',
        'workingDirectory',
        'model',
        'thinkingLevel',
        'knowledgeBaseIds',
        'disabledMcpServerIds',
        'orchestrationSchemeId',
        'delegationDisabled',
      ] as const) {
        expect(target?.[key], key).toEqual(source[key]);
      }
    } finally {
      await runtime.dispose();
    }
  });

  it('summarizes with the source model instead of the Pi built-in default', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-handoff-model-'));
    const runtime = new HostRuntime({ mode: 'sdk', mock: true, piwinRoot: rootDir });
    try {
      const sourceId = await createSession(runtime, '/tmp/handoff-model');
      await seedUserTurn(runtime, sourceId, 'Summarize with my model.');
      const model = { providerId: 'custom-openai', modelId: 'source-model' };
      await updateSessionRecord(getPiwinSessionIndexPath(rootDir), sourceId, (draft) => {
        draft.model = model;
        draft.thinkingLevel = 'low';
      });
      const createSpy = vi.spyOn(runtime, 'createSession');

      const response = await runtime.handleCommand({
        type: 'session/handoff',
        sessionId: sourceId,
      });

      expect(response.success).toBe(true);
      expect(createSpy.mock.calls[0]?.[0]).toMatchObject({ model, thinkingLevel: 'low' });
    } finally {
      await runtime.dispose();
    }
  });

  it('names the summary model when the provider refuses it, and creates no session', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-handoff-model-fail-'));
    const runtime = new HostRuntime({ mode: 'sdk', mock: true, piwinRoot: rootDir });
    try {
      const sourceId = await createSession(runtime, '/tmp/handoff-model-fail');
      await seedUserTurn(runtime, sourceId, 'Summarize with a model I cannot use.');
      const model = { providerId: 'openai-codex', modelId: 'gpt-5.5' };
      await updateSessionRecord(getPiwinSessionIndexPath(rootDir), sourceId, (draft) => {
        draft.model = model;
      });
      runtime.sessionModels.delete(sourceId);
      const create = runtime.createSession.bind(runtime);
      vi.spyOn(runtime, 'createSession').mockImplementationOnce(async (...args) => {
        const session = await create(...args);
        session.compact = async () => {
          throw new Error('Summarization failed: model is not supported with a ChatGPT account.');
        };
        return session;
      });

      const response = await runtime.handleCommand({
        type: 'session/handoff',
        sessionId: sourceId,
      });

      expect(response).toMatchObject({
        success: false,
        error: expect.stringContaining('Summary model openai-codex/gpt-5.5 is unavailable'),
        problem: {
          code: 'summary-model-unavailable',
          data: {
            model,
            reason: 'Summarization failed: model is not supported with a ChatGPT account.',
          },
        },
      });
      expect((await readIndex(rootDir)).sessions.map((record) => record.id)).toEqual([sourceId]);
    } finally {
      await runtime.dispose();
    }
  });

  it('does not create a session when cancellation races with a successful summary', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-handoff-abort-'));
    const runtime = new HostRuntime({ mode: 'sdk', mock: true, piwinRoot: rootDir });
    try {
      const sourceId = await createSession(runtime, '/tmp/handoff-abort');
      await seedUserTurn(runtime, sourceId, 'Keep the source after cancellation.');
      const create = runtime.createSession.bind(runtime);
      let finish: ((result: SessionCompactResult) => void) | undefined;
      const aborted = vi.fn(() => {
        // Some providers finish just as abort arrives; a completed provider
        // response must not turn an accepted cancellation into a new session.
        finish?.({ ok: true, summary: 'A summary completed during cancellation.' });
      });
      vi.spyOn(runtime, 'createSession').mockImplementationOnce(async (...args) => {
        const session = await create(...args);
        session.compact = async () =>
          new Promise<SessionCompactResult>((resolve) => {
            finish = resolve;
          });
        session.abortCompaction = aborted;
        return session;
      });
      const pending = runtime.handleCommand({ type: 'session/handoff', sessionId: sourceId });
      await vi.waitFor(() => expect(finish).toBeDefined());
      const cancelled = await runtime.handleCommand({
        type: 'session/compact-abort',
        sessionId: sourceId,
      });
      expect(cancelled.success).toBe(true);
      const response = await pending;

      expect(aborted).toHaveBeenCalledOnce();
      expect(response).toMatchObject({
        success: false,
        error: 'Compaction cancelled',
        problem: { code: 'session-handoff-refused', data: { reason: 'cancelled' } },
      });
      expect((await readIndex(rootDir)).sessions.map((record) => record.id)).toEqual([sourceId]);
    } finally {
      await runtime.dispose();
    }
  });

  it('refuses a session with nothing to summarize and creates no session', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-handoff-empty-'));
    const runtime = new HostRuntime({ mode: 'sdk', mock: true, piwinRoot: rootDir });
    const sourceId = await createSession(runtime, '/tmp/handoff-empty');

    const response = await runtime.handleCommand({ type: 'session/handoff', sessionId: sourceId });
    expect(response).toMatchObject({
      success: false,
      problem: { code: 'session-handoff-refused', data: { reason: 'empty-transcript' } },
    });
    expect((await readIndex(rootDir)).sessions.map((record) => record.id)).toEqual([sourceId]);

    await runtime.dispose();
  });

  it('refuses an unknown session', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-handoff-unknown-'));
    const runtime = new HostRuntime({ mode: 'sdk', mock: true, piwinRoot: rootDir });
    const response = await runtime.handleCommand({ type: 'session/handoff', sessionId: 'missing' });
    expect(response).toMatchObject({ success: false, error: 'Unknown session: missing' });
    await runtime.dispose();
  });
});

describe('session/handoff-summary', () => {
  it('returns the stored summary, truncated to the same cap a prompt receives', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-handoff-read-'));
    const runtime = new HostRuntime({ mode: 'sdk', mock: true, piwinRoot: rootDir });
    try {
      const sessionId = await createSession(runtime, '/tmp/handoff-read');
      const full = `${'kept'.repeat(100)}\n${'x'.repeat(MAX_HANDOFF_SUMMARY_CHARS)}`;
      await writeSessionHandoffSummary(rootDir, sessionId, full);
      const response = await runtime.handleCommand({ type: 'session/handoff-summary', sessionId });
      expect(response.success).toBe(true);
      if (!response.success) return;
      expect(response.data).toMatchObject({
        sessionId,
        truncated: true,
        summary: full.slice(0, MAX_HANDOFF_SUMMARY_CHARS),
      });

      const empty = await createSession(runtime, '/tmp/handoff-read');
      const missing = await runtime.handleCommand({
        type: 'session/handoff-summary',
        sessionId: empty,
      });
      expect(missing).toMatchObject({
        success: false,
        problem: { code: 'session-handoff-summary-missing' },
      });
    } finally {
      await runtime.dispose();
    }
  });
});

describe('handoff summary resolution', () => {
  it('resolves only for the session whose prompt is being prepared', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-handoff-refs-'));
    await mkdir(join(rootDir, 'sessions', 'owner'), { recursive: true });
    await writeSessionHandoffSummary(rootDir, 'owner', 'Goal: finish the auth refactor.');
    // Only piwinRoot is read on this path.
    const context = { piwinRoot: rootDir } as unknown as SessionLiveContext;

    expect(await createResolveRefsDeps(context, 'owner').loadHandoffSummary('owner')).toBe(
      'Goal: finish the auth refactor.',
    );
    expect(
      await createResolveRefsDeps(context, 'other').loadHandoffSummary('owner'),
    ).toBeUndefined();
    expect(await createResolveRefsDeps(context).loadHandoffSummary('owner')).toBeUndefined();
  });
});

describe('buildHandoffSessionName', () => {
  it('falls back to a short id when the source has no name', () => {
    expect(buildHandoffSessionName(undefined, 'abcdef1234567')).toBe('Handoff · session-abcdef12');
  });
});
