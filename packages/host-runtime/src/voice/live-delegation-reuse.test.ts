import { describe, expect, it } from 'vitest';
import {
  canonicalLiveBrief,
  liveHoldSpeakableReason,
  resolveLiveWorkReuse,
} from './live-delegation-reuse.js';

const done = {
  delegationId: 'item_first',
  brief: '随便生成一张图片',
  status: 'completed' as const,
  result: '已生成图片',
};

describe('canonicalLiveBrief', () => {
  it('collapses whitespace', () => {
    expect(canonicalLiveBrief('  随便生成一张图片 \n')).toBe('随便生成一张图片');
  });
});

describe('resolveLiveWorkReuse', () => {
  it('reuses completed work when kind is work and the brief matches canonically', () => {
    expect(
      resolveLiveWorkReuse({
        kind: 'work',
        brief: '随便生成一张图片',
        tasks: [done],
      }),
    ).toEqual({ action: 'reuse', delegationId: 'item_first' });
  });

  it('admits kind repeat even when the brief matches (explicit second image)', () => {
    expect(
      resolveLiveWorkReuse({
        kind: 'repeat',
        brief: '随便生成一张图片',
        tasks: [done],
      }),
    ).toEqual({ action: 'admit' });
  });

  it('admits work when the brief is a new task', () => {
    expect(
      resolveLiveWorkReuse({
        kind: 'work',
        brief: '再生成一张猫',
        tasks: [done],
      }),
    ).toEqual({ action: 'admit' });
  });
});

describe('liveHoldSpeakableReason', () => {
  it('maps hold reject reasons', () => {
    expect(liveHoldSpeakableReason('live-delegation-held-empty')).toBe('hold-empty');
    expect(liveHoldSpeakableReason('live-delegation-held-mismatch')).toBe('hold-mismatch');
    expect(liveHoldSpeakableReason('live-delegation-rejected')).toBeNull();
  });
});
