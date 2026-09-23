import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SessionTranscriptMessage } from '@piwin/contracts';
import { SESSION_RETRACT_REFUSALS } from '@piwin/contracts';
import { openSessionTranscriptStore, type SessionTranscriptStore } from '@piwin/session';
import { HostRuntime } from './host-runtime.js';
import { getPiwinSessionTranscriptDatabasePath } from './paths.js';
import { appendUserPromptToTranscriptStore } from './transcript-user-prompt.js';

async function listMessages(runtime: HostRuntime, sessionId: string): Promise<SessionTranscriptMessage[]> {
  const response = await runtime.handleCommand({ type: 'session/messages', sessionId });
  if (!response.success) throw new Error(response.error);
  return (response.data as { messages: SessionTranscriptMessage[] }).messages;
}

async function waitForIdleReply(runtime: HostRuntime, sessionId: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const messages = await listMessages(runtime, sessionId);
    if (
      messages.some((message) => message.role === 'assistant' && message.status === 'done') &&
      runtime.listForegroundRuns().every((run) => run.sessionId !== sessionId)
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('first turn never settled');
}

/**
 * A pause that lands before the provider streams anything leaves exactly this
 * durable shape: the prompt row as the tail and an active checkpoint naming
 * it. Seed it directly — the mock streams too fast to pause ahead of it.
 */
async function seedPausedPrompt(
  rootDir: string,
  sessionId: string,
  options: { replyText?: string } = {},
): Promise<{ store: SessionTranscriptStore; checkpointId: string }> {
  const store = await openSessionTranscriptStore({
    dbPath: getPiwinSessionTranscriptDatabasePath(rootDir, sessionId),
    sessionId,
    projectPath: '/project',
  });
  await appendUserPromptToTranscriptStore({
    store,
    input: {
      text: 'half-written question',
      contextRefs: [{ kind: 'selection', snapshotText: 'quoted', label: 'quoted' }],
    },
    messageId: 'user-paused',
    createdAt: new Date().toISOString(),
  });
  if (options.replyText !== undefined) {
    await store.appendMessage({
      id: 'assistant-paused',
      runtimeGenerationId: 'generation-test',
      backendMessageId: 'assistant-paused',
      role: 'assistant',
      text: options.replyText,
      status: 'done',
      createdAt: new Date().toISOString(),
    });
  }
  const checkpoint = await store.createPauseCheckpoint({
    sessionId,
    sourceRunId: 'run-paused',
    createdAt: new Date().toISOString(),
    sourceUserMessageId: 'user-paused',
    transcriptRevision: await store.getRevision(),
  });
  return { store, checkpointId: checkpoint.checkpointId };
}

async function startSession(runtime: HostRuntime): Promise<string> {
  const created = await runtime.handleCommand({
    type: 'session/create',
    input: { projectPath: '/project' },
  });
  if (!created.success) throw new Error(created.error);
  const sessionId = (created.data as { sessionId: string }).sessionId;
  const prompted = await runtime.handleCommand({
    type: 'session/prompt',
    sessionId,
    input: { text: 'an earlier, answered turn' },
  });
  if (!prompted.success) throw new Error(prompted.error);
  await waitForIdleReply(runtime, sessionId);
  return sessionId;
}

describe('session/retract-paused-prompt', () => {
  it('hands back a prompt paused before any output and clears its checkpoint', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-retract-'));
    const runtime = new HostRuntime({ mode: 'sdk', mock: true, piwinRoot: rootDir });
    try {
      const sessionId = await startSession(runtime);
      const { store, checkpointId } = await seedPausedPrompt(rootDir, sessionId);

      const stale = await runtime.handleCommand({
        type: 'session/retract-paused-prompt',
        sessionId,
        checkpointId: 'someone-elses-checkpoint',
      });
      expect(stale).toMatchObject({
        success: false,
        error: SESSION_RETRACT_REFUSALS.checkpointStale,
      });

      const retracted = await runtime.handleCommand({
        type: 'session/retract-paused-prompt',
        sessionId,
        checkpointId,
      });
      expect(retracted).toMatchObject({
        success: true,
        data: {
          sessionId,
          removedCount: 1,
          retracted: {
            userMessageId: 'user-paused',
            text: 'half-written question',
            contextRefs: [{ kind: 'selection', snapshotText: 'quoted', label: 'quoted' }],
          },
        },
      });
      expect((await listMessages(runtime, sessionId)).map((message) => message.id)).not.toContain(
        'user-paused',
      );
      expect(await store.getActivePauseCheckpoint()).toBeUndefined();
      store.close();
    } finally {
      await runtime.dispose();
    }
  });

  it('refuses once the model replied, leaving the paused turn resumable', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-retract-refused-'));
    const runtime = new HostRuntime({ mode: 'sdk', mock: true, piwinRoot: rootDir });
    try {
      const sessionId = await startSession(runtime);
      const { store, checkpointId } = await seedPausedPrompt(rootDir, sessionId, {
        replyText: 'Sure, first',
      });

      const refused = await runtime.handleCommand({
        type: 'session/retract-paused-prompt',
        sessionId,
        checkpointId,
      });
      expect(refused).toMatchObject({ success: false, error: SESSION_RETRACT_REFUSALS.hasOutput });
      expect((await listMessages(runtime, sessionId)).map((message) => message.id)).toEqual(
        expect.arrayContaining(['user-paused', 'assistant-paused']),
      );
      expect(await store.getActivePauseCheckpoint()).toMatchObject({ checkpointId });
      store.close();
    } finally {
      await runtime.dispose();
    }
  });
});
