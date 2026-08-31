import { describe, expect, it } from 'vitest';
import {
  applyPickedExecutable,
  formatArgsLine,
  formatCommandLine,
  insertToken,
  parseArgsLine,
  parseCommandLine,
  parseEnvLines,
  quoteArgvToken,
  tokenizeCommandLine,
} from './cli-command-line';

describe('cli-command-line', () => {
  it('splits a quoted command line into argv tokens', () => {
    expect(
      tokenizeCommandLine('/Users/me/bin/windsurf-search.mjs "{{query}}" --limit 5'),
    ).toEqual(['/Users/me/bin/windsurf-search.mjs', '{{query}}', '--limit', '5']);
  });

  it('keeps spaces inside quotes as one token', () => {
    expect(parseCommandLine(`search --q "hello world"`)).toEqual({
      command: 'search',
      args: ['--q', 'hello world'],
    });
  });

  it('round-trips command + args through quoting', () => {
    const command = '/usr/local/bin/my-search';
    const args = ['{{query}}', '--limit', '5'];
    const line = formatCommandLine(command, args);
    expect(line).toContain('{{query}}');
    expect(parseCommandLine(line)).toEqual({ command, args });
  });

  it('formats MCP-style args without the executable', () => {
    expect(formatArgsLine(['{{query}}', '--limit', '5'])).toBe('"{{query}}" --limit 5');
    expect(parseArgsLine('"{{query}}" --limit 5')).toEqual(['{{query}}', '--limit', '5']);
  });

  it('quotes tokens that are not simple path-safe names', () => {
    expect(quoteArgvToken('{{query}}')).toBe('"{{query}}"');
    expect(quoteArgvToken('plain')).toBe('plain');
  });

  it('inserts a token at the cursor with spacing', () => {
    expect(insertToken('search', '"{{query}}"', 6)).toBe('search "{{query}}"');
    expect(insertToken('', '"{{query}}"', 0)).toBe('"{{query}}"');
  });

  it('parses KEY=VALUE env lines and ignores comments', () => {
    expect(parseEnvLines('SEARCH_API_KEY=abc\n# skip\nEMPTY=\n=bad\nOTHER=x=y')).toEqual({
      SEARCH_API_KEY: 'abc',
      EMPTY: '',
      OTHER: 'x=y',
    });
  });

  it('replaces a previous script path when picking a new executable', () => {
    const next = applyPickedExecutable('/opt/search.mjs', '/tmp/old.mjs\n{{query}}\n--limit\n5');
    expect(next.command).toBe('/opt/search.mjs');
    expect(next.args).toBe('{{query}}\n--limit\n5');
  });
});
