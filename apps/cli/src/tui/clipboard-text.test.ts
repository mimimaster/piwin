import { describe, expect, it } from 'vitest';
import { osc52Sequence } from './clipboard-text.js';

describe('osc52Sequence', () => {
  it('encodes text as base64 and wraps it for tmux', () => {
    expect(osc52Sequence('你好', {})).toBe(`\x1b]52;c;${Buffer.from('你好').toString('base64')}\x07`);
    expect(osc52Sequence('a', { TMUX: '/tmp/t' })).toBe('\x1bPtmux;\x1b\x1b]52;c;YQ==\x07\x1b\\');
  });
});
