import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openSessionTranscriptStore } from '@piwin/session';
import { HostRuntime } from './host-runtime.js';
import { getPiwinSessionTranscriptDatabasePath } from './paths.js';

async function seedStreamingAssistant(options: {
  rootDir: string;
  sessionId: string;
  runId: string;
  messageId: string;
}): Promise<void> {
  const store = await openSessionTranscriptStore({
    dbPath: getPiwinSessionTranscriptDatabasePath(options.rootDir, options.sessionId),
    sessionId: options.sessionId,
    projectPath: '',
  });
  await store.appendMessage({
    id: options.messageId,
    runtimeGenerationId: 'gen-live',
    backendMessageId: options.messageId,
    role: 'assistant',
    text: '',
    thinking: 'partial',
    status: 'streaming',
    runId: options.runId,
    createdAt: '2026-08-27T03:25:58.000Z',
    metadata: { thinkingStartedAt: '2026-08-27T03:25:58.000Z' },
  });
  store.close();
}

async function readAssistant(rootDir: string, sessionId: string, messageId: string) {
  const store = await openSessionTranscriptStore({
    dbPath: getPiwinSessionTranscriptDatabasePath(rootDir, sessionId),
    sessionId,
    projectPath: '',
  });
  const message = await store.getMessage(messageId);
  store.close();
  return message;
}

describe('run transcript finalization', () => {
  it('abort settles leftover streaming rows for the cancelled run', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-abort-settle-stream-'));
    const runtime = new HostRuntime({
      mode: 'sdk',
      mock: true,
      piwinRoot: rootDir,
      testFixture: 'hang-until-abort',
    });
    const created = await runtime.handleCommand({
      type: 'session/create',
      input: { scope: { kind: 'general' } },
    });
    expect(created.success).toBe(true);
    if (!created.success) throw new Error(created.error);
    const sessionId = (created.data as { sessionId: string }).sessionId;
    const prompted = await runtime.handleCommand({
      type: 'session/prompt',
      sessionId,
      input: { text: 'hang' },
    });
    expect(prompted.success).toBe(true);
    if (!prompted.success) throw new Error(prompted.error);
    const runId = (prompted.data as { runId: string }).runId;
    await seedStreamingAssistant({
      rootDir,
      sessionId,
      runId,
      messageId: 'abort-orphan',
    });

    const aborted = await runtime.handleCommand({ type: 'session/abort', sessionId, runId });
    expect(aborted.success).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 80));
    await runtime.dispose();

    const repaired = await readAssistant(rootDir, sessionId, 'abort-orphan');
    expect(repaired?.status).toBe('done');
    expect(repaired?.outcome).toBe('cancelled');
  });

  it('dispose settles leftover streaming rows for in-flight runs', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-dispose-settle-stream-'));
    const runtime = new HostRuntime({
      mode: 'sdk',
      mock: true,
      piwinRoot: rootDir,
      testFixture: 'hang-until-abort',
    });
    const created = await runtime.handleCommand({
      type: 'session/create',
      input: { scope: { kind: 'general' } },
    });
    expect(created.success).toBe(true);
    if (!created.success) throw new Error(created.error);
    const sessionId = (created.data as { sessionId: string }).sessionId;
    const prompted = await runtime.handleCommand({
      type: 'session/prompt',
      sessionId,
      input: { text: 'hang' },
    });
    expect(prompted.success).toBe(true);
    if (!prompted.success) throw new Error(prompted.error);
    const runId = (prompted.data as { runId: string }).runId;
    await seedStreamingAssistant({
      rootDir,
      sessionId,
      runId,
      messageId: 'dispose-orphan',
    });

    await runtime.dispose();
    const repaired = await readAssistant(rootDir, sessionId, 'dispose-orphan');
    expect(repaired?.status).toBe('done');
    expect(repaired?.outcome).toBe('cancelled');
  });
});
