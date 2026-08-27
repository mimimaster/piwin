import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openSessionTranscriptStore } from '@piwin/session';
import { HostRuntime } from './host-runtime.js';
import { getPiwinSessionTranscriptDatabasePath } from './paths.js';

describe('session/resume orphan streaming recovery', () => {
  it('settles leftover streaming assistant rows when no foreground run exists', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-resume-orphan-stream-'));
    const runtime = new HostRuntime({ mode: 'sdk', mock: true, piwinRoot: rootDir });
    const created = await runtime.handleCommand({
      type: 'session/create',
      input: { scope: { kind: 'general' } },
    });
    expect(created.success).toBe(true);
    if (!created.success) throw new Error(created.error);
    const sessionId = (created.data as { sessionId: string }).sessionId;
    await runtime.dispose();

    const store = await openSessionTranscriptStore({
      dbPath: getPiwinSessionTranscriptDatabasePath(rootDir, sessionId),
      sessionId,
      projectPath: '',
    });
    await store.appendMessage({
      id: 'orphan-assistant',
      runtimeGenerationId: 'gen-crash',
      backendMessageId: 'a-orphan',
      role: 'assistant',
      text: '',
      thinking: '<svg',
      status: 'streaming',
      runId: 'run-dead',
      createdAt: '2026-08-27T03:25:58.000Z',
      metadata: { thinkingStartedAt: '2026-08-27T03:25:58.000Z' },
    });
    store.close();

    const runtimeB = new HostRuntime({ mode: 'sdk', mock: true, piwinRoot: rootDir });
    const resumed = await runtimeB.handleCommand({ type: 'session/resume', sessionId });
    expect(resumed.success).toBe(true);
    if (!resumed.success) throw new Error(resumed.error);
    const messages = (resumed.data as { messages: Array<{ id: string; status: string }> }).messages;
    const orphan = messages.find((message) => message.id === 'orphan-assistant');
    expect(orphan?.status).toBe('done');
    await runtimeB.dispose();

    const verify = await openSessionTranscriptStore({
      dbPath: getPiwinSessionTranscriptDatabasePath(rootDir, sessionId),
      sessionId,
      projectPath: '',
    });
    const repaired = await verify.getMessage('orphan-assistant');
    expect(repaired?.status).toBe('done');
    expect(repaired?.outcome).toBe('cancelled');
    expect(repaired?.thinkingEndedAt).toBeDefined();
    verify.close();
  });
});
