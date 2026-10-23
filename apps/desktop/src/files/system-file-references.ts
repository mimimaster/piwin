/**
 * Pure detection and segmentation for file names written in system messages.
 *
 * System messages are persisted as plain text, so this deliberately does not
 * turn arbitrary URLs or prose containing dots into workspace links. Known
 * tool paths get priority; common source/config/document extensions provide a
 * safe fallback for merge summaries and older transcripts without paths.
 */

export type SystemFileReference = {
  /** Text range in the original message. */
  start: number;
  end: number;
  /** Path used to resolve/open the file. */
  path: string;
  /** Exact text shown in the message. */
  label: string;
};

export type SystemFileTextPart =
  { kind: 'text'; text: string } | { kind: 'file'; reference: SystemFileReference };

const COMMON_FILE_EXTENSIONS = new Set([
  'bash',
  'c',
  'cc',
  'cfg',
  'conf',
  'cpp',
  'cs',
  'css',
  'csv',
  'cts',
  'env',
  'fish',
  'fs',
  'fsx',
  'go',
  'gql',
  'graphql',
  'h',
  'hpp',
  'htm',
  'html',
  'ini',
  'java',
  'js',
  'json',
  'jsonc',
  'jsx',
  'kt',
  'kts',
  'less',
  'lock',
  'log',
  'markdown',
  'md',
  'mdx',
  'mjs',
  'mts',
  'php',
  'properties',
  'proto',
  'py',
  'rb',
  'rs',
  'scss',
  'sh',
  'sql',
  'svelte',
  'svg',
  'swift',
  'toml',
  'ts',
  'tsx',
  'txt',
  'vue',
  'xml',
  'yaml',
  'yml',
  'zsh',
]);

const DOMAIN_SUFFIXES = new Set(['ai', 'app', 'cn', 'co', 'com', 'dev', 'io', 'me', 'net', 'org']);

/** Common file token; known paths additionally support spaces/unusual suffixes. */
const FILE_TOKEN_PATTERN =
  /(^|[\s([{"'`:])((?:(?:[A-Za-z]:[\\/]|\/|\.{1,2}[\\/])?(?:[\p{L}\p{N}._~@+-]+[\\/])*[\p{L}\p{N}~@+-]+\.[\p{L}\p{N}_-]{1,16}))/gmu;

const TOKEN_BOUNDARY_PATTERN = /[\s()[\]{}<>,.;:!?"'`]/u;

function basename(path: string): string {
  const parts = path.split(/[\\/]/u);
  return parts[parts.length - 1] || path;
}

function extension(path: string): string | undefined {
  const match = /\.([\p{L}\p{N}_-]{1,16})$/u.exec(basename(path));
  return match?.[1]?.toLowerCase();
}

function hasPathSeparator(path: string): boolean {
  return path.includes('/') || path.includes('\\');
}

function isDomainLikePath(path: string): boolean {
  if (path.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(path) || /^\.{1,2}[\\/]/u.test(path)) {
    return false;
  }
  const firstSegment = path.split(/[\\/]/u)[0] ?? '';
  if (!firstSegment.includes('.')) {
    return false;
  }
  const suffix = extension(firstSegment);
  return suffix !== undefined && DOMAIN_SUFFIXES.has(suffix);
}

function isLikelyFilePath(path: string, allowUnknownExtension: boolean): boolean {
  const clean = path.trim();
  const fileExtension = extension(clean);
  if (!fileExtension || isDomainLikePath(clean)) {
    return false;
  }
  return (
    allowUnknownExtension || hasPathSeparator(clean) || COMMON_FILE_EXTENSIONS.has(fileExtension)
  );
}

function trimPathToken(path: string): string {
  return path.trim().replace(/^['"`]+|['"`]+$/gu, '');
}

function hasTokenBoundaries(text: string, start: number, end: number): boolean {
  const before = start > 0 ? text[start - 1] : '';
  const after = end < text.length ? text[end] : '';
  if (before && !TOKEN_BOUNDARY_PATTERN.test(before)) {
    return false;
  }
  if (after && !TOKEN_BOUNDARY_PATTERN.test(after)) {
    return false;
  }
  return true;
}

function findOccurrences(
  text: string,
  candidate: string,
  path: string,
  allowUnknownExtension: boolean,
): SystemFileReference[] {
  if (!candidate || !isLikelyFilePath(candidate, allowUnknownExtension)) {
    return [];
  }
  const references: SystemFileReference[] = [];
  let searchFrom = 0;
  while (searchFrom < text.length) {
    const index = text.indexOf(candidate, searchFrom);
    if (index < 0) {
      break;
    }
    const end = index + candidate.length;
    if (hasTokenBoundaries(text, index, end)) {
      references.push({ start: index, end, path, label: candidate });
    }
    searchFrom = end;
  }
  return references;
}

function findKnownPathReferences(
  text: string,
  knownPaths: readonly string[],
): SystemFileReference[] {
  const references: SystemFileReference[] = [];
  const uniquePaths = new Set<string>();
  const basenamePaths = new Map<string, string[]>();

  for (const rawPath of knownPaths) {
    const path = trimPathToken(rawPath);
    if (!path || uniquePaths.has(path) || !isLikelyFilePath(path, true)) {
      continue;
    }
    uniquePaths.add(path);
    const key = basename(path).toLowerCase();
    const paths = basenamePaths.get(key) ?? [];
    paths.push(path);
    basenamePaths.set(key, paths);
    references.push(...findOccurrences(text, path, path, true));
  }

  // A system summary often writes only `widget.ts` while the tool event knows
  // `src/widget.ts`. Resolve that basename only when it is unambiguous.
  for (const [fileName, paths] of basenamePaths) {
    if (paths.length !== 1) {
      continue;
    }
    const path = paths[0];
    if (!path) {
      continue;
    }
    references.push(...findOccurrences(text, fileName, path, true));
  }

  return references;
}

function findInferredReferences(text: string): SystemFileReference[] {
  const references: SystemFileReference[] = [];
  FILE_TOKEN_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FILE_TOKEN_PATTERN.exec(text)) !== null) {
    const prefix = match[1] ?? '';
    const label = match[2];
    if (!label) {
      continue;
    }
    const start = (match.index ?? 0) + prefix.length;
    if (!isLikelyFilePath(label, false)) {
      continue;
    }
    references.push({ start, end: start + label.length, path: label, label });
  }
  return references;
}

function mergeOverlappingReferences(references: SystemFileReference[]): SystemFileReference[] {
  const sorted = [...references].sort((left, right) => {
    if (left.start !== right.start) {
      return left.start - right.start;
    }
    return right.end - right.start - (left.end - left.start);
  });
  const accepted: SystemFileReference[] = [];
  for (const reference of sorted) {
    const overlaps = accepted.some(
      (existing) => reference.start < existing.end && existing.start < reference.end,
    );
    if (!overlaps) {
      accepted.push(reference);
    }
  }
  return accepted.sort((left, right) => left.start - right.start);
}

/** Find file references in plain system text without mutating the message. */
export function findSystemFileReferences(
  text: string,
  knownPaths: readonly string[] = [],
): SystemFileReference[] {
  const knownReferences = findKnownPathReferences(text, knownPaths);
  const inferredReferences = findInferredReferences(text);

  // Prefer a known tool path when an inferred basename overlaps it.
  const knownByLabel = new Map<string, string>();
  for (const reference of knownReferences) {
    if (reference.label.includes('/') || reference.label.includes('\\')) {
      continue;
    }
    const key = reference.label.toLowerCase();
    if (!knownByLabel.has(key)) {
      knownByLabel.set(key, reference.path);
    }
  }
  const resolvedInferred = inferredReferences.map((reference) => ({
    ...reference,
    path: knownByLabel.get(reference.label.toLowerCase()) ?? reference.path,
  }));

  return mergeOverlappingReferences([...knownReferences, ...resolvedInferred]);
}

/** Split text while preserving every character and newline in its original order. */
export function splitSystemFileReferences(
  text: string,
  knownPaths: readonly string[] = [],
): SystemFileTextPart[] {
  const references = findSystemFileReferences(text, knownPaths);
  if (references.length === 0) {
    return [{ kind: 'text', text }];
  }

  const parts: SystemFileTextPart[] = [];
  let cursor = 0;
  for (const reference of references) {
    if (reference.start > cursor) {
      parts.push({ kind: 'text', text: text.slice(cursor, reference.start) });
    }
    parts.push({ kind: 'file', reference });
    cursor = reference.end;
  }
  if (cursor < text.length) {
    parts.push({ kind: 'text', text: text.slice(cursor) });
  }
  return parts;
}
