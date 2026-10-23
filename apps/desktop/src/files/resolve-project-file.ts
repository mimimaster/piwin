/**
 * Resolve a project path a message wrote incompletely.
 *
 * Agent messages name files the way a human would ("`shot.png`"), which is not
 * always a path the workspace can open: the file may live in a subfolder, or a
 * directory segment may be stale. Treating that as "file not found" contradicts
 * what the user sees on disk, so the miss is handed to `project/find-file`
 * before any failure is reported.
 *
 * Only an unambiguous, complete search resolves a path. Several matches ask
 * the user to choose; an incomplete walk resolves nothing at all — guessing
 * which `README.md` the message meant would be worse than saying so.
 */
import type { HostResponse, ProjectFileMatch, ProjectFindFileData } from '@piwin/contracts';

export type ProjectFileFindRequest = (command: {
  type: 'project/find-file';
  projectPath: string;
  query: string;
}) => Promise<HostResponse>;

export type ProjectFileResolution =
  | { kind: 'unique'; relativePath: string }
  | { kind: 'none' }
  /** The registered workspace directory itself is gone (temp cleanup). */
  | { kind: 'missing-root' }
  | { kind: 'ambiguous'; relativePaths: string[] };

function normalizeSlashes(value: string): string {
  return value
    .replace(/\\/g, '/')
    .replace(/^file:\/\//i, '')
    .trim();
}

function trimTrailingSeparators(value: string): string {
  return value.replace(/\/+$/, '');
}

/**
 * The project-relative path a chip named through another form of the same
 * workspace — `/tmp/x/a.md` while the session root is `/private/tmp/x`, or a
 * symlinked checkout. Null when the chip does not name this workspace at all,
 * so an unrelated absolute path never gets force-mapped onto the project.
 */
export function projectRelativeAliasForPath(
  absolutePath: string,
  projectPath?: string | null,
): string | null {
  const clean = normalizeSlashes(absolutePath);
  const root = trimTrailingSeparators(normalizeSlashes(projectPath ?? ''));
  if (!clean || !root) {
    return null;
  }
  if (clean === root || clean.startsWith(`${root}/`)) {
    const inside = clean.slice(root.length).replace(/^\/+/, '');
    return inside || null;
  }
  const rootName = root.split('/').pop() ?? '';
  if (!rootName) {
    return null;
  }
  const segments = clean.split('/');
  const index = segments.lastIndexOf(rootName);
  if (index < 0 || index === segments.length - 1) {
    return null;
  }
  return segments.slice(index + 1).join('/');
}

/** Trailing path segment, without query/separator noise. */
export function basenameOfPath(value: string): string {
  const clean = normalizeSlashes(value).replace(/\/+$/, '');
  return clean.split('/').pop() ?? '';
}

/**
 * Search query for an absolute path: the project-relative form when the path
 * sits inside the root, otherwise its base name (the message may have carried
 * a symlink alias of the project, so the relative form would never match).
 */
export function projectSearchQueryForPath(
  absolutePath: string,
  projectPath?: string | null,
): string | null {
  const clean = normalizeSlashes(absolutePath);
  if (!clean) {
    return null;
  }
  const root = trimTrailingSeparators(normalizeSlashes(projectPath ?? ''));
  if (root && (clean === root || clean.startsWith(`${root}/`))) {
    const relative = clean.slice(root.length).replace(/^\/+/, '');
    return relative ? relative : null;
  }
  const base = clean.split('/').pop()?.trim() ?? '';
  return base ? base : null;
}

/** Absolute path for a project-relative match (matches the browse root form). */
export function absolutePathForProjectMatch(projectPath: string, relativePath: string): string {
  return `${trimTrailingSeparators(normalizeSlashes(projectPath))}/${relativePath
    .replace(/^\/+/, '')
    .replace(/\\/g, '/')}`;
}

function asFindData(value: unknown): ProjectFindFileData | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record = value as { matches?: unknown };
  if (!Array.isArray(record.matches)) {
    return null;
  }
  return value as ProjectFindFileData;
}

function relativePathsOf(matches: readonly ProjectFileMatch[]): string[] {
  return matches
    .map((match) => (typeof match?.relativePath === 'string' ? match.relativePath : ''))
    .filter((relativePath) => relativePath.length > 0);
}

/**
 * Ask the Host where a missed path actually lives.
 * Returns `none` on a failed request so callers keep their existing fallbacks.
 */
export async function resolveProjectFilePath(input: {
  request: ProjectFileFindRequest;
  projectPath: string;
  query: string;
}): Promise<ProjectFileResolution> {
  const query = input.query.trim();
  if (!query) {
    return { kind: 'none' };
  }
  let response: HostResponse;
  try {
    response = await input.request({
      type: 'project/find-file',
      projectPath: input.projectPath,
      query,
    });
  } catch {
    return { kind: 'none' };
  }
  if (!response.success) {
    // A vanished workspace is not "no match": saying so is the whole point of
    // the search, and the user needs to know the folder is gone, not the file.
    return response.error === 'project-root-missing' ? { kind: 'missing-root' } : { kind: 'none' };
  }
  const data = asFindData(response.data);
  if (data === null) {
    return { kind: 'none' };
  }
  const relativePaths = relativePathsOf(data.matches);
  if (relativePaths.length === 0) {
    return { kind: 'none' };
  }
  if (data.truncated === true && relativePaths.length === 1) {
    // An incomplete walk cannot prove this is the only candidate, and calling
    // it ambiguous would be a lie. Report nothing and keep the caller's
    // existing fallbacks.
    return { kind: 'none' };
  }
  if (relativePaths.length === 1 && data.truncated !== true && relativePaths[0]) {
    return { kind: 'unique', relativePath: relativePaths[0] };
  }
  return { kind: 'ambiguous', relativePaths };
}

/** Absolute path of the single match, or null when the answer is not unique. */
export async function resolveProjectAbsolutePath(input: {
  request: ProjectFileFindRequest;
  projectPath: string;
  query: string;
}): Promise<string | null> {
  const resolution = await resolveProjectFilePath(input);
  if (resolution.kind !== 'unique') {
    return null;
  }
  return absolutePathForProjectMatch(input.projectPath, resolution.relativePath);
}
