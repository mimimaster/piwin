import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { USER_AUTHORED_GENERATION, openSessionTranscriptStore } from '@piwin/session';
import { HostRuntime } from '../host-runtime.js';
import {
  getPiwinSessionMediaDir,
  getPiwinSessionTranscriptDatabasePath,
} from '../paths.js';

describe('session/resources', () => {
  it('projects recorded identities and ignores URLs in message text', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-session-resources-'));
    const runtime = new HostRuntime({ mode: 'sdk', mock: true, piwinRoot: rootDir });
    try {
      const projectPath = join(rootDir, 'demo');
      const opened = await runtime.handleCommand({ type: 'project/open', path: projectPath });
      expect(opened.success).toBe(true);
      const trusted = await runtime.handleCommand({ type: 'project/trust', path: projectPath });
      expect(trusted.success).toBe(true);
      const created = await runtime.handleCommand({
        type: 'session/create',
        input: { projectPath, sessionName: 'resources' },
      });
      expect(created.success).toBe(true);
      if (!created.success) throw new Error(created.error);
      const sessionId = (created.data as { sessionId: string }).sessionId;
      const store = await openSessionTranscriptStore({
        dbPath: getPiwinSessionTranscriptDatabasePath(rootDir, sessionId),
        sessionId,
        projectPath,
      });
      const user = await store.appendMessage({
        id: 'u1',
        runtimeGenerationId: USER_AUTHORED_GENERATION,
        backendMessageId: 'b-u1',
        role: 'user',
        text: 'see https://evil.example/secret',
        status: 'done',
        createdAt: '2026-11-04T00:00:00.000Z',
        attachments: [
          {
            id: 'img-1',
            kind: 'media',
            path: join(rootDir, 'media', sessionId, 'img-1.png'),
            mimeType: 'image/png',
            name: 'shot.png',
            byteSize: 8,
            source: 'paste',
          },
        ],
        metadata: { skillId: 'eli5' },
      });
      expect(user.ok).toBe(true);
      const assistant = await store.appendMessage({
        id: 'a1',
        runtimeGenerationId: 'gen-1',
        backendMessageId: 'b-a1',
        role: 'assistant',
        text: 'opened https://evil.example/secret',
        status: 'done',
        createdAt: '2026-11-04T00:00:01.000Z',
        tools: [
          {
            toolCallId: 't-search',
            toolName: 'web_search',
            status: 'done',
            output: JSON.stringify({
              query: 'tauri',
              providerId: 'brave',
              hits: [{ title: 'Tauri', url: 'https://tauri.app/?x=1', snippet: '' }],
            }),
          },
        ],
        metadata: {
          workspaceWrites: { files: ['src/login.ts'], hasUnknownWrites: false },
        },
      });
      expect(assistant.ok).toBe(true);
      store.close();

      await mkdir(join(projectPath, 'src'), { recursive: true });
      await writeFile(join(projectPath, 'src', 'login.ts'), 'export {};');
      const mediaDir = getPiwinSessionMediaDir(rootDir, sessionId);
      await mkdir(mediaDir, { recursive: true });
      await writeFile(join(mediaDir, 'gen-9.png'), Buffer.from([137, 80, 78, 71]));
      await writeFile(
        join(mediaDir, 'gen-9.json'),
        JSON.stringify({
          source: 'generated',
          kind: 'image',
          createdAt: '2026-11-04T00:00:02.000Z',
        }),
      );

      const listed = await runtime.handleCommand({ type: 'session/resources', sessionId });
      expect(listed.success).toBe(true);
      if (!listed.success) throw new Error(listed.error);
      const data = listed.data as {
        sessionId: string;
        resources: Array<{ id: string; target?: string; availability?: string }>;
      };
      expect(data.sessionId).toBe(sessionId);
      expect(data.resources.map((item) => item.id)).toEqual([
        'att:u1:img-1',
        'skill:u1:eli5',
        'search:a1:t-search:0',
        'write:a1:0',
        'gen:gen-9',
      ]);
      expect(data.resources.some((item) => item.target?.includes('evil.example'))).toBe(false);
      expect(data.resources.find((item) => item.id === 'search:a1:t-search:0')?.target).toBe(
        'https://tauri.app/',
      );
      expect(data.resources.find((item) => item.id === 'write:a1:0')?.availability).toBe(
        'available',
      );
    } finally {
      await runtime.dispose();
    }
  });

  it('finds a source older than the newest 100 messages', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-session-resources-tail-'));
    const runtime = new HostRuntime({ mode: 'sdk', mock: true, piwinRoot: rootDir });
    try {
      const projectPath = join(rootDir, 'demo');
      expect((await runtime.handleCommand({ type: 'project/open', path: projectPath })).success).toBe(
        true,
      );
      expect((await runtime.handleCommand({ type: 'project/trust', path: projectPath })).success).toBe(
        true,
      );
      const created = await runtime.handleCommand({
        type: 'session/create',
        input: { projectPath, sessionName: 'deep-tail' },
      });
      expect(created.success).toBe(true);
      if (!created.success) throw new Error(created.error);
      const sessionId = (created.data as { sessionId: string }).sessionId;
      const store = await openSessionTranscriptStore({
        dbPath: getPiwinSessionTranscriptDatabasePath(rootDir, sessionId),
        sessionId,
        projectPath,
      });
      const first = await store.appendMessage({
        id: 'u-old',
        runtimeGenerationId: USER_AUTHORED_GENERATION,
        backendMessageId: 'b-old',
        role: 'user',
        text: 'old',
        status: 'done',
        createdAt: '2026-11-04T00:00:00.000Z',
        metadata: { skillId: 'eli5' },
      });
      expect(first.ok).toBe(true);
      for (let index = 0; index < 100; index += 1) {
        const written = await store.appendMessage({
          id: `u-fill-${String(index)}`,
          runtimeGenerationId: USER_AUTHORED_GENERATION,
          backendMessageId: `b-fill-${String(index)}`,
          role: 'user',
          text: `fill ${String(index)}`,
          status: 'done',
          createdAt: '2026-11-04T00:00:01.000Z',
        });
        expect(written.ok).toBe(true);
      }
      store.close();
      const listed = await runtime.handleCommand({ type: 'session/resources', sessionId });
      expect(listed.success).toBe(true);
      if (!listed.success) throw new Error(listed.error);
      const data = listed.data as { resources: Array<{ id: string }> };
      expect(data.resources.map((item) => item.id)).toEqual(['skill:u-old:eli5']);
    } finally {
      await runtime.dispose();
    }
  });

  it('fails for an unknown session', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-session-resources-missing-'));
    const runtime = new HostRuntime({ mode: 'sdk', mock: true, piwinRoot: rootDir });
    try {
      const listed = await runtime.handleCommand({
        type: 'session/resources',
        sessionId: 'missing',
      });
      expect(listed.success).toBe(false);
    } finally {
      await runtime.dispose();
    }
  });
});
