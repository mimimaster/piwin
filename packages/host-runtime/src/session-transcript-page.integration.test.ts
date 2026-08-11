import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type {
  SessionIndexDocument,
  SessionResumeData,
  SessionTranscriptDocument,
  SessionTranscriptPageData,
} from '@piwin/contracts';
import {
  SESSION_TRANSCRIPT_PAGE_DEFAULT_BYTES,
  SESSION_TRANSCRIPT_PAGE_DEFAULT_ITEMS,
} from '@piwin/contracts';
import { HostRuntime } from './host-runtime.js';
import { getPiwinSessionIndexPath, getPiwinSessionTranscriptPath } from './paths.js';

describe('HostRuntime transcript paging', () => {
  it('resumes with a bounded tail and fetches an older Host-owned page', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-host-transcript-page-'));
    const sessionId = 'bounded-transcript-session';
    const projectPath = '/tmp/bounded-transcript-project';
    const messages = Array.from({ length: 80 }, (_, index) => ({
      id: `message-${index}`,
      role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
      text: index === 0 ? 'oldest durable evidence' : `message body ${index}`,
      createdAt: new Date(index * 1_000).toISOString(),
      status: 'done' as const,
    }));
    const index: SessionIndexDocument = {
      version: 1,
      sessions: [
        {
          id: sessionId,
          projectPath,
          name: 'Bounded transcript',
          createdAt: '2026-08-09T00:00:00.000Z',
          updatedAt: '2026-08-09T00:01:00.000Z',
          messageCount: messages.length,
        },
      ],
    };
    const transcript: SessionTranscriptDocument = {
      version: 1,
      sessionId,
      projectPath,
      messages,
      updatedAt: '2026-08-09T00:01:00.000Z',
    };
    const indexPath = getPiwinSessionIndexPath(rootDir);
    const transcriptPath = getPiwinSessionTranscriptPath(rootDir, sessionId);
    await mkdir(join(rootDir, 'sessions-index'), { recursive: true });
    await mkdir(join(rootDir, 'sessions', sessionId), { recursive: true });
    await writeFile(indexPath, `${JSON.stringify(index)}\n`, 'utf8');
    await writeFile(transcriptPath, `${JSON.stringify(transcript)}\n`, 'utf8');

    const runtime = new HostRuntime({ mode: 'sdk', mock: true, piwinRoot: rootDir });
    try {
      const resumeResponse = await runtime.handleCommand({
        type: 'session/resume',
        sessionId,
      });
      expect(resumeResponse.success).toBe(true);
      if (!resumeResponse.success) throw new Error(resumeResponse.error);
      const resume = resumeResponse.data as SessionResumeData;
      expect(resume.messages).toHaveLength(SESSION_TRANSCRIPT_PAGE_DEFAULT_ITEMS);
      expect(resume.messages[0]?.id).toBe('message-30');
      expect(resume.messages.at(-1)?.id).toBe('message-79');
      expect(resume.transcriptPage?.totalCount).toBe(80);
      const olderCursor = resume.transcriptPage?.olderCursor;
      if (olderCursor === undefined) throw new Error('expected older transcript cursor');

      const olderResponse = await runtime.handleCommand({
        type: 'session/transcript-page',
        query: {
          sessionId,
          limit: SESSION_TRANSCRIPT_PAGE_DEFAULT_ITEMS,
          maximumBytes: SESSION_TRANSCRIPT_PAGE_DEFAULT_BYTES,
          beforeCursor: olderCursor,
        },
      });
      expect(olderResponse.success).toBe(true);
      if (!olderResponse.success) throw new Error(olderResponse.error);
      const older = olderResponse.data as SessionTranscriptPageData;
      expect(older.status).toBe('page');
      if (older.status !== 'page') return;
      expect(older.messages).toHaveLength(30);
      expect(older.messages[0]?.id).toBe('message-0');
      expect(older.messages.at(-1)?.id).toBe('message-29');
      expect(older.page.messageBytes).toBeLessThanOrEqual(SESSION_TRANSCRIPT_PAGE_DEFAULT_BYTES);
    } finally {
      await runtime.dispose();
    }
  });

  it('keeps export/fork/truncate Host-authoritative when the shell owns only a page', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-host-transcript-ops-'));
    const sessionId = 'paged-operations-session';
    const projectPath = '/tmp/paged-operations-project';
    const messages = Array.from({ length: 40 }, (_, index) => ({
      id: `message-${index}`,
      role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
      text: index === 0 ? 'oldest export evidence' : `operation message ${index}`,
      createdAt: new Date(index * 1_000).toISOString(),
      status: 'done' as const,
    }));
    const index: SessionIndexDocument = {
      version: 1,
      sessions: [
        {
          id: sessionId,
          projectPath,
          name: 'Paged operations',
          createdAt: '2026-08-09T00:00:00.000Z',
          updatedAt: '2026-08-09T00:01:00.000Z',
          messageCount: messages.length,
        },
      ],
    };
    const transcript: SessionTranscriptDocument = {
      version: 1,
      sessionId,
      projectPath,
      messages,
      updatedAt: '2026-08-09T00:01:00.000Z',
    };
    const indexPath = getPiwinSessionIndexPath(rootDir);
    const transcriptPath = getPiwinSessionTranscriptPath(rootDir, sessionId);
    await mkdir(join(rootDir, 'sessions-index'), { recursive: true });
    await mkdir(join(rootDir, 'sessions', sessionId), { recursive: true });
    await writeFile(indexPath, `${JSON.stringify(index)}\n`, 'utf8');
    await writeFile(transcriptPath, `${JSON.stringify(transcript)}\n`, 'utf8');

    const runtime = new HostRuntime({ mode: 'sdk', mock: true, piwinRoot: rootDir });
    try {
      const resumeResponse = await runtime.handleCommand({ type: 'session/resume', sessionId });
      expect(resumeResponse.success).toBe(true);
      if (!resumeResponse.success) throw new Error(resumeResponse.error);
      expect((resumeResponse.data as SessionResumeData).messages).toHaveLength(40);

      const exportPath = join(rootDir, 'exports', 'complete.md');
      const exportResponse = await runtime.handleCommand({
        type: 'session/export',
        sessionId,
        format: 'md',
        outputPath: exportPath,
      });
      expect(exportResponse.success).toBe(true);
      expect(await readFile(exportPath, 'utf8')).toContain('oldest export evidence');

      const forkResponse = await runtime.handleCommand({
        type: 'session/fork',
        sessionId,
        messageId: 'message-3',
        workspaceStrategy: 'shared',
        messageProjection: 'none',
      });
      expect(forkResponse.success).toBe(true);
      if (!forkResponse.success) throw new Error(forkResponse.error);
      const forkData = forkResponse.data as {
        sessionId: string;
        messages?: SessionTranscriptDocument['messages'];
      };
      expect(forkData.messages).toBeUndefined();
      const forkResume = await runtime.handleCommand({
        type: 'session/resume',
        sessionId: forkData.sessionId,
      });
      expect(forkResume.success).toBe(true);
      if (!forkResume.success) throw new Error(forkResume.error);
      expect((forkResume.data as SessionResumeData).messages).toHaveLength(4);

      const truncateResponse = await runtime.handleCommand({
        type: 'session/truncate-from',
        sessionId,
        messageId: 'message-20',
        messageProjection: 'tail',
      });
      expect(truncateResponse.success).toBe(true);
      if (!truncateResponse.success) throw new Error(truncateResponse.error);
      const truncateData = truncateResponse.data as {
        remainingCount: number;
        messages?: SessionTranscriptDocument['messages'];
        transcriptPage?: { totalCount: number };
      };
      expect(truncateData.remainingCount).toBe(20);
      expect(truncateData.messages).toHaveLength(20);
      expect(truncateData.transcriptPage?.totalCount).toBe(20);
      expect(truncateData.messages?.[0]?.id).toBe('message-0');
    } finally {
      await runtime.dispose();
    }
  });
});
