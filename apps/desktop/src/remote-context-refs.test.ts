import { describe, expect, it } from 'vitest';
import { flattenUnsafeRemoteContextRefs, isSafeRemoteContextRef } from './remote-context-refs.js';

describe('flattenUnsafeRemoteContextRefs', () => {
  it('keeps Host-issued message refs', () => {
    const ref = {
      kind: 'main-message' as const,
      sourceSessionId: 'session-1',
      messageId: 'msg-1',
      label: 'earlier turn',
    };
    expect(isSafeRemoteContextRef(ref)).toBe(true);
    expect(flattenUnsafeRemoteContextRefs('hello', [ref])).toEqual({
      text: 'hello',
      contextRefs: [ref],
    });
  });

  it('keeps a transcript selection on the wire so history can render the chip', () => {
    const selection = {
      kind: 'selection' as const,
      snapshotText: '已完全对齐仓库现状与架构约束。',
      label: '已完全对齐仓库现状与架…',
    };
    expect(isSafeRemoteContextRef(selection)).toBe(true);
    expect(flattenUnsafeRemoteContextRefs('我选中了啥发给你', [selection])).toEqual({
      text: '我选中了啥发给你',
      contextRefs: [selection],
    });
  });

  it('flattens a Host filesystem file ref into text', () => {
    const result = flattenUnsafeRemoteContextRefs('look', [
      {
        kind: 'file',
        projectPath: '/Users/me/project',
        relativePath: 'src/a.ts',
        label: 'src/a.ts',
      },
    ]);
    expect(result.contextRefs).toEqual([]);
    expect(result.text).toBe('look\n\nsrc/a.ts');
  });
});
