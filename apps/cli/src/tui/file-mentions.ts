import type { ProjectDirEntry } from '@piwin/contracts';

/**
 * `@path` mentions in the TUI composer: finding the one under the cursor for
 * completion, and collecting the ones in a submitted message. Pure — the Host
 * decides which mentions name a real file (project-files.ts).
 *
 * A path with spaces is written `@"docs/user guide.md"`.
 */

export type MentionAtCursor = {
  /** Text from the `@` to the cursor: what a completion replaces. */
  prefix: string;
  /** Directory part already typed, without a trailing slash (`''` = project root). */
  directory: string;
  /** Partial entry name after the last slash. */
  namePart: string;
};

const TRAILING_PUNCTUATION = /[,.;:!?)\]}，。；：！？）】」』、]+$/u;
/** Full-width punctuation ends an unquoted mention: Chinese prose rarely puts a space there. */
const MENTION_PATTERN = /(^|\s)@(?:"([^"\n]+)"|([^\s"，。；：！？、（）【】「」『』]+))/gu;
const MAX_SUGGESTIONS = 50;

export function findMentionAtCursor(textBeforeCursor: string): MentionAtCursor | undefined {
  const match = /(?:^|\s)(@(?:"([^"\n]*)|([^\s"]*)))$/u.exec(textBeforeCursor);
  if (match === null) return undefined;
  const prefix = match[1] ?? '';
  const typed = (match[2] ?? match[3] ?? '').replace(/^\.\//, '');
  const slash = typed.lastIndexOf('/');
  return {
    prefix,
    directory: slash === -1 ? '' : typed.slice(0, slash),
    namePart: slash === -1 ? typed : typed.slice(slash + 1),
  };
}

/** Distinct project-relative paths mentioned in a message, in order of appearance. */
export function extractMentionPaths(text: string): string[] {
  const paths: string[] = [];
  for (const match of text.matchAll(MENTION_PATTERN)) {
    const raw = match[2] ?? (match[3] ?? '').replace(TRAILING_PUNCTUATION, '');
    const path = normalizeMentionPath(raw);
    if (path !== undefined && !paths.includes(path)) paths.push(path);
  }
  return paths;
}

/**
 * `@src/a.ts和别的` has no space before the prose. When the path as typed names
 * nothing, the part before the first non-ASCII run is worth one more try.
 */
export function mentionWithoutTrailingProse(path: string): string | undefined {
  const trimmed = path.replace(/[^\x00-\x7F].*$/u, '').replace(/\/+$/, '');
  return trimmed.length > 0 && trimmed !== path ? trimmed : undefined;
}

/** Project-relative posix path, or undefined for anything that could leave the project. */
export function normalizeMentionPath(raw: string): string | undefined {
  const path = raw.trim().replace(/^\.\//, '').replace(/\/+$/, '');
  if (path.length === 0 || path.length > 512) return undefined;
  if (path.startsWith('/') || path.startsWith('~') || path.includes('\\') || /^[A-Za-z]:/.test(path)) {
    return undefined;
  }
  if (path.split('/').some((segment) => segment === '..' || segment.length === 0)) return undefined;
  return path;
}

/** Entries whose name starts with the typed part first, then those containing it; directories lead. */
export function rankDirEntries(entries: readonly ProjectDirEntry[], namePart: string): ProjectDirEntry[] {
  const needle = namePart.toLowerCase();
  const rank = (entry: ProjectDirEntry): number => {
    const name = entry.name.toLowerCase();
    if (needle.length === 0 || name.startsWith(needle)) return 0;
    return name.includes(needle) ? 1 : 2;
  };
  return entries
    .filter((entry) => rank(entry) < 2)
    .sort(
      (left, right) =>
        rank(left) - rank(right) ||
        Number(right.kind === 'directory') - Number(left.kind === 'directory') ||
        left.name.localeCompare(right.name),
    )
    .slice(0, MAX_SUGGESTIONS);
}

/**
 * Entries anywhere in the project matching a typed fragment. A hit in the
 * file name beats a hit in a parent directory, and shallower paths come first.
 */
export function rankIndexedEntries(
  entries: readonly ProjectDirEntry[],
  fragment: string,
  limit: number,
): ProjectDirEntry[] {
  const needle = fragment.toLowerCase();
  if (needle.length === 0) return [];
  const rank = (entry: ProjectDirEntry): number => {
    const name = entry.name.toLowerCase();
    if (name.startsWith(needle)) return 0;
    if (name.includes(needle)) return 1;
    return entry.relativePath.toLowerCase().includes(needle) ? 2 : 3;
  };
  return entries
    .filter((entry) => rank(entry) < 3)
    .sort(
      (left, right) =>
        rank(left) - rank(right) ||
        left.relativePath.split('/').length - right.relativePath.split('/').length ||
        left.relativePath.localeCompare(right.relativePath),
    )
    .slice(0, limit);
}

/** What a completion inserts: `@src/` keeps completing, a file ends the mention. */
export function mentionCompletionValue(relativePath: string, kind: ProjectDirEntry['kind']): string {
  const path = kind === 'directory' ? `${relativePath}/` : relativePath;
  return path.includes(' ') ? `@"${path}"` : `@${path}`;
}
