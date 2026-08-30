import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SessionTranscriptMessage } from '@piwin/contracts';
import { openSessionTranscriptStore, type SessionTranscriptStore } from '@piwin/session';
import { HostRuntime } from './host-runtime.js';
import { getPiwinSessionTranscriptDatabasePath } from './paths.js';

describe('SQLite transcript derived operations', () => {
  it('streams fork/export and transactionally truncates without transcript.json', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-derived-transcript-'));
    const runtime = new HostRuntime({ mode: 'sdk', mock: true, piwinRoot: rootDir });
    try {
      const created = await runtime.handleCommand({
        type: 'session/create',
        input: { projectPath: '/project', sessionName: 'Source' },
      });
      expect(created.success).toBe(true);
      if (!created.success) throw new Error(created.error);
      const sourceSessionId = (created.data as { sessionId: string }).sessionId;
      const prompted = await runtime.handleCommand({
        type: 'session/prompt',
        sessionId: sourceSessionId,
        input: { text: 'fork this conversation' },
      });
      expect(prompted.success).toBe(true);

      const sourceMessages = await waitForCompletedAssistant(runtime, sourceSessionId);
      const firstAssistant = sourceMessages.find(
        (message) => message.role === 'assistant' && message.status === 'done',
      );
      if (firstAssistant === undefined) throw new Error('completed assistant message missing');
      const secondPrompted = await runtime.handleCommand({
        type: 'session/prompt',
        sessionId: sourceSessionId,
        input: { text: 'add a later turn beyond the fork point' },
      });
      expect(secondPrompted.success).toBe(true);
      const sourceMessagesAfterSecondTurn = await waitForCompletedAssistants(
        runtime,
        sourceSessionId,
        2,
      );

      const duplicated = await runtime.handleCommand({
        type: 'session/duplicate',
        sessionId: sourceSessionId,
        messageProjection: 'tail',
      });
      expect(duplicated.success).toBe(true);
      if (!duplicated.success) throw new Error(duplicated.error);
      const duplicateSessionId = (duplicated.data as { sessionId: string }).sessionId;
      const duplicateMessages = await runtime.handleCommand({
        type: 'session/messages',
        sessionId: duplicateSessionId,
      });
      expect(duplicateMessages.success).toBe(true);
      if (!duplicateMessages.success) throw new Error(duplicateMessages.error);
      expect(
        comparableMessages(
          (duplicateMessages.data as { messages: SessionTranscriptMessage[] }).messages,
        ),
      ).toEqual(comparableMessages(sourceMessagesAfterSecondTurn));

      const duplicateSummaries = await runtime.handleCommand({
        type: 'session/model-context-summary',
        sessionId: duplicateSessionId,
      });
      expect(duplicateSummaries.success).toBe(true);
      if (!duplicateSummaries.success) throw new Error(duplicateSummaries.error);
      expect(
        (duplicateSummaries.data as { summaries: unknown[] }).summaries.length,
      ).toBe(2);
      const duplicatePrompted = await runtime.handleCommand({
        type: 'session/prompt',
        sessionId: duplicateSessionId,
        input: { text: 'continue on the duplicated session' },
      });
      expect(duplicatePrompted.success).toBe(true);
      await waitForCompletedAssistants(runtime, duplicateSessionId, 3);
      const duplicateSummariesAfterPrompt = await runtime.handleCommand({
        type: 'session/model-context-summary',
        sessionId: duplicateSessionId,
      });
      expect(duplicateSummariesAfterPrompt.success).toBe(true);
      if (!duplicateSummariesAfterPrompt.success) {
        throw new Error(duplicateSummariesAfterPrompt.error);
      }
      const duplicateOrdinals = (
        duplicateSummariesAfterPrompt.data as {
          summaries: Array<{ requestOrdinal: number }>;
        }
      ).summaries.map((summary) => summary.requestOrdinal);
      expect(duplicateOrdinals).toEqual([1, 2, 3]);

      const forked = await runtime.handleCommand({
        type: 'session/fork',
        sessionId: sourceSessionId,
        messageId: firstAssistant.id,
        workspaceStrategy: 'shared',
        messageProjection: 'tail',
      });
      expect(forked.success).toBe(true);
      if (!forked.success) throw new Error(forked.error);
      const forkSessionId = (forked.data as { sessionId: string }).sessionId;
      const forkMessages = await runtime.handleCommand({
        type: 'session/messages',
        sessionId: forkSessionId,
      });
      expect(forkMessages.success).toBe(true);
      if (!forkMessages.success) throw new Error(forkMessages.error);
      expect((forkMessages.data as { messages: SessionTranscriptMessage[] }).messages).toHaveLength(
        2,
      );
      expect(
        comparableMessages(
          (forkMessages.data as { messages: SessionTranscriptMessage[] }).messages,
        ),
      ).toEqual(comparableMessages(sourceMessages));

      const forkSummaries = await runtime.handleCommand({
        type: 'session/model-context-summary',
        sessionId: forkSessionId,
      });
      expect(forkSummaries.success).toBe(true);
      if (!forkSummaries.success) throw new Error(forkSummaries.error);
      expect((forkSummaries.data as { summaries: unknown[] }).summaries.length).toBe(1);

      const outputPath = join(rootDir, 'source-export.md');
      const exported = await runtime.handleCommand({
        type: 'session/export',
        sessionId: sourceSessionId,
        format: 'md',
        outputPath,
      });
      expect(exported.success).toBe(true);
      expect(await readFile(outputPath, 'utf8')).toContain('fork this conversation');

      const truncated = await runtime.handleCommand({
        type: 'session/truncate-from',
        sessionId: forkSessionId,
        messageId: firstAssistant.id,
        messageProjection: 'tail',
      });
      // Fork regenerates ids, so the source assistant id must never address a
      // target row. This is an identity-parity assertion, not a failure of the
      // truncate implementation.
      expect(truncated.success).toBe(false);
      const targetAssistant = (
        forkMessages.data as { messages: SessionTranscriptMessage[] }
      ).messages.find((message) => message.role === 'assistant');
      if (targetAssistant === undefined) throw new Error('fork assistant missing');
      const targetTruncate = await runtime.handleCommand({
        type: 'session/truncate-from',
        sessionId: forkSessionId,
        messageId: targetAssistant.id,
        messageProjection: 'tail',
      });
      expect(targetTruncate.success).toBe(true);
      if (!targetTruncate.success) throw new Error(targetTruncate.error);
      expect((targetTruncate.data as { remainingCount: number }).remainingCount).toBe(1);
      const truncatedSummaries = await runtime.handleCommand({
        type: 'session/model-context-summary',
        sessionId: forkSessionId,
      });
      expect(truncatedSummaries).toMatchObject({
        success: true,
        data: { summaries: [] },
      });
      const truncatedRuntime = await runtime.handleCommand({
        type: 'session/runtime-status',
        sessionId: forkSessionId,
      });
      expect(truncatedRuntime).toMatchObject({
        success: true,
        data: { status: { residency: 'cold', lastEvictionReason: 'manual' } },
      });
    } finally {
      await runtime.dispose();
    }
  });

  it('duplicate and fork copy native context entries to the new session', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-derived-native-'));
    const runtime = new HostRuntime({ mode: 'sdk', mock: true, piwinRoot: rootDir });
    let duplicateSessionId = '';
    let forkSessionId = '';
    try {
      const created = await runtime.handleCommand({
        type: 'session/create',
        input: { projectPath: '/project', sessionName: 'Native source' },
      });
      expect(created.success).toBe(true);
      if (!created.success) throw new Error(created.error);
      const sourceSessionId = (created.data as { sessionId: string }).sessionId;
      const prompted = await runtime.handleCommand({
        type: 'session/prompt',
        sessionId: sourceSessionId,
        input: { text: 'carry my native context' },
      });
      expect(prompted.success).toBe(true);
      const sourceMessages = await waitForCompletedAssistant(runtime, sourceSessionId);
      const assistant = sourceMessages.find(
        (message) => message.role === 'assistant' && message.status === 'done',
      );
      if (assistant === undefined) throw new Error('completed assistant message missing');

      // Native persistence is fire-and-forget behind the push; wait for the
      // source row to actually carry its copy before deriving new sessions.
      const sourceStore = await openStoreFor(rootDir, sourceSessionId);
      try {
        await waitForNativeEntries(sourceStore, assistant.id);
      } finally {
        sourceStore.close();
      }

      const duplicated = await runtime.handleCommand({
        type: 'session/duplicate',
        sessionId: sourceSessionId,
        messageProjection: 'none',
      });
      expect(duplicated.success).toBe(true);
      if (!duplicated.success) throw new Error(duplicated.error);
      duplicateSessionId = (duplicated.data as { sessionId: string }).sessionId;

      const forked = await runtime.handleCommand({
        type: 'session/fork',
        sessionId: sourceSessionId,
        messageId: assistant.id,
        workspaceStrategy: 'shared',
        messageProjection: 'none',
      });
      expect(forked.success).toBe(true);
      if (!forked.success) throw new Error(forked.error);
      forkSessionId = (forked.data as { sessionId: string }).sessionId;
    } finally {
      await runtime.dispose();
    }

    for (const sessionId of [duplicateSessionId, forkSessionId]) {
      const store = await openStoreFor(rootDir, sessionId);
      try {
        const assistantRow = await store.lastMessageByRole('assistant');
        if (assistantRow === undefined) throw new Error(`assistant row missing in ${sessionId}`);
        const entries = await store.readNativeEntries(assistantRow.id);
        expect(entries.length).toBeGreaterThan(0);
        expect(JSON.parse(entries[0]?.payload ?? '{}')).toMatchObject({ role: 'assistant' });
      } finally {
        store.close();
      }
    }
  });
});

async function openStoreFor(
  rootDir: string,
  sessionId: string,
): Promise<SessionTranscriptStore> {
  return openSessionTranscriptStore({
    dbPath: getPiwinSessionTranscriptDatabasePath(rootDir, sessionId),
    sessionId,
    projectPath: '/project',
  });
}

async function waitForNativeEntries(
  store: SessionTranscriptStore,
  messageId: string,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const entries = await store.readNativeEntries(messageId);
    if (entries.length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('native entries never appeared on source assistant row');
}

function comparableMessages(messages: readonly SessionTranscriptMessage[]): unknown[] {
  return messages.map(
    ({ id: _id, runtimeGenerationId: _generationId, attachments, ...message }) => ({
      ...message,
      ...(attachments !== undefined
        ? {
            attachments: attachments.map(({ id: _attachmentId, ...attachment }) => attachment),
          }
        : {}),
    }),
  );
}

async function waitForCompletedAssistant(
  runtime: HostRuntime,
  sessionId: string,
): Promise<SessionTranscriptMessage[]> {
  return waitForCompletedAssistants(runtime, sessionId, 1);
}

async function waitForCompletedAssistants(
  runtime: HostRuntime,
  sessionId: string,
  count: number,
): Promise<SessionTranscriptMessage[]> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await runtime.handleCommand({ type: 'session/messages', sessionId });
    if (response.success) {
      const messages = (response.data as { messages: SessionTranscriptMessage[] }).messages;
      if (
        messages.filter((message) => message.role === 'assistant' && message.status === 'done')
          .length >= count &&
        runtime.listForegroundRuns().every((run) => run.sessionId !== sessionId)
      ) {
        return messages;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('assistant response did not complete');
}
