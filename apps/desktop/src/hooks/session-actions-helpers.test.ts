import { describe, expect, it } from 'vitest';
import {
  compactFailureMessage,
  isCompactionNoOp,
  isTargetCompactNoOpFailure,
} from './session-actions-helpers.js';

describe('compactFailureMessage', () => {
  it('maps already compacted without leaking the protocol string in Chinese', () => {
    expect(compactFailureMessage('Already compacted', 'zh-CN')).toBe('这段上下文已经压缩过了。');
    expect(compactFailureMessage('Already compacted', 'zh-CN')).not.toMatch(/Already compacted/);
  });

  it('maps a target-model budget miss off the protocol string', () => {
    expect(
      compactFailureMessage(
        'context-limit-exceeded: compacted context 900000 exceeds target input budget 201600',
        'zh-CN',
      ),
    ).toMatch(/超过目标模型窗口/);
    expect(
      compactFailureMessage(
        'context-limit-exceeded: compacted context 900000 exceeds target input budget 201600',
        'en',
      ),
    ).toMatch(/exceeds the target model window/i);
  });
});

describe('isTargetCompactNoOpFailure', () => {
  it('treats already compacted as a no-op for model switch', () => {
    expect(isTargetCompactNoOpFailure('Already compacted')).toBe(true);
    expect(isTargetCompactNoOpFailure('Nothing to compact (session too small)')).toBe(true);
    expect(isTargetCompactNoOpFailure('context-limit-exceeded: compacted context 9')).toBe(false);
  });
});

describe('isCompactionNoOp', () => {
  it('keeps provider and context-limit errors as real failures', () => {
    expect(isCompactionNoOp('Nothing to compact (session too small)')).toBe(true);
    expect(isCompactionNoOp('provider unavailable')).toBe(false);
    expect(isCompactionNoOp('context-limit-exceeded')).toBe(false);
  });
});
