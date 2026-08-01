import { describe, expect, it } from 'vitest';
import { SessionAllowlist, commandInSessionAllowlist, pathInSessionAllowlist } from './session-allowlist.js';

describe('commandInSessionAllowlist', () => {
  it('matches exact command', () => {
    const set = new Set(['npm test']);
    expect(commandInSessionAllowlist('npm test', set)).toBe(true);
  });

  it('does not match prefix', () => {
    const set = new Set(['npm test']);
    expect(commandInSessionAllowlist('npm test -- --grep foo', set)).toBe(false);
  });

  it('trims whitespace before matching', () => {
    const set = new Set(['npm test']);
    expect(commandInSessionAllowlist('  npm test  ', set)).toBe(true);
  });

  it('returns false for empty command', () => {
    const set = new Set(['npm test']);
    expect(commandInSessionAllowlist('', set)).toBe(false);
  });
});

describe('pathInSessionAllowlist', () => {
  it('matches exact path', () => {
    const set = new Set(['/tmp/foo.txt']);
    expect(pathInSessionAllowlist('/tmp/foo.txt', set)).toBe(true);
  });

  it('matches path under a directory entry', () => {
    const set = new Set(['/tmp/foo']);
    expect(pathInSessionAllowlist('/tmp/foo/bar.txt', set)).toBe(true);
  });

  it('does not match sibling prefix without separator', () => {
    const set = new Set(['/tmp/foo']);
    expect(pathInSessionAllowlist('/tmp/foobar.txt', set)).toBe(false);
  });

  it('returns false for empty path', () => {
    const set = new Set(['/tmp/foo']);
    expect(pathInSessionAllowlist('', set)).toBe(false);
  });
});

describe('SessionAllowlist', () => {
  it('starts empty', () => {
    const al = new SessionAllowlist();
    expect(al.size).toBe(0);
  });

  it('adds and matches bash commands', () => {
    const al = new SessionAllowlist();
    al.addBashCommand('npm test');
    expect(al.hasBashCommand('npm test')).toBe(true);
    expect(al.hasBashCommand('npm run build')).toBe(false);
    expect(al.size).toBe(1);
  });

  it('adds and matches file paths', () => {
    const al = new SessionAllowlist();
    al.addFilePath('/tmp/foo');
    expect(al.hasFilePath('/tmp/foo')).toBe(true);
    expect(al.hasFilePath('/tmp/foo/bar.txt')).toBe(true);
    expect(al.hasFilePath('/tmp/foobar')).toBe(false);
    expect(al.size).toBe(1);
  });

  it('ignores empty entries', () => {
    const al = new SessionAllowlist();
    al.addBashCommand('  ');
    al.addFilePath('');
    expect(al.size).toBe(0);
  });

  it('clears all entries', () => {
    const al = new SessionAllowlist();
    al.addBashCommand('npm test');
    al.addFilePath('/tmp/foo');
    expect(al.size).toBe(2);
    al.clear();
    expect(al.size).toBe(0);
    expect(al.hasBashCommand('npm test')).toBe(false);
  });
});
