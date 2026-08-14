import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ContextSummaryPush, HostPush } from '@piwin/contracts';
import { persistAndPushAssembly } from './model-context-record.js';

describe('persistAndPushAssembly', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  function sample(sessionId = 'session-1'): ContextSummaryPush {
    return {
      type: 'agent/context-summary',
      sessionId,
      runId: 'run-1',
      requestClass: 'prompt',
      requestOrdinal: 1,
      coverage: 'assembly-only',
      estimateSource: 'host-estimate',
      contributions: [],
    };
  }

  it('pushes capture-missed when the ledger file cannot be written', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-mvl-miss-'));
    dirs.push(dir);
    const notADirectory = join(dir, 'blocked');
    await writeFile(notADirectory, 'not a directory');
    const pushes: HostPush[] = [];
    await persistAndPushAssembly({
      piwinRoot: notADirectory,
      summary: sample(),
      push: (message) => {
        pushes.push(message);
      },
    });
    expect(pushes.some((item) => item.type === 'host/log' && item.level === 'warn')).toBe(true);
    const missed = pushes.find((item) => item.type === 'agent/context-summary');
    expect(missed?.type === 'agent/context-summary' ? missed.coverage : undefined).toBe(
      'capture-missed',
    );
  });

  it('persists a user-bound assembly-only summary', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-mvl-ok-'));
    dirs.push(dir);
    const pushes: HostPush[] = [];
    const summary = {
      ...sample(),
      userMessageId: 'user-1',
    };
    await persistAndPushAssembly({
      piwinRoot: dir,
      summary,
      push: (message) => {
        pushes.push(message);
      },
    });
    expect(pushes).toHaveLength(1);
    expect(pushes[0]).toMatchObject({
      type: 'agent/context-summary',
      coverage: 'assembly-only',
      userMessageId: 'user-1',
    });
  });
});
