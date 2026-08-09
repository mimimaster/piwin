import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SessionTranscriptMessage } from '@piwin/contracts';
import { HostRuntime } from './host-runtime.js';

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
      const assistant = sourceMessages.find(
        (message) => message.role === 'assistant' && message.status === 'done',
      );
      if (assistant === undefined) throw new Error('completed assistant message missing');

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
      ).toEqual(comparableMessages(sourceMessages));

      const forked = await runtime.handleCommand({
        type: 'session/fork',
        sessionId: sourceSessionId,
        messageId: assistant.id,
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
        sourceMessages.length,
      );
      expect(
        comparableMessages(
          (forkMessages.data as { messages: SessionTranscriptMessage[] }).messages,
        ),
      ).toEqual(comparableMessages(sourceMessages));

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
        messageId: assistant.id,
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
});

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
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await runtime.handleCommand({ type: 'session/messages', sessionId });
    if (response.success) {
      const messages = (response.data as { messages: SessionTranscriptMessage[] }).messages;
      if (messages.some((message) => message.role === 'assistant' && message.status === 'done')) {
        return messages;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('assistant response did not complete');
}
