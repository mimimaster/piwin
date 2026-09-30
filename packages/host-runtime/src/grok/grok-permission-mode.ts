/**
 * Read Grok's global permission mode from config text (ADR 0082).
 *
 * Only the `permission_mode` assignment is returned. The rest of the file,
 * including anything that might be a secret, is ignored and never logged.
 */

const PERMISSION_MODE_LINE = /^\s*permission_mode\s*=\s*(.+?)\s*$/;

/** First non-comment `permission_mode` value, or undefined when absent. */
export function readGrokPermissionMode(toml: string): string | undefined {
  for (const line of toml.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) {
      continue;
    }
    const match = PERMISSION_MODE_LINE.exec(line);
    if (match === null) {
      continue;
    }
    return unquoteToml(match[1] ?? '');
  }
  return undefined;
}

function unquoteToml(raw: string): string | undefined {
  if (raw.length >= 2) {
    const quote = raw[0];
    if ((quote === '"' || quote === "'") && raw[raw.length - 1] === quote) {
      const inner = raw.slice(1, -1).trim();
      return inner.length > 0 ? inner : undefined;
    }
  }
  if (raw.length === 0 || raw.includes(' ') || raw.startsWith('#')) {
    return undefined;
  }
  return raw;
}
