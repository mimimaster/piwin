import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SessionIndexDocument, SessionTranscriptDocument } from '@piwin/contracts';
import { HostRuntime } from './host-runtime.js';
import { getPiwinSessionIndexPath, getPiwinSessionTranscriptPath } from './paths.js';

describe('HostRuntime session/export', () => {
  it('writes Markdown export matching transcript text and redacts tools', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-export-'));
    const sessionId = 'export-session-001';
    const projectPath = '/tmp/export-project';

    const indexPath = getPiwinSessionIndexPath(rootDir);
    await mkdir(join(rootDir, 'sessions-index'), { recursive: true });
    const indexDoc: SessionIndexDocument = {
      version: 1,
      sessions: [
        {
          id: sessionId,
          projectPath,
          name: 'Export demo',
          createdAt: '2026-07-21T10:00:00.000Z',
          updatedAt: '2026-07-21T10:00:00.000Z',
          messageCount: 2,
          lastPreview: 'hello',
        },
      ],
    };
    await writeFile(indexPath, `${JSON.stringify(indexDoc, null, 2)}\n`, 'utf8');

    const transcriptPath = getPiwinSessionTranscriptPath(rootDir, sessionId);
    await mkdir(join(rootDir, 'sessions', sessionId), { recursive: true });
    const transcript: SessionTranscriptDocument = {
      version: 1,
      sessionId,
      projectPath,
      updatedAt: '2026-07-21T10:00:00.000Z',
      messages: [
        {
          id: 'u1',
          role: 'user',
          text: 'hello export',
          createdAt: '2026-07-21T10:00:00.000Z',
          status: 'done',
        },
        {
          id: 'a1',
          role: 'assistant',
          text: 'assistant reply body',
          createdAt: '2026-07-21T10:00:01.000Z',
          status: 'done',
          tools: [
            {
              toolCallId: 'tc1',
              toolName: 'bash',
              status: 'done',
              output: 'SECRET_VALUE=42',
            },
          ],
        },
      ],
    };
    await writeFile(transcriptPath, `${JSON.stringify(transcript, null, 2)}\n`, 'utf8');

    const runtime = new HostRuntime({ mode: 'sdk', mock: true, piwinRoot: rootDir });
    const outPath = join(rootDir, 'out', 'demo.md');
    const response = await runtime.handleCommand({
      type: 'session/export',
      sessionId,
      format: 'md',
      redactTools: true,
      outputPath: outPath,
    });
    expect(response.success, JSON.stringify(response)).toBe(true);
    if (!response.success) throw new Error(response.error);
    const data = response.data as {
      path: string;
      format: string;
      redactTools: boolean;
      byteLength: number;
    };
    expect(data.path).toBe(outPath);
    expect(data.format).toBe('md');
    expect(data.redactTools).toBe(true);
    expect(data.byteLength).toBeGreaterThan(0);

    const content = await readFile(outPath, 'utf8');
    expect(content).toContain('hello export');
    expect(content).toContain('assistant reply body');
    expect(content).toContain('[tool output redacted]');
    expect(content).not.toContain('SECRET_VALUE=42');

    await runtime.dispose();
  });

  it('compacts a temporary transcript snapshot and writes only the summary', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-compact-export-'));
    const runtime = new HostRuntime({ mode: 'sdk', mock: true, piwinRoot: rootDir });
    const created = await runtime.handleCommand({
      type: 'session/create',
      input: { projectPath: '/tmp/compact-export-project' },
    });
    expect(created.success).toBe(true);
    if (!created.success) throw new Error(created.error);
    const sessionId = (created.data as { sessionId: string }).sessionId;
    const indexPath = getPiwinSessionIndexPath(rootDir);
    // Seed through the Host prompt path so the SQLite transcript store (v2
    // authority) sees the user turn. Writing legacy JSON after create is too
    // late: create already opens an empty authoritative store.
    const seeded = await runtime.handleCommand({
      type: 'session/prompt',
      sessionId,
      input: { text: 'Keep this context for the next task.' },
    });
    expect(seeded.success).toBe(true);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const messages = await runtime.handleCommand({
        type: 'session/messages',
        sessionId,
      });
      if (
        messages.success &&
        (messages.data as { messages: Array<{ role: string }> }).messages.some(
          (row) => row.role === 'user',
        )
      ) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const outputPath = join(rootDir, 'out', 'compact.md');

    const response = await runtime.handleCommand({
      type: 'session/compact-export',
      sessionId,
      outputPath,
    });
    expect(response.success).toBe(true);
    if (!response.success) throw new Error(response.error);
    const data = response.data as {
      path: string;
      format: string;
      byteLength: number;
      summary?: string;
    };
    expect(data.path).toBe(outputPath);
    expect(data.format).toBe('md');
    expect(data.summary).toContain('Mock summary');
    expect(data.byteLength).toBeGreaterThan(0);

    const content = await readFile(outputPath, 'utf8');
    expect(content).toBe('Mock summary of prior turns for UI testing.\n');
    // Compact-export must not mutate the live product transcript.
    const liveMessages = await runtime.handleCommand({
      type: 'session/messages',
      sessionId,
    });
    expect(liveMessages.success).toBe(true);
    if (!liveMessages.success) throw new Error(liveMessages.error);
    expect(
      (liveMessages.data as { messages: Array<{ text: string }> }).messages.some((row) =>
        row.text.includes('Keep this context for the next task.'),
      ),
    ).toBe(true);
    const indexAfter = JSON.parse(await readFile(indexPath, 'utf8')) as SessionIndexDocument;
    expect(indexAfter.sessions).toHaveLength(1);

    await runtime.dispose();
  });
});
