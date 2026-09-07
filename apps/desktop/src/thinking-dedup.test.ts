import { describe, expect, it } from 'vitest';
import { isDuplicateThinking } from './thinking-dedup.js';

describe('isDuplicateThinking', () => {
  it('returns true for empty or whitespace-only thinking', () => {
    expect(isDuplicateThinking('', ['some prior thought'])).toBe(true);
    expect(isDuplicateThinking('   ', ['some prior thought'])).toBe(true);
  });

  it('returns false when there are no prior thoughts', () => {
    expect(isDuplicateThinking('First thought', [])).toBe(false);
  });

  it('returns true for exact string match', () => {
    const thought = 'I should inspect the project before modifying files.';
    expect(isDuplicateThinking(thought, [thought])).toBe(true);
    expect(isDuplicateThinking(`  ${thought}  `, [thought])).toBe(true);
  });

  it('returns true for normalized match with different casing or punctuation', () => {
    expect(
      isDuplicateThinking('Inspect the project.', ['inspect the project']),
    ).toBe(true);
    expect(
      isDuplicateThinking('Inspect the project!', ['Inspect the project.']),
    ).toBe(true);
  });

  it('detects duplicate in the user bug scenario from screenshot', () => {
    const priorThought =
      'The user is asking why we used 192.168.1.100 instead of 127.0.0.1 for the cursor proxy, whether it\'s because of TUN interception, and whether we added direct connection rules.';
    const currentThought =
      'The user is asking why we used 192.168.1.100 instead of 127.0.0.1, whether TUN intercepted it, and whether we added DIRECT rules.';

    expect(isDuplicateThinking(currentThought, [priorThought])).toBe(true);
  });

  it('returns false for genuinely distinct thoughts in a tool loop', () => {
    const step1Thought = 'I will run bash command scutil --proxy to check proxy status.';
    const step2Thought = 'The proxy on en0 is disabled. I will explain the findings to the user.';

    expect(isDuplicateThinking(step2Thought, [step1Thought])).toBe(false);
  });

  it('handles Chinese reasoning duplicates and distinct thoughts', () => {
    const zh1 = '用户询问为什么系统代理使用了 192.168.1.100 而不是 127.0.0.1，先核对代理状态。';
    const zhDuplicate = '用户询问为什么系统代理使用了 192.168.1.100 而不是 127.0.0.1，核对代理状态。';
    const zhDistinct = '根据 scutil 的返回结果，系统代理并未开启，可以直接给出结论。';

    expect(isDuplicateThinking(zhDuplicate, [zh1])).toBe(true);
    expect(isDuplicateThinking(zhDistinct, [zh1])).toBe(false);
  });
});
