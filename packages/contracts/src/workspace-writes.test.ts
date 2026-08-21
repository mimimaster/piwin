import { describe, expect, it } from 'vitest';
import type { SessionTranscriptMessage, ToolPresentation } from './index.js';
import {
  collectOffPathWorkspaceWrites,
  collectWorkspaceWrites,
  mergeWorkspaceWrites,
  workspaceWritesFromMessage,
} from './workspace-writes.js';

function presentation(partial: Partial<ToolPresentation> & Pick<ToolPresentation, 'kind'>): ToolPresentation {
  return { title: partial.title ?? partial.kind, ...partial };
}

function assistant(
  id: string,
  writes?: SessionTranscriptMessage['workspaceWrites'],
  tools?: SessionTranscriptMessage['tools'],
): SessionTranscriptMessage {
  return {
    id,
    role: 'assistant',
    text: id,
    createdAt: '2026-08-21T00:00:00.000Z',
    status: 'done',
    ...(writes ? { workspaceWrites: writes } : {}),
    ...(tools ? { tools } : {}),
  };
}

function user(id: string): SessionTranscriptMessage {
  return {
    id,
    role: 'user',
    text: id,
    createdAt: '2026-08-21T00:00:00.000Z',
    status: 'done',
  };
}

describe('collectWorkspaceWrites', () => {
  it('collects filesystem edit / write / str_replace paths', () => {
    expect(
      collectWorkspaceWrites(
        presentation({
          kind: 'filesystem',
          actionVerb: 'Edited',
          targetPaths: ['src/a.ts'],
        }),
      ),
    ).toEqual({ files: ['src/a.ts'], hasUnknownWrites: false });
    expect(
      collectWorkspaceWrites(
        presentation({
          kind: 'filesystem',
          actionVerb: 'Wrote',
          changedPaths: ['notes.md'],
        }),
      ),
    ).toEqual({ files: ['notes.md'], hasUnknownWrites: false });
    expect(
      collectWorkspaceWrites(
        presentation({
          kind: 'filesystem',
          actionVerb: 'Edited',
          targetPaths: ['src/app.ts'],
          title: 'str_replace',
        }),
      ),
    ).toEqual({ files: ['src/app.ts'], hasUnknownWrites: false });
  });

  it('marks a mutating bash command with no paths as an unknown write', () => {
    for (const command of [
      'rm -rf dist',
      'mkdir -p build && touch build/.keep',
      'sed -i "" s/a/b/ src/a.ts',
      'echo hi > notes.txt',
      'git checkout main',
      'pnpm add -D vitest',
      'sudo chmod +x run.sh',
      'CI=1 cp a.ts b.ts',
    ]) {
      expect(
        collectWorkspaceWrites(presentation({ kind: 'shell', actionVerb: 'Ran command', command })),
        command,
      ).toEqual({ files: [], hasUnknownWrites: true });
    }
  });

  it('leaves read-only bash commands unmarked so the confirm card stays rare', () => {
    for (const command of [
      'ls -la',
      'pnpm test',
      'git status --porcelain',
      'git log --oneline -n 5',
      'rg "add" src',
      'cat package.json',
      'node script.js > /dev/null 2>&1',
      'pnpm typecheck 2>&1',
    ]) {
      expect(
        collectWorkspaceWrites(presentation({ kind: 'shell', actionVerb: 'Ran command', command })),
        command,
      ).toBeNull();
    }
  });

  it('trusts Host-reported changedPaths over the command guess', () => {
    expect(
      collectWorkspaceWrites(
        presentation({
          kind: 'shell',
          actionVerb: 'Ran command',
          command: 'ls',
          changedPaths: ['src/a.ts'],
        }),
      ),
    ).toEqual({ files: ['src/a.ts'], hasUnknownWrites: false });
  });

  it('returns null for read-only tools', () => {
    expect(
      collectWorkspaceWrites(
        presentation({
          kind: 'filesystem',
          actionVerb: 'Read',
          targetPaths: ['src/a.ts'],
        }),
      ),
    ).toBeNull();
    expect(
      collectWorkspaceWrites(presentation({ kind: 'web', actionVerb: 'Searched' })),
    ).toBeNull();
  });
});

describe('off-path workspace writes', () => {
  it('collects writes after the LCA and ignores the destination path', () => {
    const activePath = [
      user('u1'),
      assistant('a1'),
      user('u2a'),
      assistant('a2a', { files: ['src/old.ts'], hasUnknownWrites: false }),
    ];
    const writes = collectOffPathWorkspaceWrites({
      activePath,
      targetMessageId: 'u2b',
      parentById: {
        u1: null,
        a1: 'u1',
        u2a: 'a1',
        a2a: 'u2a',
        u2b: 'a1',
      },
    });
    expect(writes).toEqual({ files: ['src/old.ts'], hasUnknownWrites: false });
  });

  it('returns null when the target is already on the active path', () => {
    expect(
      collectOffPathWorkspaceWrites({
        activePath: [user('u1'), assistant('a1', { files: ['x.ts'], hasUnknownWrites: false })],
        targetMessageId: 'a1',
        parentById: { u1: null, a1: 'u1' },
      }),
    ).toBeNull();
  });

  it('falls back to tool presentations when metadata is missing', () => {
    const message = assistant('a1', undefined, [
      {
        toolCallId: 't1',
        toolName: 'edit',
        status: 'done',
        output: '',
        presentation: presentation({
          kind: 'filesystem',
          actionVerb: 'Edited',
          targetPaths: ['legacy.ts'],
        }),
      },
    ]);
    expect(workspaceWritesFromMessage(message)).toEqual({
      files: ['legacy.ts'],
      hasUnknownWrites: false,
    });
  });

  it('merges unknown writes across rows', () => {
    const merged = mergeWorkspaceWrites(
      { files: ['a.ts'], hasUnknownWrites: false },
      { files: [], hasUnknownWrites: true },
    );
    expect(merged).toEqual({ files: ['a.ts'], hasUnknownWrites: true });
  });
});
