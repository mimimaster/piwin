import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  commandInBashAllowlist,
  pathInFileWriteAllowlist,
} from './allowlist-match.js';

describe('commandInBashAllowlist', () => {
  it('matches an exact command string', () => {
    expect(commandInBashAllowlist('rm -rf /tmp/foo', ['rm -rf /tmp/foo'])).toBe(
      true,
    );
  });

  it('does NOT match a command with extra arguments appended', () => {
    // Footgun guard: approving `rm -rf /tmp/foo` must not allow
    // `rm -rf /tmp/foo /etc`.
    expect(
      commandInBashAllowlist('rm -rf /tmp/foo /etc', ['rm -rf /tmp/foo']),
    ).toBe(false);
  });

  it('does NOT match a command that merely shares a prefix', () => {
    // `rm -rf /tmp/foobar` must not be allowed by `rm -rf /tmp/foo`.
    expect(
      commandInBashAllowlist('rm -rf /tmp/foobar', ['rm -rf /tmp/foo']),
    ).toBe(false);
  });

  it('trims surrounding whitespace before comparing', () => {
    expect(
      commandInBashAllowlist('  rm -rf /tmp/foo  ', ['rm -rf /tmp/foo']),
    ).toBe(true);
  });

  it('trims stored allowlist entries before comparing', () => {
    expect(
      commandInBashAllowlist('rm -rf /tmp/foo', ['  rm -rf /tmp/foo  ']),
    ).toBe(true);
  });

  it('returns false for an empty command', () => {
    expect(commandInBashAllowlist('', ['anything'])).toBe(false);
  });

  it('returns false when the allowlist is empty', () => {
    expect(commandInBashAllowlist('ls', [])).toBe(false);
  });

  it('returns false when no entry matches', () => {
    expect(commandInBashAllowlist('ls -la', ['cat file.txt', 'echo hi'])).toBe(
      false,
    );
  });

  it('matches one of several stored commands', () => {
    expect(
      commandInBashAllowlist('pnpm test', ['ls', 'pnpm test', 'git status']),
    ).toBe(true);
  });
});

describe('pathInFileWriteAllowlist', () => {
  const sep = path.sep;

  it('matches an exact path', () => {
    expect(
      pathInFileWriteAllowlist('/home/u/dir/file.toml', [
        '/home/u/dir/file.toml',
      ]),
    ).toBe(true);
  });

  it('matches a child of a stored directory (separator boundary)', () => {
    expect(
      pathInFileWriteAllowlist('/home/u/dir/file', ['/home/u/dir']),
    ).toBe(true);
  });

  it('matches a deeper descendant of a stored directory', () => {
    expect(
      pathInFileWriteAllowlist('/home/u/dir/a/b/c', ['/home/u/dir']),
    ).toBe(true);
  });

  it('does NOT match a sibling name that shares a prefix (no naive prefix)', () => {
    // `/home/u/a` must NOT match `/home/u/ab`.
    expect(pathInFileWriteAllowlist('/home/u/ab', ['/home/u/a'])).toBe(false);
  });

  it('does NOT match a directory whose name extends the stored entry', () => {
    // `/home/u/directory` must NOT be allowed by `/home/u/dir`.
    expect(
      pathInFileWriteAllowlist('/home/u/directory', ['/home/u/dir']),
    ).toBe(false);
  });

  it('matches the stored directory path itself', () => {
    expect(pathInFileWriteAllowlist('/home/u/dir', ['/home/u/dir'])).toBe(true);
  });

  it('normalizes a trailing separator on the stored entry consistently', () => {
    // Storing `/home/u/dir/` should behave identically to `/home/u/dir`.
    expect(
      pathInFileWriteAllowlist('/home/u/dir/file', ['/home/u/dir/']),
    ).toBe(true);
  });

  it('normalizes a trailing separator on the target path', () => {
    expect(
      pathInFileWriteAllowlist('/home/u/dir/', ['/home/u/dir']),
    ).toBe(true);
  });

  it('normalizes . and .. segments before comparing', () => {
    expect(
      pathInFileWriteAllowlist('/home/u/dir/./file', ['/home/u/dir']),
    ).toBe(true);
    expect(
      pathInFileWriteAllowlist('/home/u/dir/sub/../file', ['/home/u/dir']),
    ).toBe(true);
  });

  it('uses the platform separator as the boundary', () => {
    const stored = `/home/u/dir${sep}`;
    const target = `/home/u/dir${sep}file`;
    expect(pathInFileWriteAllowlist(target, [stored])).toBe(true);
  });

  it('returns false for an empty target path', () => {
    expect(pathInFileWriteAllowlist('', ['/home/u/dir'])).toBe(false);
  });

  it('returns false when the allowlist is empty', () => {
    expect(pathInFileWriteAllowlist('/home/u/dir', [])).toBe(false);
  });

  it('returns false when no entry matches', () => {
    expect(
      pathInFileWriteAllowlist('/home/u/other', ['/home/u/dir', '/etc']),
    ).toBe(false);
  });

  it('matches one of several stored paths', () => {
    expect(
      pathInFileWriteAllowlist('/etc/config.conf', [
        '/home/u/dir',
        '/etc',
      ]),
    ).toBe(true);
  });
});
