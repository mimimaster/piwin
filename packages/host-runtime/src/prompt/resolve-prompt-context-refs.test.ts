import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PromptContextRef, SessionTranscriptMessage } from '@piwin/contracts';
import {
  listBoundedFolderForRef,
  readBoundedFileForRef,
  resolvePromptContextRefs,
} from './resolve-prompt-context-refs.js';

function emptyDeps() {
  return {
    loadTranscriptMessages: async (): Promise<SessionTranscriptMessage[]> => [],
  };
}

describe('resolvePromptContextRefs', () => {
  it('formats selection refs with path range or label fallback', async () => {
    const withPath: PromptContextRef = {
      kind: 'selection',
      relativePath: 'src/a.ts',
      lineStart: 2,
      lineEnd: 4,
      snapshotText: 'const value = 1;',
      label: 'ignored-when-path',
    };
    const bare: PromptContextRef = {
      kind: 'selection',
      snapshotText: 'plain selection',
      label: 'clipboard',
    };
    const text = await resolvePromptContextRefs(emptyDeps(), [withPath, bare]);
    expect(text).toContain('[selection-reference: src/a.ts:2-4]');
    expect(text).toContain('const value = 1;');
    expect(text).toContain('[selection-reference: clipboard]');
    expect(text).toContain('plain selection');
  });

  it('bounds selection snapshot text to 8000 chars', async () => {
    const huge = 'x'.repeat(12_000);
    const text = await resolvePromptContextRefs(emptyDeps(), [
      { kind: 'selection', snapshotText: huge, label: 'big' },
    ]);
    const body = text.split('\n').slice(1).join('\n');
    expect(body.length).toBe(8000);
  });

  it('resolves main-message and side-chat-message from transcript deps', async () => {
    const deps = {
      loadTranscriptMessages: async (sessionId: string): Promise<SessionTranscriptMessage[]> => {
        if (sessionId === 'main-1') {
          return [
            {
              id: 'm1',
              role: 'assistant',
              text: 'main body',
              createdAt: '2026-08-08T00:00:00.000Z',
              status: 'done',
            },
          ];
        }
        if (sessionId === 'side-1') {
          return [
            {
              id: 's1',
              role: 'assistant',
              text: 'side body',
              createdAt: '2026-08-08T00:00:00.000Z',
              status: 'done',
            },
          ];
        }
        return [];
      },
    };
    const text = await resolvePromptContextRefs(deps, [
      {
        kind: 'main-message',
        sourceSessionId: 'main-1',
        messageId: 'm1',
        label: 'Main',
      },
      {
        kind: 'side-chat-message',
        sideChatSessionId: 'side-1',
        messageId: 's1',
        label: 'Side',
      },
    ]);
    expect(text).toContain('[main-message-reference: Main]');
    expect(text).toContain('main body');
    expect(text).toContain('[side-chat-reference: Side]');
    expect(text).toContain('side body');
  });

  it('reads file refs under project root and rejects path escape', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-ctx-ref-'));
    await writeFile(join(root, 'hello.ts'), 'export const n = 1;\n', 'utf8');
    const ok = await readBoundedFileForRef(root, 'hello.ts');
    expect(ok).toContain('export const n = 1;');
    const escaped = await readBoundedFileForRef(root, '../outside.ts');
    expect(escaped).toBeUndefined();
    const resolved = await resolvePromptContextRefs(emptyDeps(), [
      {
        kind: 'file',
        projectPath: root,
        relativePath: 'hello.ts',
        lineStart: 1,
        label: 'hello',
      },
    ]);
    expect(resolved).toContain('[file-reference: hello.ts:1]');
    expect(resolved).toContain('export const n = 1;');
  });

  it('lists one folder level with trailing slash for directories', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-ctx-folder-'));
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'src', 'a.ts'), 'a', 'utf8');
    await mkdir(join(root, 'src', 'nested'));
    await writeFile(join(root, 'src', 'nested', 'b.ts'), 'b', 'utf8');
    await mkdir(join(root, 'src', 'node_modules'));
    const listing = await listBoundedFolderForRef(root, 'src');
    expect(listing).toBeDefined();
    expect(listing).toContain('- a.ts');
    expect(listing).toContain('- nested/');
    expect(listing).not.toContain('node_modules');
    expect(listing).not.toContain('b.ts');
    const resolved = await resolvePromptContextRefs(emptyDeps(), [
      {
        kind: 'folder',
        projectPath: root,
        relativePath: 'src',
        label: 'src/',
      },
    ]);
    expect(resolved).toContain('[folder-reference: src]');
    expect(resolved).toContain('- a.ts');
  });

  it('rejects file refs whose project root is not registered', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-ctx-ref-unregistered-'));
    await writeFile(join(root, 'secret.txt'), 'secret-body', 'utf8');
    const deps = {
      loadTranscriptMessages: async (): Promise<SessionTranscriptMessage[]> => [],
      isRegisteredProjectRoot: async (projectPath: string): Promise<boolean> => {
        expect(projectPath).toBe(root);
        return false;
      },
    };
    const text = await resolvePromptContextRefs(deps, [
      { kind: 'file', projectPath: root, relativePath: 'secret.txt', label: 's' },
    ]);
    expect(text).not.toContain('secret-body');
  });

  it('rejects folder refs whose project root is not registered', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-ctx-ref-folder-unreg-'));
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'src', 'a.ts'), 'a', 'utf8');
    const deps = {
      loadTranscriptMessages: async (): Promise<SessionTranscriptMessage[]> => [],
      isRegisteredProjectRoot: async (): Promise<boolean> => false,
    };
    const text = await resolvePromptContextRefs(deps, [
      { kind: 'folder', projectPath: root, relativePath: 'src', label: 'src/' },
    ]);
    expect(text).not.toContain('a.ts');
  });

  it('readBoundedFileForRef honors the optional registered-root check', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-ctx-ref-direct-'));
    await writeFile(join(root, 'a.ts'), 'body', 'utf8');
    const blocked = await readBoundedFileForRef(root, 'a.ts', async () => false);
    expect(blocked).toBeUndefined();
    const allowed = await readBoundedFileForRef(root, 'a.ts', async () => true);
    expect(allowed).toContain('body');
  });

  it('formats error/diff/terminal snapshot kinds', async () => {
    const text = await resolvePromptContextRefs(emptyDeps(), [
      {
        kind: 'error',
        title: 'TS2322',
        detail: 'Type string is not assignable',
        label: 'err',
      },
      {
        kind: 'diff',
        projectPath: '/tmp/p',
        snapshotText: '--- a\n+++ b',
        label: 'd',
      },
      {
        kind: 'terminal-output',
        snapshotText: 'pnpm test failed',
        label: 'term',
      },
    ]);
    expect(text).toContain('[error-reference: TS2322]');
    expect(text).toContain('[diff-reference: d]');
    expect(text).toContain('[terminal-output-reference: term]');
  });
});
