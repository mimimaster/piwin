import { describe, expect, it } from 'vitest';
import { areSafeRemoteContextRefs, isSafeRemoteContextRef } from './remote-context-ref.js';

describe('isSafeRemoteContextRef', () => {
  it('accepts a transcript selection even with a leftover Host path', () => {
    expect(
      isSafeRemoteContextRef({
        kind: 'selection',
        projectPath: '/Users/me/piwin',
        snapshotText: '已完全对齐仓库现状与架构约束。'.repeat(20),
        label: '已完全对齐仓库现状与架…',
      }),
    ).toBe(true);
  });

  it('accepts snapshot-only terminal and error refs', () => {
    expect(
      isSafeRemoteContextRef({
        kind: 'terminal-output',
        snapshotText: 'exit 1',
        label: 'bash',
      }),
    ).toBe(true);
    expect(
      isSafeRemoteContextRef({
        kind: 'error',
        title: 'TS2322',
        detail: 'type mismatch',
        label: 'err',
      }),
    ).toBe(true);
  });

  it('accepts only the exact Apple Health connected-source ref', () => {
    expect(
      isSafeRemoteContextRef({
        kind: 'connected-source',
        source: 'apple-health',
        label: 'Apple Health',
      }),
    ).toBe(true);
    expect(
      isSafeRemoteContextRef({
        kind: 'connected-source',
        source: 'apple-health',
        label: 'Health',
      } as unknown as Parameters<typeof isSafeRemoteContextRef>[0]),
    ).toBe(false);
  });

  it('accepts a knowledge selection and rejects an escaped library path', () => {
    expect(
      isSafeRemoteContextRef({
        kind: 'knowledge-selection',
        baseId: 'base-notes',
        scope: 'selection',
        relativePath: 'notes/sleep-debt.md',
        lineStart: 3,
        lineEnd: 5,
        snapshotText: 'Replay during sleep.',
        label: 'notes/sleep-debt.md · 3–5',
      }),
    ).toBe(true);
    expect(
      isSafeRemoteContextRef({
        kind: 'knowledge-selection',
        baseId: 'base-notes',
        scope: 'selection',
        relativePath: '../secrets/key.md',
        lineStart: 1,
        snapshotText: 'no',
        label: 'escaped',
      }),
    ).toBe(false);
  });

  it('still rejects a raw Host filesystem file ref', () => {
    expect(
      isSafeRemoteContextRef({
        kind: 'file',
        projectPath: '/Users/me/piwin',
        relativePath: 'src/a.ts',
        label: 'src/a.ts',
      }),
    ).toBe(false);
    expect(
      areSafeRemoteContextRefs([
        {
          kind: 'file',
          projectPath: '/Users/me/piwin',
          relativePath: 'src/a.ts',
          label: 'src/a.ts',
        },
      ]),
    ).toBe(false);
  });
});
