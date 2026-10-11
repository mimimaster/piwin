import { describe, expect, it } from 'vitest';
import { isValidHostEntryName } from './host-entry.js';

describe('Host entry names', () => {
  it.each(['notes.md', '.gitignore', '项目资料', 'name with spaces', 'a..b'])(
    'accepts %s',
    (name) => {
      expect(isValidHostEntryName(name, 'posix')).toBe(true);
      expect(isValidHostEntryName(name, 'windows')).toBe(true);
    },
  );
  it.each([
    '',
    '  ',
    '.',
    '..',
    '../escape',
    '/absolute',
    'a/b',
    'a\\b',
    'a\0b',
    'a\nb',
    'a'.repeat(256),
  ])('rejects %j on all Hosts', (name) => {
    expect(isValidHostEntryName(name, 'posix')).toBe(false);
    expect(isValidHostEntryName(name, 'windows')).toBe(false);
  });
  it.each(['CON', 'nul.txt', 'COM1.log', 'LPT²', 'notes.', 'notes ', 'a:b', 'a?b', 'a*b', 'a"b'])(
    'rejects Windows name %j',
    (name) => {
      expect(isValidHostEntryName(name, 'windows')).toBe(false);
    },
  );
  it('allows POSIX names with Windows-special punctuation', () => {
    expect(isValidHostEntryName('a:b', 'posix')).toBe(true);
  });
  it('rejects malformed payloads without throwing', () => {
    expect(isValidHostEntryName(undefined, 'posix')).toBe(false);
    expect(isValidHostEntryName(123, 'posix')).toBe(false);
  });
});
