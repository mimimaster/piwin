/**
 * `/codebase` virtual-root path mapping for the `code_search` search subagent.
 *
 * The subagent never sees real filesystem paths: prompts, restricted commands
 * and the final `<ANSWER>` all speak `/codebase`, and every path is mapped
 * back into the search root here. Anything that would escape the root is
 * rejected instead of clamped.
 *
 * Evidence: docs/research/2026-09-19-devin-code-search-verified.md §3
 */
import { isAbsolute, relative, resolve, sep } from 'node:path';

/** Virtual root every subagent path is expressed against. */
export const CODE_SEARCH_VIRTUAL_ROOT = '/codebase';

/** Why a virtual path could not be mapped into the search root. */
export type CodeSearchPathFailure =
  /** Missing / blank value. */
  | 'empty'
  /** Not absolute, or not under {@link CODE_SEARCH_VIRTUAL_ROOT}. */
  | 'not-virtual'
  /** Resolves above or beside the search root (`..`, absolute escape). */
  | 'outside-root';

/** Result of mapping a virtual path back into the real filesystem. */
export type CodeSearchPathResult =
  | { ok: true; absolutePath: string }
  | { ok: false; failure: CodeSearchPathFailure; value: string };

/** Whether `absolutePath` is the root itself or a descendant of it. */
export function isInsideRoot(root: string, absolutePath: string): boolean {
  const rel = relative(resolve(root), resolve(absolutePath));
  if (rel === '') {
    return true;
  }
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/**
 * Map a `/codebase…` path to an absolute path inside `root`.
 *
 * Rejects blank input, foreign prefixes (`/etc/passwd`, `/workspace/src`) and
 * any `..` traversal that resolves outside the root.
 */
export function resolveVirtualPath(root: string, virtualPath: string): CodeSearchPathResult {
  if (typeof virtualPath !== 'string' || !virtualPath.trim()) {
    return { ok: false, failure: 'empty', value: String(virtualPath ?? '') };
  }
  const normalized = virtualPath.trim().replace(/\\/g, '/');
  const isRoot = normalized === CODE_SEARCH_VIRTUAL_ROOT;
  if (!isRoot && !normalized.startsWith(`${CODE_SEARCH_VIRTUAL_ROOT}/`)) {
    return { ok: false, failure: 'not-virtual', value: normalized };
  }
  const suffix = normalized.slice(CODE_SEARCH_VIRTUAL_ROOT.length).replace(/^\/+/, '');
  const absolutePath = suffix ? resolve(root, suffix) : resolve(root);
  if (!isInsideRoot(root, absolutePath)) {
    return { ok: false, failure: 'outside-root', value: normalized };
  }
  return { ok: true, absolutePath };
}

/** Best-effort inverse of {@link resolveVirtualPath}; undefined outside the root. */
export function toVirtualPath(root: string, absolutePath: string): string | undefined {
  if (typeof absolutePath !== 'string' || !absolutePath.trim()) {
    return undefined;
  }
  if (!isInsideRoot(root, absolutePath)) {
    return undefined;
  }
  const rel = relative(resolve(root), resolve(absolutePath)).replace(/\\/g, '/');
  return rel ? `${CODE_SEARCH_VIRTUAL_ROOT}/${rel}` : CODE_SEARCH_VIRTUAL_ROOT;
}

/**
 * Turn a path from the subagent's `<ANSWER>` into a repo-relative path.
 *
 * Accepts both `/codebase/…` and a bare repo-relative path, because the model
 * occasionally drops the prefix. Traversal and foreign absolute paths fail.
 */
export function toRepoRelativePath(root: string, candidate: string): string | undefined {
  if (typeof candidate !== 'string' || !candidate.trim()) {
    return undefined;
  }
  const trimmed = candidate.trim().replace(/\\/g, '/');
  if (trimmed === CODE_SEARCH_VIRTUAL_ROOT || trimmed.startsWith(`${CODE_SEARCH_VIRTUAL_ROOT}/`)) {
    const mapped = resolveVirtualPath(root, trimmed);
    if (!mapped.ok) {
      return undefined;
    }
    const rel = relative(resolve(root), mapped.absolutePath).replace(/\\/g, '/');
    return rel || undefined;
  }
  // A bare relative path is only meaningful if it stays inside the root.
  if (isAbsolute(trimmed)) {
    return undefined;
  }
  const absolutePath = resolve(root, trimmed);
  if (!isInsideRoot(root, absolutePath)) {
    return undefined;
  }
  const rel = relative(resolve(root), absolutePath).replace(/\\/g, '/');
  return rel || undefined;
}

/**
 * True when the value looks like a URI (`file:`, `vscode:`, `https:`).
 *
 * A Windows drive path (`C:\projects\app`) also starts with `letter:`, so
 * single-letter drive prefixes are excluded before the scheme test.
 */
export function hasUriScheme(value: string): boolean {
  const trimmed = value.trim();
  if (/^[a-z]:[\\/]/i.test(trimmed)) {
    return false;
  }
  return /^[a-z][a-z0-9+.-]*:/i.test(trimmed);
}

/** Result of validating the main agent's `search_folder_absolute_uri`. */
export type SearchFolderCheck = { ok: true; absolutePath: string } | { ok: false; message: string };

/**
 * Validate the tool's `search_folder_absolute_uri` argument.
 *
 * Devin's contract requires an absolute folder path, not a URI, and the error
 * text is part of the observed tool surface.
 */
export function checkSearchFolder(candidate: unknown): SearchFolderCheck {
  if (typeof candidate !== 'string' || !candidate.trim()) {
    return {
      ok: false,
      message: 'search_folder_absolute_uri cannot be empty; pass the absolute path of the folder to search in',
    };
  }
  const trimmed = candidate.trim();
  if (hasUriScheme(trimmed)) {
    return {
      ok: false,
      message: `search_folder_absolute_uri must be an absolute filesystem path, not a URI: ${trimmed}`,
    };
  }
  if (!isAbsolute(trimmed)) {
    return {
      ok: false,
      message: `search_folder_absolute_uri must be an absolute path: ${trimmed}`,
    };
  }
  return { ok: true, absolutePath: resolve(trimmed) };
}

/**
 * Error text handed back to the subagent when a path is refused. Mirrors
 * Devin's observed wording so the model can self-correct the same way.
 */
export function describePathFailure(kind: string, failure: CodeSearchPathFailure, value: string): string {
  if (failure === 'empty') {
    return `Error: ${kind} cannot be empty`;
  }
  if (failure === 'not-virtual') {
    return `Error: ${kind} must be under ${CODE_SEARCH_VIRTUAL_ROOT}: ${value}`;
  }
  return `Error: ${kind} must stay within ${CODE_SEARCH_VIRTUAL_ROOT}: ${value}`;
}
