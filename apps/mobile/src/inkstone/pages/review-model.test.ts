import { describe, expect, it } from 'vitest';
import type { HostPush, HostResponse } from '@piwin/contracts';
import { advanceCursor, FILE_PAGE_SIZE, PATCH_DISPLAY_LIMIT, readDiff, readFiles, readResult,
  readResults, readVerification, relevantReviewPush, RESULT_PAGE_SIZE, verificationLabel } from './review-model.js';

const ok = (data: unknown): HostResponse => ({ type: 'response', command: 'read', success: true, data });
const raw = {
  resultId: 'opaque/result', revision: 3, parentSessionId: 'parent', batchRunId: 'batch',
  executionStatus: 'completed', summaryStatus: 'merged', integrationStatus: 'applied', reviewStatus: 'approved',
  latestReview: { reviewId: 'review', revision: 1 }, latestVerification: { verificationId: 'verification', revision: 2 },
  availability: { view: { allowed: true }, apply: { allowed: false, reason: 'already-applied' } },
};
const selected = readResult(raw, 'parent');
if (selected === undefined) throw new Error('fixture invalid');
const receipt = {
  verificationId: 'verification', revision: 2, parentSessionId: 'parent', result: { resultId: 'opaque/result', revision: 3 }, status: 'failed',
  checks: [{ evidence: 'secret evidence' }], reviewScope: 'secret scope', executorLease: 'secret lease',
};
const batch = (verification: unknown = receipt, resultRef: unknown = receipt.result) => ok({
  runId: 'batch', status: 'completed', results: [{ runId: 'batch', resultRef, deliveryVerification: verification }], rawLease: 'secret',
});

describe('C1 public readonly review model', () => {
  it('retains only declared safe metadata and refs; latestVerification is not a status', () => {
    const result = readResult({ ...raw, reviewScope: 'secret', executorLease: 'secret',
      latestVerification: { ...raw.latestVerification, status: 'passed', checks: ['secret'] },
      availability: { ...raw.availability, filesReady: true, diffReady: true, cleanup: { allowed: true, raw: 'secret' } },
    }, 'parent');
    expect(result).toMatchObject({ ...raw, latestVerification: { verificationId: 'verification', revision: 2 } });
    expect(JSON.stringify(result)).not.toMatch(/secret|filesReady|diffReady|checks|executorLease|reviewScope/);
    expect(verificationLabel(selected, undefined)).toBe('验收状态未公开/无法确认');
    expect(verificationLabel(selected, 'failed')).toBe('已应用但验收失败，不代表已交付');
    expect(verificationLabel(selected, 'passed')).not.toContain('已交付');
  });
  it.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])('rejects nonpositive/inexact revision %s', (revision) => {
    expect(readResult({ ...raw, revision }, 'parent')).toBeUndefined();
  });
  it('rejects foreign sessions and empty IDs, drops invented statuses and bad optional refs', () => {
    expect(readResult(raw, 'foreign')).toBeUndefined();
    expect(readResult({ ...raw, resultId: '' }, 'parent')).toBeUndefined();
    const result = readResult({ ...raw, integrationStatus: 'delivered', latestReview: { reviewId: 'r', revision: 0 } }, 'parent');
    expect(result?.integrationStatus).toBeUndefined();
    expect(result?.latestReview).toBeUndefined();
    expect(result?.availability.resolve).toBeUndefined();
  });
  it('joins only actual batch task + exact result and verification revisions + parent', () => {
    expect(readVerification(batch(), selected)).toBe('failed');
    expect(readVerification(batch({ ...receipt, status: 'passed' }), selected)).toBe('passed');
    for (const value of [
      { ...receipt, revision: 1 }, { ...receipt, verificationId: 'other' }, { ...receipt, parentSessionId: 'foreign' },
      { ...receipt, result: { ...receipt.result, revision: 2 } }, { ...receipt, status: 'completed' },
    ]) expect(readVerification(batch(value), selected)).toBeUndefined();
    expect(readVerification(batch(receipt, { resultId: 'other', revision: 3 }), selected)).toBeUndefined();
    expect(readVerification(ok({ runId: 'other', results: [] }), selected)).toBeUndefined();
    expect(readVerification(ok({ runId: 'batch', results: [{ runId: 'other', resultRef: receipt.result, deliveryVerification: receipt }] }), selected)).toBeUndefined();
    expect(readVerification(ok({ runId: 'batch', results: [
      { runId: 'batch', resultRef: receipt.result, deliveryVerification: receipt },
      { runId: 'batch', resultRef: receipt.result, deliveryVerification: { ...receipt, status: 'passed' } },
    ] }), selected)).toBeUndefined();
  });
  it('reports malformed/error pages instead of treating them as empty and enforces read page ceilings', () => {
    expect(readResults(ok({ items: [raw], nextCursor: 'opaque cursor' }), 'parent')).toMatchObject({ nextCursor: 'opaque cursor' });
    expect(readResults(ok({ items: [] }), 'parent').items).toEqual([]);
    for (const value of [{}, { items: [null] }, { items: [{ ...raw, parentSessionId: 'foreign' }] },
      { items: Array.from({ length: RESULT_PAGE_SIZE + 1 }, () => raw) }, { items: [], nextCursor: 123 }]) {
      expect(() => readResults(ok(value), 'parent')).toThrow();
    }
    expect(() => readFiles(ok({ files: Array.from({ length: FILE_PAGE_SIZE + 1 }, () => ({ fileId: 'f', relativePath: 'f', kind: 'added' })) }))).toThrow();
    expect(() => readFiles(ok({ files: [{ fileId: '', relativePath: 'f', kind: 'added' }] }))).toThrow();
    expect(() => readFiles({ type: 'response', command: 'read', success: false, error: 'public denial' })).toThrow('public denial');
  });
  it('keeps file authority opaque; counts are unknown or Host returned including zero; clips only locally', () => {
    expect(readFiles(ok({ files: [{ fileId: 'opaque', relativePath: 'public/path', kind: 'modified', patch: 'secret' }] })).items)
      .toEqual([{ fileId: 'opaque', relativePath: 'public/path', kind: 'modified' }]);
    expect(readDiff(ok({ additions: 0, deletions: 0, binary: false }))).toEqual({ additions: 0, deletions: 0, binary: false, locallyClipped: false });
    expect(readDiff(ok({ additions: -1, deletions: '0' }))).toEqual({ additions: null, deletions: null, binary: undefined, locallyClipped: false });
    const diff = readDiff(ok({ binary: true, patch: 'x'.repeat(PATCH_DISPLAY_LIMIT + 10), truncated: false }));
    expect(diff.binary).toBe(true);
    expect(diff.patch).toHaveLength(PATCH_DISPLAY_LIMIT);
    expect(diff.locallyClipped).toBe(true);
    expect(diff).not.toHaveProperty('truncated');
  });
  it('stops repeated cursors and uses exact parent session for all applicable push variants', () => {
    const cursors = new Set<string>();
    expect(advanceCursor('opaque', cursors)).toBe('opaque');
    expect(() => advanceCursor('opaque', cursors)).toThrow('重复');
    expect(advanceCursor(undefined, cursors)).toBeUndefined();
    for (const type of ['subagent/result-updated', 'subagent/invocation-updated', 'subagent/merged', 'subagent/batch-updated', 'subagent/task-updated']) {
      expect(relevantReviewPush({ type, parentSessionId: 'parent' } as HostPush, 'parent')).toBe(true);
      expect(relevantReviewPush({ type, parentSessionId: 'foreign' } as HostPush, 'parent')).toBe(false);
    }
    expect(relevantReviewPush({ type: 'host/replay-done', sinceSeq: 1 } as HostPush, 'parent')).toBe(false);
  });
});
