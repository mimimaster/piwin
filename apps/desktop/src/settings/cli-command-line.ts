/**
 * Parse a terminal-style command line into no-shell argv.
 * Runtime still spawn()s the first token as the executable.
 */

export const CLI_QUERY_TOKEN = '{{query}}';

export function tokenizeCommandLine(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char === undefined) {
      continue;
    }
    if (quote) {
      if (char === '\\' && quote === '"' && index + 1 < input.length) {
        const next = input[index + 1];
        if (next !== undefined) {
          current += next;
          index += 1;
        }
        continue;
      }
      if (char === quote) {
        quote = null;
        continue;
      }
      current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (current.length > 0) {
    tokens.push(current);
  }
  return tokens;
}

export function quoteArgvToken(value: string): string {
  if (value.length === 0) {
    return "''";
  }
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) {
    return value;
  }
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

export function formatCommandLine(command: string, args: readonly string[]): string {
  const executable = command.trim();
  const parts = executable ? [executable, ...args] : [...args];
  return parts.map(quoteArgvToken).join(' ').trim();
}

/** MCP-style args field: quoted tokens joined by spaces. */
export function formatArgsLine(args: readonly string[]): string {
  return args.map(quoteArgvToken).join(' ').trim();
}

export function parseArgsLine(input: string): string[] {
  return tokenizeCommandLine(input.trim());
}

export function parseCommandLine(input: string): { command: string; args: string[] } {
  const tokens = tokenizeCommandLine(input.trim());
  const command = tokens[0] ?? '';
  return { command, args: tokens.slice(1) };
}

export function argsToLines(args: readonly string[]): string {
  return args.join('\n');
}

export function linesToArgs(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function commandLineHasQueryToken(command: string, args: readonly string[]): boolean {
  return [command, ...args].some((part) => part.includes(CLI_QUERY_TOKEN));
}

export function looksLikeVersionPinnedNode(executable: string): boolean {
  return /fnm|nvm|\.local\/share\/fnm|node-versions|volta\/tools\/image\/node|asdf\/installs\/nodejs/i.test(
    executable,
  );
}

export function looksLikeDirectScript(executable: string): boolean {
  return /\.(mjs|cjs|js|py|sh|bash|zsh)$/i.test(executable.trim());
}

export function parseEnvLines(text: string): Record<string, string> | undefined {
  const env: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const separator = trimmed.indexOf('=');
    if (separator <= 0) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    if (!key) {
      continue;
    }
    env[key] = trimmed.slice(separator + 1);
  }
  return Object.keys(env).length > 0 ? env : undefined;
}

export function formatEnvLines(env: Record<string, string> | undefined): string {
  if (!env) {
    return '';
  }
  return Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

export function applyPickedExecutable(
  pickedPath: string,
  currentArgsLines: string,
): { command: string; args: string } {
  const currentArgs = linesToArgs(currentArgsLines);
  const kept = currentArgs.filter(
    (arg) =>
      !arg.startsWith('/') &&
      !arg.startsWith('~') &&
      !/^[A-Za-z]:[\\/]/.test(arg) &&
      !looksLikeDirectScript(arg),
  );
  const args = commandLineHasQueryToken('', kept)
    ? kept
    : [CLI_QUERY_TOKEN, '--limit', '5'];
  return { command: pickedPath.trim(), args: argsToLines(args) };
}

export function insertToken(existing: string, token: string, cursor: number): string {
  const start = Math.max(0, Math.min(cursor, existing.length));
  const before = existing.slice(0, start);
  const after = existing.slice(start);
  const padLeft = before.length > 0 && !before.endsWith(' ') ? ' ' : '';
  const padRight = after.length > 0 && !after.startsWith(' ') ? ' ' : '';
  return `${before}${padLeft}${token}${padRight}${after}`;
}
