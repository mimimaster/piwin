import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { openSessionTranscriptStore, type SessionTranscriptStore } from '@piwin/session';
import { rebaseForPromptTree } from './session-prompt-rebase.js';
import type { PromptCommand } from './prompt-preparation.js';
import type { SessionLiveContext } from './session-live-context.js';

describe('rebaseForPromptTree (ADR 0064)', () => {
  it('keeps the previous answer when keepPreviousAttempt is set', async () => {
    const { store, context, sessionId } = await openRetryFixture('keep');
    try {
      const result = await rebaseForPromptTree(
        context,
        prompt(sessionId, { retryUserMessageId: 'u2', keepPreviousAttempt: true }),
        undefined,
      );
      expect(result).toBeNull();
      expect(await store.getActiveLeaf()).toBe('u2');
      expect(await store.getMessage('a2')).toBeDefined();
      expect(context.disposeLiveSession).toHaveBeenCalledWith(sessionId, 'branch-switch');
    } finally {
      store.close();
    }
  });

  it('truncates the active attempt before rebasing onto the user row', async () => {
    const { store, context, sessionId } = await openRetryFixture('discard');
    try {
      const result = await rebaseForPromptTree(
        context,
        prompt(sessionId, { retryUserMessageId: 'u2' }),
        undefined,
      );
      expect(result).toBeNull();
      expect(await store.getActiveLeaf()).toBe('u2');
      expect(await store.getMessage('a2')).toBeUndefined();
      expect(await store.listBranchPoints({ previewChars: 40 })).toEqual([]);
    } finally {
      store.close();
    }
  });

  it('refuses an unconfirmed retry that would discard workspace writes', async () => {
    const { store, context, sessionId } = await openRetryFixture('writes', { withWrites: true });
    try {
      const blocked = await rebaseForPromptTree(
        context,
        prompt(sessionId, { retryUserMessageId: 'u2' }),
        undefined,
      );
      expect(blocked?.success).toBe(false);
      if (blocked?.success !== false) {
        throw new Error('expected refusal');
      }
      expect(blocked.error).toContain('retry-discards-writes');
      expect(blocked.problem).toEqual({
        code: 'retry-discards-writes',
        data: { files: ['src/app.ts'], hasUnknownWrites: false },
      });
      expect(await store.getActiveLeaf()).toBe('a2');
      expect(context.disposeLiveSession).not.toHaveBeenCalled();

      const confirmed = await rebaseForPromptTree(
        context,
        prompt(sessionId, { retryUserMessageId: 'u2' }, { confirm: true }),
        undefined,
      );
      expect(confirmed).toBeNull();
      expect(await store.getActiveLeaf()).toBe('u2');
      expect(await store.getMessage('a2')).toBeUndefined();
    } finally {
      store.close();
    }
  });

  it('does not require confirm when the previous answer is kept', async () => {
    const { store, context, sessionId } = await openRetryFixture('keep-writes', {
      withWrites: true,
    });
    try {
      const result = await rebaseForPromptTree(
        context,
        prompt(sessionId, { retryUserMessageId: 'u2', keepPreviousAttempt: true }),
        undefined,
      );
      expect(result).toBeNull();
      expect(await store.getMessage('a2')).toBeDefined();
    } finally {
      store.close();
    }
  });

  it('refuses retry while a foreground run is active', async () => {
    const { store, context, sessionId } = await openRetryFixture('run-active', {
      foreground: true,
    });
    try {
      const result = await rebaseForPromptTree(
        context,
        prompt(sessionId, { retryUserMessageId: 'u2' }),
        undefined,
      );
      expect(result?.success).toBe(false);
      if (result?.success !== false) {
        throw new Error('expected refusal');
      }
      expect(result.error).toContain('run-active');
      expect(context.disposeLiveSession).not.toHaveBeenCalled();
    } finally {
      store.close();
    }
  });

  it('refuses a retry target that is not on the active path', async () => {
    const { store, context, sessionId } = await openRetryFixture('off-path');
    try {
      await store.rebaseActiveLeaf('a1');
      await append(store, 'u2-alt', 'user', 'other direction');
      const result = await rebaseForPromptTree(
        context,
        prompt(sessionId, { retryUserMessageId: 'u2' }),
        undefined,
      );
      expect(result?.success).toBe(false);
      if (result?.success !== false) {
        throw new Error('expected refusal');
      }
      expect(result.error).toContain('retry-target-off-path');
      expect(context.disposeLiveSession).not.toHaveBeenCalled();
    } finally {
      store.close();
    }
  });

  it('trims retryUserMessageId before lookup', async () => {
    const { store, context, sessionId } = await openRetryFixture('trim');
    try {
      const result = await rebaseForPromptTree(
        context,
        prompt(sessionId, { retryUserMessageId: '  u2  ', keepPreviousAttempt: true }),
        undefined,
      );
      expect(result).toBeNull();
      expect(await store.getActiveLeaf()).toBe('u2');
    } finally {
      store.close();
    }
  });

  it('refuses missing, non-user, and retry+branch targets', async () => {
    const { store, context, sessionId } = await openRetryFixture('refusals');
    try {
      const missing = await rebaseForPromptTree(
        context,
        prompt(sessionId, { retryUserMessageId: 'missing' }),
        undefined,
      );
      expect(missing?.success).toBe(false);
      if (missing?.success !== false) {
        throw new Error('expected missing refusal');
      }
      expect(missing.error).toContain('retry-target-not-found');

      const notUser = await rebaseForPromptTree(
        context,
        prompt(sessionId, { retryUserMessageId: 'a2' }),
        undefined,
      );
      expect(notUser?.success).toBe(false);
      if (notUser?.success !== false) {
        throw new Error('expected not-user refusal');
      }
      expect(notUser.error).toContain('retry-target-not-user');

      const conflict = await rebaseForPromptTree(
        context,
        prompt(sessionId, { retryUserMessageId: 'u2', branchFromMessageId: 'u2' }),
        undefined,
      );
      expect(conflict?.success).toBe(false);
      if (conflict?.success !== false) {
        throw new Error('expected conflict refusal');
      }
      expect(conflict.error).toContain('retry-and-branch-conflict');
      expect(context.disposeLiveSession).not.toHaveBeenCalled();
    } finally {
      store.close();
    }
  });
});

async function openRetryFixture(
  label: string,
  options?: { withWrites?: boolean; foreground?: boolean },
): Promise<{
  store: SessionTranscriptStore;
  context: SessionLiveContext & { disposeLiveSession: ReturnType<typeof vi.fn> };
  sessionId: string;
}> {
  const rootDir = await mkdtemp(join(tmpdir(), `piwin-retry-${label}-`));
  const sessionId = `session-${label}`;
  const store = await openSessionTranscriptStore({
    dbPath: join(rootDir, 'transcript.sqlite3'),
    sessionId,
    projectPath: '/tmp/project',
  });
  await append(store, 'u1', 'user', 'first');
  await append(store, 'a1', 'assistant', 'first answer');
  await append(store, 'u2', 'user', 'second');
  if (options?.withWrites === true) {
    const written = await store.appendMessage({
      id: 'a2',
      runtimeGenerationId: 'gen-a',
      backendMessageId: 'b-a2',
      role: 'assistant',
      text: 'wrote',
      status: 'done',
      createdAt: '2026-08-21T00:00:04.000Z',
      metadata: { workspaceWrites: { files: ['src/app.ts'], hasUnknownWrites: false } },
    });
    if (!written.ok) {
      throw new Error('append a2 failed');
    }
  } else {
    await append(store, 'a2', 'assistant', 'second answer');
  }
  const disposeLiveSession = vi.fn(async () => undefined);
  const context = {
    piwinRoot: rootDir,
    getTranscriptStore: async () => store,
    getForegroundRun: () => (options?.foreground === true ? { runId: 'run-1' } : undefined),
    disposeLiveSession,
    push: () => undefined,
  } as unknown as SessionLiveContext & { disposeLiveSession: ReturnType<typeof vi.fn> };
  return { store, context, sessionId };
}

function prompt(
  sessionId: string,
  input: Omit<PromptCommand['input'], 'text'> & { text?: string },
  extras?: { confirm?: boolean },
): PromptCommand {
  return {
    type: 'session/prompt',
    sessionId,
    input: { ...input, text: input.text ?? '' },
    ...(extras?.confirm === true ? { confirm: true } : {}),
  };
}

async function append(
  store: SessionTranscriptStore,
  id: string,
  role: 'user' | 'assistant',
  text: string,
): Promise<void> {
  const result = await store.appendMessage({
    id,
    runtimeGenerationId: 'gen-a',
    backendMessageId: `b-${id}`,
    role,
    text,
    status: 'done',
    createdAt: `2026-08-21T00:00:0${id.length}.000Z`,
  });
  if (!result.ok) {
    throw new Error(`append ${id} failed`);
  }
}
