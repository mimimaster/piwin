import { describe, it, expect } from 'vitest';
import { deriveDefaultNameFromMessage } from './derive-default-name.js';

describe('deriveDefaultNameFromMessage', () => {
  it('returns trimmed first line for a simple prompt', () => {
    expect(deriveDefaultNameFromMessage('Fix the login bug')).toBe('Fix the login bug');
  });

  it('strips markdown headers, bold, italic, code', () => {
    expect(deriveDefaultNameFromMessage('## **Fix** the _login_ `bug`')).toBe(
      'Fix the login bug',
    );
  });

  it('strips URLs and keeps surrounding text', () => {
    expect(
      deriveDefaultNameFromMessage('Check https://example.com/page for details'),
    ).toBe('Check for details');
  });

  it('collapses whitespace and trims', () => {
    expect(deriveDefaultNameFromMessage('  hello\n\n  world  ')).toBe('hello world');
  });

  it('truncates at 60 chars on word boundary with ellipsis', () => {
    const long = 'This is a very long prompt that exceeds the sixty character limit for sure';
    const result = deriveDefaultNameFromMessage(long);
    expect(result.length).toBeLessThanOrEqual(60);
    expect(result.endsWith('…')).toBe(true);
  });

  it('returns empty string for blank input', () => {
    expect(deriveDefaultNameFromMessage('   \n\n  ')).toBe('');
  });

  it('returns empty string for input that is only markdown/urls', () => {
    expect(deriveDefaultNameFromMessage('### `https://x.com`')).toBe('');
  });
});
