/**
 * Session list naming policy (single source of truth).
 *
 * Invariant for the sidebar:
 * - A session is listable only when it has a real display name
 *   (not a host placeholder like `session-<id>`).
 * - First user message → host writes a truncated text name (`nameSource: text`).
 * - After a completed exchange → host may upgrade to an LLM title (`nameSource: llm`).
 * - Manual rename → `nameSource: user` (never overwritten).
 * - Duplicate origin labels stay stable in the automatic naming pipeline.
 */
export type SessionNameSource = 'default' | 'text' | 'llm' | 'user' | 'auto';

/**
 * Host default names are `session-<id-prefix>`. The id prefix is not always
 * hex (e.g. `session-sdk-mscy`), so match any `session-` prefix.
 */
const PLACEHOLDER_SESSION_RE = /^session-.+/i;

const DEFAULT_LABELS = new Set([
  'new chat',
  '新会话',
  'new session',
  '新对话',
  '素笺',
  'clean slate',
]);

/**
 * Internal prompt wrappers that older Desktop builds accidentally persisted as
 * the beginning of a text-derived title. Keep this deliberately narrow: the
 * repair path may rewrite only known product-generated prefixes, never an
 * arbitrary title that merely contains the word "piwin".
 */
const LEGACY_INTERNAL_NAME_PREFIX_RE =
  /^(?:\[piwin-(?:mode|prompt-meta|skill)(?::|\s|\])|operating contract for this turn\b)/i;

/** True when a text title is a known legacy model-prompt leak. */
export function isLegacyInternalSessionName(name: string | undefined | null): boolean {
  return typeof name === 'string' && LEGACY_INTERNAL_NAME_PREFIX_RE.test(name.trim());
}

/** True when the label is still a host placeholder / empty draft title. */
export function isPlaceholderSessionName(name: string | undefined | null): boolean {
  if (name === undefined || name === null) {
    return true;
  }
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return true;
  }
  if (PLACEHOLDER_SESSION_RE.test(trimmed)) {
    return true;
  }
  return DEFAULT_LABELS.has(trimmed.toLowerCase());
}

export type SessionNameFields = {
  name?: string | undefined;
  nameSource?: SessionNameSource | string | undefined;
};

/**
 * Whether this session may appear in the product session list (sidebar).
 *
 * Rules:
 * - Missing / placeholder name → not listable.
 * - `nameSource` of `text` | `llm` | `user` with a real name → listable.
 * - Legacy `auto` with a real name → listable (historical auto-names).
 * - Real name without nameSource → listable (explicit create / old data that
 *   already has a human title). Placeholder without source → not listable.
 */
export function sessionHasListName(record: SessionNameFields): boolean {
  if (isPlaceholderSessionName(record.name)) {
    return false;
  }
  const source = record.nameSource;
  if (source === 'user' || source === 'llm' || source === 'text' || source === 'auto') {
    return true;
  }
  // No / default source: allow only when the stored name is already real.
  return !isPlaceholderSessionName(record.name);
}

/** Filter a session collection to rows that may appear in the sidebar. */
export function filterListableSessions<T extends SessionNameFields>(sessions: readonly T[]): T[] {
  return sessions.filter((session) => sessionHasListName(session));
}
