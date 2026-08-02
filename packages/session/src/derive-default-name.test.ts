import { describe, it, expect } from 'vitest';
import { deriveDefaultNameFromMessage } from './derive-default-name.js';

describe('deriveDefaultNameFromMessage', () => {
  it('returns trimmed first line for a simple prompt', () => {
    expect(deriveDefaultNameFromMessage('Fix the login bug')).toBe('Fix the login bug');
  });

  it('strips markdown headers, bold, italic, code', () => {
    expect(deriveDefaultNameFromMessage('## **Fix** the _login_ `bug`')).toBe('Fix the login bug');
  });

  it('strips URLs and keeps surrounding text', () => {
    expect(deriveDefaultNameFromMessage('Check https://example.com/page for details')).toBe(
      'Check for details',
    );
  });

  it('collapses whitespace and trims', () => {
    expect(deriveDefaultNameFromMessage('  hello\n\n  world  ')).toBe('hello world');
  });

  it('takes the leading sentence from a multi-sentence prompt', () => {
    expect(
      deriveDefaultNameFromMessage(
        'Refactor the auth module. Also update the docs and add more tests afterwards.',
      ),
    ).toBe('Refactor the auth module');
  });

  it('strips polite/instructional openers (Chinese)', () => {
    expect(deriveDefaultNameFromMessage('请帮我修复登录 bug')).toBe('修复登录 bug');
    expect(deriveDefaultNameFromMessage('麻烦你生成一份交付文档')).toBe('生成一份交付文档');
  });

  it('strips polite/instructional openers (English)', () => {
    expect(deriveDefaultNameFromMessage('Please fix the login bug')).toBe('Fix the login bug');
    expect(deriveDefaultNameFromMessage('Can you refactor the auth module?')).toBe(
      'Refactor the auth module',
    );
  });

  it('keeps non-opener verbs intact', () => {
    expect(deriveDefaultNameFromMessage('Debug the parser issue')).toBe('Debug the parser issue');
  });

  it('truncates at 32 chars with ellipsis', () => {
    const long = 'This is a very long prompt that exceeds thirty two characters easily';
    const result = deriveDefaultNameFromMessage(long);
    expect(result.length).toBeLessThanOrEqual(32);
    expect(result.endsWith('…')).toBe(true);
  });

  it('truncates CJK without requiring spaces', () => {
    const long =
      '请为Walkthrough生成一份详细的交付文档请包含以下文本格式以及更多说明内容确保足够长';
    const result = deriveDefaultNameFromMessage(long);
    expect(result.length).toBeLessThanOrEqual(32);
    expect(result.endsWith('…')).toBe(true);
    expect(result.startsWith('为Walkthrough')).toBe(true);
  });

  it('returns empty string for blank input', () => {
    expect(deriveDefaultNameFromMessage('   \n\n  ')).toBe('');
  });

  it('returns empty string for input that is only markdown/urls', () => {
    expect(deriveDefaultNameFromMessage('### `https://x.com`')).toBe('');
  });
});
