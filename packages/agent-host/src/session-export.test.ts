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
    expect(response.success).toBe(true);
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
});
