import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { forkProductSession, buildForkSessionName, ForkValidationError } from './fork-session.js';
import { createSessionRecord, upsertSessionRecord, getSessionRecord, loadSessionIndex } from './session-index-store.js';
import { saveSessionTranscript } from './message-store.js';
import type { SessionTranscriptDocument } from '@piwin/contracts';

function makeTestTranscript(): SessionTranscriptDocument {
  return {
    version: 1,
    sessionId: 'source-1',
    projectPath: '/test',
    messages: [
      { id: 'msg-1', role: 'user', text: 'Hello', createdAt: '2026-01-01T00:00:00Z', status: 'done' },
      { id: 'msg-2', role: 'assistant', text: 'Hi there', createdAt: '2026-01-01T00:00:01Z', status: 'done' },
      { id: 'msg-3', role: 'user', text: 'Second question', createdAt: '2026-01-01T00:00:02Z', status: 'done' },
      { id: 'msg-4', role: 'assistant', text: 'Second answer', createdAt: '2026-01-01T00:00:03Z', status: 'done' },
    ],
    updatedAt: '2026-01-01T00:00:03Z',
  };
}

describe('buildForkSessionName', () => {
  it('prefixes the first fork with (1) and leaves the source title untouched', () => {
    expect(buildForkSessionName('My Chat', 'src-1')).toBe('(1) My Chat');
  });

  it('increments the prefix across the title family', () => {
    expect(buildForkSessionName('My Chat', 'src-1', ['(1) My Chat'])).toBe('(2) My Chat');
    expect(buildForkSessionName('My Chat', 'src-1', ['(1) My Chat', '(2) My Chat'])).toBe(
      '(3) My Chat',
    );
  });

  it('does not reuse the source session name when forking a numbered child', () => {
    expect(buildForkSessionName('(1) My Chat', 'fork-1')).toBe('(2) My Chat');
  });

  it('strips the legacy Branch suffix so new forks join the (n) family', () => {
    expect(buildForkSessionName('My Chat · Branch', 'src-1')).toBe('(1) My Chat');
  });
});

describe('forkProductSession', () => {
  let tempDir: string;
  let indexPath: string;
  let sourceTranscriptPath: string;
  let targetTranscriptPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'piwin-fork-test-'));
    indexPath = join(tempDir, 'index.json');
    sourceTranscriptPath = join(tempDir, 'source-transcript.json');
    targetTranscriptPath = join(tempDir, 'target-transcript.json');

    // Create source session
    const record = createSessionRecord({
      id: 'source-1',
      projectPath: '/test',
      name: 'Test Chat',
      kind: 'main',
      depth: 0,
    });
    await upsertSessionRecord(indexPath, record);
    await saveSessionTranscript(sourceTranscriptPath, makeTestTranscript());
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('forks from a completed assistant response', async () => {
    const result = await forkProductSession(
      { indexPath, sourceTranscriptPath, targetTranscriptPath },
      {
        sourceSessionId: 'source-1',
        messageId: 'msg-2',
        workspaceStrategy: 'shared',
        newSessionId: 'fork-1',
      },
    );
    expect(result).toBeDefined();
    expect(result!.record.id).toBe('fork-1');
    expect(result!.record.origin?.kind).toBe('fork');
    if (result!.record.origin?.kind === 'fork') {
      expect(result!.record.origin.sourceSessionId).toBe('source-1');
      expect(result!.record.origin.rootSessionId).toBe('source-1');
      expect(result!.record.origin.sourceMessageId).toBe('msg-2');
      expect(result!.record.origin.workspaceStrategy).toBe('shared');
    }
    expect(result!.transcript.messages).toHaveLength(2);
    expect(result!.transcript.messages[0]!.role).toBe('user');
    expect(result!.transcript.messages[1]!.role).toBe('assistant');
  });

  it('preserves root when forking a fork', async () => {
    // First fork
    const firstFork = await forkProductSession(
      { indexPath, sourceTranscriptPath, targetTranscriptPath },
      {
        sourceSessionId: 'source-1',
        messageId: 'msg-2',
        workspaceStrategy: 'shared',
        newSessionId: 'fork-1',
      },
    );
    expect(firstFork).toBeDefined();

    // Save fork-1 transcript for second fork
    const fork1TranscriptPath = join(tempDir, 'fork-1-transcript.json');
    await saveSessionTranscript(fork1TranscriptPath, firstFork!.transcript);

    // Fork from fork-1
    const fork2TranscriptPath = join(tempDir, 'fork-2-transcript.json');
    const secondFork = await forkProductSession(
      { indexPath, sourceTranscriptPath: fork1TranscriptPath, targetTranscriptPath: fork2TranscriptPath },
      {
        sourceSessionId: 'fork-1',
        messageId: firstFork!.transcript.messages[1]!.id,
        workspaceStrategy: 'shared',
        newSessionId: 'fork-2',
      },
    );
    expect(secondFork).toBeDefined();
    expect(secondFork!.record.origin?.kind).toBe('fork');
    if (secondFork!.record.origin?.kind === 'fork') {
      expect(secondFork!.record.origin.rootSessionId).toBe('source-1');
      expect(secondFork!.record.origin.sourceSessionId).toBe('fork-1');
    }
  });

  it('throws on non-existent source session', async () => {
    await expect(
      forkProductSession(
        { indexPath, sourceTranscriptPath, targetTranscriptPath },
        { sourceSessionId: 'nonexistent', messageId: 'msg-2', workspaceStrategy: 'shared' },
      ),
    ).rejects.toThrow(ForkValidationError);
  });

  it('throws on non-assistant message', async () => {
    await expect(
      forkProductSession(
        { indexPath, sourceTranscriptPath, targetTranscriptPath },
        { sourceSessionId: 'source-1', messageId: 'msg-1', workspaceStrategy: 'shared', newSessionId: 'fork-x' },
      ),
    ).rejects.toThrow(ForkValidationError);
  });

  it('throws on streaming message', async () => {
    const streamingTranscript: SessionTranscriptDocument = {
      ...makeTestTranscript(),
      messages: [
        { id: 'msg-1', role: 'user', text: 'Hello', createdAt: '2026-01-01T00:00:00Z', status: 'done' },
        { id: 'msg-2', role: 'assistant', text: 'Hi there', createdAt: '2026-01-01T00:00:01Z', status: 'streaming' },
      ],
    };
    await saveSessionTranscript(sourceTranscriptPath, streamingTranscript);
    await expect(
      forkProductSession(
        { indexPath, sourceTranscriptPath, targetTranscriptPath },
        { sourceSessionId: 'source-1', messageId: 'msg-2', workspaceStrategy: 'shared', newSessionId: 'fork-x' },
      ),
    ).rejects.toThrow(ForkValidationError);
  });

  it('uses default branch name when name is not provided', async () => {
    const result = await forkProductSession(
      { indexPath, sourceTranscriptPath, targetTranscriptPath },
      {
        sourceSessionId: 'source-1',
        messageId: 'msg-2',
        workspaceStrategy: 'shared',
        newSessionId: 'fork-named',
      },
    );
    expect(result).toBeDefined();
    expect(result!.record.name).toBe('(1) Test Chat');
  });

  it('uses the next available default branch name', async () => {
    const result = await forkProductSession(
      { indexPath, sourceTranscriptPath, targetTranscriptPath },
      {
        sourceSessionId: 'source-1',
        messageId: 'msg-2',
        workspaceStrategy: 'shared',
        existingForkNames: ['(1) Test Chat', '(2) Test Chat'],
        newSessionId: 'fork-named-3',
      },
    );
    expect(result).toBeDefined();
    expect(result?.record.name).toBe('(3) Test Chat');
  });
});
