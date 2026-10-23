import { describe, expect, it } from 'vitest';
import type { CompactionActivityUi } from './chat-reducer.js';
import { isCompactionRunning, resolveCompactionSeamModel } from './compaction-seam-model.js';

function activity(overrides: Partial<CompactionActivityUi> = {}): CompactionActivityUi {
  return {
    operationId: 'compact-1',
    phase: 'succeeded',
    reason: 'manual',
    anchorMessageId: 'assistant-1',
    startedAt: 1_000,
    ...overrides,
  };
}

describe('isCompactionRunning', () => {
  it('is true only for a compaction that is still working', () => {
    expect(isCompactionRunning(activity({ phase: 'running' }))).toBe(true);
    for (const phase of ['succeeded', 'failed', 'cancelled'] as const) {
      expect(isCompactionRunning(activity({ phase }))).toBe(false);
    }
    expect(isCompactionRunning(null)).toBe(false);
    expect(isCompactionRunning(undefined)).toBe(false);
  });
});

describe('resolveCompactionSeamModel', () => {
  it('names the operation 压缩 in Chinese for every phase', () => {
    const labels = (['running', 'succeeded', 'failed', 'cancelled'] as const).map(
      (phase) => resolveCompactionSeamModel(activity({ phase }), 'zh-CN').label,
    );
    expect(labels).toEqual(['正在压缩上下文…', '已压缩上下文', '上下文压缩失败', '已取消压缩']);
    expect(labels.join('')).not.toContain('整理');
  });

  it('puts the token delta and reduction on a settled row', () => {
    const model = resolveCompactionSeamModel(
      activity({ tokensBefore: 571_000, tokensAfter: 21_000, durationMs: 35_000 }),
      'en',
    );
    expect(model.tokens).toBe('571K → 21K');
    expect(model.before).toBe('571K');
    expect(model.after).toBe('21K');
    expect(model.reduction).toBe('−96%');
    expect(model.duration).toBe('35s');
    expect(model.ratio).toBeCloseTo(21 / 571, 5);
  });

  it('omits the reduction when compaction did not shrink the context', () => {
    const model = resolveCompactionSeamModel(
      activity({ tokensBefore: 1_000, tokensAfter: 1_000 }),
      'en',
    );
    expect(model.tokens).toBe('1K → 1K');
    expect(model.reduction).toBeNull();
  });

  it('shows only the after count when the Host did not report a before count', () => {
    const model = resolveCompactionSeamModel(activity({ tokensAfter: 21_000 }), 'en');
    expect(model.tokens).toBe('21K');
    expect(model.ratio).toBeNull();
    expect(model.reduction).toBeNull();
  });

  it('carries no token facts on a running, failed or cancelled row', () => {
    for (const phase of ['running', 'failed', 'cancelled'] as const) {
      const model = resolveCompactionSeamModel(
        activity({ phase, tokensBefore: 10_000, tokensAfter: 2_000, summary: 'x' }),
        'en',
      );
      expect(model.tokens).toBeNull();
      expect(model.summary).toBeNull();
      expect(model.expandable).toBe(false);
    }
  });

  it('maps every Host reason to copy, and stays silent on unknown', () => {
    const reasons = (['manual', 'threshold', 'overflow', 'unknown'] as const).map(
      (reason) => resolveCompactionSeamModel(activity({ reason }), 'zh-CN').reason,
    );
    expect(reasons).toEqual([
      '手动压缩',
      '自动压缩 · 接近上下文窗口上限',
      '自动压缩 · 上下文超出模型窗口',
      null,
    ]);
  });

  it('shows a failure reason but hides the Host fallback text', () => {
    expect(
      resolveCompactionSeamModel(
        activity({ phase: 'failed', message: 'model returned an empty summary' }),
        'en',
      ).failure,
    ).toBe('model returned an empty summary');
    expect(
      resolveCompactionSeamModel(
        activity({ phase: 'failed', message: 'Compaction finished with errors' }),
        'en',
      ).failure,
    ).toBeNull();
  });

  it('lists modified files first, deduplicated, capped, with the remainder counted', () => {
    const model = resolveCompactionSeamModel(
      activity({
        fileOps: {
          readFiles: ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts', 'src/f.ts'],
          modifiedFiles: ['src/b.ts'],
          omittedCount: 3,
        },
      }),
      'en',
    );
    expect(model.files.map((file) => file.name)).toEqual([
      'b.ts',
      'a.ts',
      'c.ts',
      'd.ts',
      'e.ts',
      'f.ts',
    ]);
    expect(model.files[0]?.modified).toBe(true);
    expect(model.files[1]?.modified).toBe(false);
    expect(model.filesOmitted).toBe(3);
  });

  it('is not expandable when a settled row has nothing to unfold', () => {
    expect(resolveCompactionSeamModel(activity({ reason: 'unknown' }), 'en').expandable).toBe(false);
    expect(resolveCompactionSeamModel(activity({ reason: 'manual' }), 'en').expandable).toBe(true);
  });
});
