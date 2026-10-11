import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Local file paths as they arrive in a terminal: typed, pasted, or dropped
 * onto the window (which inserts the path, shell-escaped or quoted). Pure
 * except for `homedir()`.
 */

export type PathToken = {
  /** The exact text in the message, for replacing it. */
  raw: string;
  /** Absolute local path it names. */
  path: string;
};

/**
 * A quoted string, a file:// URL, or an unquoted run where a backslash keeps
 * the next character (so `My\ Shot.png` is one token).
 */
const TOKEN_PATTERN = /'([^'\n]+)'|"([^"\n]+)"|(file:\/\/[^\s]+)|((?:\\.|[^\s\\'"])+)/gu;

/** One path argument, as given to `/attach`. Relative paths resolve against `cwd`. */
export function parsePathArgument(argument: string, cwd: string): string | undefined {
  const tokens = tokenize(argument);
  if (tokens.length !== 1) return undefined;
  return toAbsolutePath(tokens[0]?.value ?? '', cwd);
}

/** Every path argument of `/attach a.png 'b c.png'`. */
export function parsePathArguments(argument: string, cwd: string): string[] {
  return tokenize(argument)
    .map((token) => toAbsolutePath(token.value, cwd))
    .filter((candidate): candidate is string => candidate !== undefined);
}

/**
 * Absolute paths written inside a message. Only absolute, `~` and file://
 * forms count: a relative word in prose is not a file the user dropped.
 */
export function findAbsolutePathTokens(text: string): PathToken[] {
  const found: PathToken[] = [];
  for (const token of tokenize(text)) {
    if (!/^(?:\/|~\/|file:\/\/|[A-Za-z]:[\\/])/.test(token.value)) continue;
    const absolute = toAbsolutePath(token.value, '/');
    if (absolute !== undefined && !found.some((entry) => entry.path === absolute)) {
      found.push({ raw: token.raw, path: absolute });
    }
  }
  return found;
}

function tokenize(text: string): Array<{ raw: string; value: string }> {
  const tokens: Array<{ raw: string; value: string }> = [];
  for (const match of text.matchAll(TOKEN_PATTERN)) {
    const value = match[1] ?? match[2] ?? match[3] ?? (match[4] ?? '').replace(/\\(.)/gu, '$1');
    if (value.length > 0) tokens.push({ raw: match[0], value });
  }
  return tokens;
}

function toAbsolutePath(value: string, cwd: string): string | undefined {
  if (value.startsWith('file://')) {
    try {
      return fileURLToPath(value);
    } catch {
      // Not a local file URL (wrong host, bad escapes): not a path we can read.
      return undefined;
    }
  }
  if (value === '~') return homedir();
  if (value.startsWith('~/')) return path.join(homedir(), value.slice(2));
  return path.resolve(cwd, value);
}
