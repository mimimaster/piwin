import { describe, expect, it } from 'vitest';
import {
  mergePromptHistory,
  PROMPT_HISTORY_MAX,
  pushPromptHistory,
} from './prompt-history';

describe('pushPromptHistory', () => {
  it('prepends unique text and caps at max', () => {
    let stack: string[] = [];
    for (let index = 1; index <= 12; index += 1) {
      stack = pushPromptHistory(stack, `msg-${index}`);
    }
    expect(stack).toHaveLength(PROMPT_HISTORY_MAX);
    expect(stack[0]).toBe('msg-12');
    expect(stack[PROMPT_HISTORY_MAX - 1]).toBe('msg-3');
  });

  it('moves a repeated prompt to the front', () => {
    const stack = pushPromptHistory(['a', 'b', 'c'], 'b');
    expect(stack).toEqual(['b', 'a', 'c']);
  });

  it('ignores empty text', () => {
    expect(pushPromptHistory(['a'], '   ')).toEqual(['a']);
  });
});

describe('mergePromptHistory', () => {
  it('keeps stack order and appends unique session prompts', () => {
    expect(mergePromptHistory(['live'], ['older', 'live', 'oldest'])).toEqual([
      'live',
      'older',
      'oldest',
    ]);
  });
});
