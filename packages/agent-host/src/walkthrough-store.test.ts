import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SessionTranscriptDocument, WalkthroughArtifact } from '@piwin/contracts';
import {
  deleteSessionWalkthroughs,
  deleteWalkthrough,
  listWalkthroughs,
  loadWalkthrough,
  saveWalkthrough,
} from './walkthrough-store.js';
import { getPiwinSessionWalkthroughDir, getPiwinSessionWalkthroughPath } from './paths.js';

const MODEL = {
  protocol: 'openai-compatible' as const,
  providerId: 'prov',
  modelId: 'model-a',
};

type ReadyWalkthroughArtifact = Extract<WalkthroughArtifact, { status: 'ready' }>;

function makeReadyArtifact(sessionId: string, messageId: string): ReadyWalkthroughArtifact {
  return {
    version: 1,
    id: `wt-${messageId}`,
    sessionId,
    messageId,
    mode: 'default',
    model: MODEL,
    sourceHash: 'abc123',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    status: 'ready',
    markdown: '# Walkthrough\n\nSummary here.',
    generatedAt: '2026-08-01T00:00:01.000Z',
  };
}

function makeTranscript(sessionId: string, messageIds: string[]): SessionTranscriptDocument {
  return {
    version: 1,
    sessionId,
    projectPath: '/proj',
    messages: messageIds.map((id) => ({
      id,
      role: 'assistant',
      text: 'hi',
      createdAt: '2026-08-01T00:00:00.000Z',
      status: 'done',
    })),
    updatedAt: '2026-08-01T00:00:00.000Z',
  };
}

async function writeTranscript(rootDir: string, doc: SessionTranscriptDocument): Promise<void> {
  const transcriptPath = join(rootDir, 'sessions', doc.sessionId, 'transcript.json');
  await mkdir(join(rootDir, 'sessions', doc.sessionId), { recursive: true });
  await writeFile(transcriptPath, JSON.stringify(doc), 'utf8');
}

describe('walkthrough-store', () => {
  it('saveWalkthrough creates dir and JSON file', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-wt-'));
    const sessionId = 'sess-1';
    const messageId = 'msg-1';
    const artifact = makeReadyArtifact(sessionId, messageId);

    await saveWalkthrough(rootDir, sessionId, artifact);

    const dir = getPiwinSessionWalkthroughDir(rootDir, sessionId);
    const entries = await readdir(dir);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.endsWith('.json')).toBe(true);
  });

  it('round-trips an artifact via save then load', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-wt-'));
    const sessionId = 'sess-1';
    const messageId = 'msg-1';
    const artifact = makeReadyArtifact(sessionId, messageId);

    await saveWalkthrough(rootDir, sessionId, artifact);
    const loaded = await loadWalkthrough(rootDir, sessionId, messageId);

    expect(loaded).not.toBeNull();
    expect(loaded?.status).toBe('ready');
    expect(loaded?.messageId).toBe(messageId);
    if (loaded?.status === 'ready') {
      expect(loaded.markdown).toBe(artifact.markdown);
    }
  });

  it('loadWalkthrough returns null when file does not exist', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-wt-'));
    const loaded = await loadWalkthrough(rootDir, 'sess-x', 'msg-x');
    expect(loaded).toBeNull();
  });

  it('messageId cannot escape session dir (path traversal rejected)', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-wt-'));
    expect(() => getPiwinSessionWalkthroughPath(rootDir, 's', '..')).toThrow();
    expect(() => getPiwinSessionWalkthroughPath(rootDir, 's', 'a/b')).toThrow();
    expect(() => getPiwinSessionWalkthroughPath(rootDir, 's', 'a\0b')).toThrow();
    expect(() => getPiwinSessionWalkthroughPath(rootDir, '..', 'm')).toThrow();
    expect(() => getPiwinSessionWalkthroughPath(rootDir, 'a/b', 'm')).toThrow();
  });

  it('listWalkthroughs returns only valid-version artifacts', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-wt-'));
    const sessionId = 'sess-1';
    const messageId = 'msg-1';
    await writeTranscript(rootDir, makeTranscript(sessionId, [messageId]));

    // Valid artifact.
    await saveWalkthrough(rootDir, sessionId, makeReadyArtifact(sessionId, messageId));

    // Invalid-version artifact written directly to the dir.
    const dir = getPiwinSessionWalkthroughDir(rootDir, sessionId);
    const badPath = join(dir, 'bad.json');
    await writeFile(
      badPath,
      JSON.stringify({ ...makeReadyArtifact(sessionId, 'bad'), version: 99 }),
      'utf8',
    );

    const list = await listWalkthroughs(rootDir, sessionId);
    expect(list).toHaveLength(1);
    expect(list[0]?.messageId).toBe(messageId);
  });

  it('listWalkthroughs returns empty when transcript not found', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-wt-'));
    const sessionId = 'sess-1';
    const messageId = 'msg-1';
    await saveWalkthrough(rootDir, sessionId, makeReadyArtifact(sessionId, messageId));
    // No transcript written.
    const list = await listWalkthroughs(rootDir, sessionId);
    expect(list).toEqual([]);
  });

  it('listWalkthroughs skips orphan artifacts (message no longer in transcript)', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-wt-'));
    const sessionId = 'sess-1';
    const liveId = 'msg-live';
    const orphanId = 'msg-orphan';
    await writeTranscript(rootDir, makeTranscript(sessionId, [liveId]));

    await saveWalkthrough(rootDir, sessionId, makeReadyArtifact(sessionId, liveId));
    await saveWalkthrough(rootDir, sessionId, makeReadyArtifact(sessionId, orphanId));

    const list = await listWalkthroughs(rootDir, sessionId);
    expect(list).toHaveLength(1);
    expect(list[0]?.messageId).toBe(liveId);
  });

  it('raw evidence is not present in saved file', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-wt-'));
    const sessionId = 'sess-1';
    const messageId = 'msg-1';
    const artifact = makeReadyArtifact(sessionId, messageId);
    await saveWalkthrough(rootDir, sessionId, artifact);

    const filePath = getPiwinSessionWalkthroughPath(rootDir, sessionId, messageId);
    const raw = await readFile(filePath, 'utf8');
    // The artifact only carries metadata + markdown; no raw tool output fields.
    expect(raw).not.toContain('rawEvidence');
    expect(raw).not.toContain('toolOutput');
    expect(raw).toContain('markdown');
  });

  it('deleteWalkthrough removes the artifact file', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-wt-'));
    const sessionId = 'sess-1';
    const messageId = 'msg-1';
    await saveWalkthrough(rootDir, sessionId, makeReadyArtifact(sessionId, messageId));

    await deleteWalkthrough(rootDir, sessionId, messageId);
    const loaded = await loadWalkthrough(rootDir, sessionId, messageId);
    expect(loaded).toBeNull();
  });

  it('deleteWalkthrough is a no-op when file missing', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-wt-'));
    await expect(deleteWalkthrough(rootDir, 'sess-1', 'msg-1')).resolves.toBeUndefined();
  });

  it('deleteSessionWalkthroughs removes the walkthroughs directory', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-wt-'));
    const sessionId = 'sess-1';
    await saveWalkthrough(rootDir, sessionId, makeReadyArtifact(sessionId, 'msg-1'));
    await saveWalkthrough(rootDir, sessionId, makeReadyArtifact(sessionId, 'msg-2'));

    const dir = getPiwinSessionWalkthroughDir(rootDir, sessionId);
    await deleteSessionWalkthroughs(rootDir, sessionId);

    await expect(readdir(dir)).rejects.toThrow();
  });

  it('deleteSessionWalkthroughs is a no-op when dir missing', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-wt-'));
    await expect(deleteSessionWalkthroughs(rootDir, 'sess-1')).resolves.toBeUndefined();
  });

  it('saveWalkthrough overwrites existing artifact for same messageId', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-wt-'));
    const sessionId = 'sess-1';
    const messageId = 'msg-1';
    const first = makeReadyArtifact(sessionId, messageId);
    await saveWalkthrough(rootDir, sessionId, first);

    const updated: ReadyWalkthroughArtifact = {
      ...first,
      markdown: '# Updated',
      updatedAt: '2026-08-02T00:00:00.000Z',
    };
    await saveWalkthrough(rootDir, sessionId, updated);

    const loaded = await loadWalkthrough(rootDir, sessionId, messageId);
    expect(loaded?.status).toBe('ready');
    if (loaded?.status === 'ready') {
      expect(loaded.markdown).toBe('# Updated');
    }
  });
});
