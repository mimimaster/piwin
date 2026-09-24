/**
 * Host-side resolution of one clicked path (ADR 0052 §6).
 *
 * The client no longer guesses facts only the Host has — its own home, its
 * config root, realpath aliases, whether it is the local shell. It sends the
 * raw text once and this module answers with a `DocumentTargetRef`, or with a
 * specific reason plus the list of routes that were tried.
 *
 * Filesystem access is injected so the golden table can describe Windows
 * roots, a test config root, and remote clients deterministically.
 */
import type {
  DocumentPathAttempt,
  DocumentPathResolveData,
  DocumentPathFailureReason,
  DocumentTargetRef,
  ResourceCatalogEntry,
} from '@piwin/contracts';
import {
  expandHomePath,
  isAbsoluteDocumentPath,
  mediaTargetFromVaultPath,
  normalizeDocumentPathText,
  normalizeSlashes,
  relativeUnder,
  skillTargetFromPath,
  trustedConfigTargetFromPath,
} from './document-path-classify.js';

export type FindProjectFileOutcome =
  | { kind: 'unique'; relativePath: string }
  | { kind: 'ambiguous'; relativePaths: string[] }
  /** The registered workspace directory itself is gone (temp cleanup). */
  | { kind: 'root-missing' }
  | { kind: 'none' };

export type DocumentPathResolutionDeps = {
  /** Host config root (`~/.piwin`, a test root, or an override). */
  piwinRoot: string;
  /** Host user's home. */
  homeDir: string;
  /**
   * `denied` is the remote-client answer: the machine may well be able to read
   * the path, but the caller is not on it.
   */
  localFilePolicy?: 'allowed' | 'denied';
  skillEntries?: readonly ResourceCatalogEntry[];
  /** Realpath of an existing path, or null when it does not exist. */
  realpath: (absolutePath: string) => Promise<string | null>;
  /** True when the path exists and is a regular file. */
  isFile: (absolutePath: string) => Promise<boolean>;
  /** Bounded project search, same semantics as `project/find-file`. */
  findProjectFile?: (input: {
    projectPath: string;
    query: string;
  }) => Promise<FindProjectFileOutcome>;
};

export type ResolveDocumentPathInput = {
  rawPath: string;
  projectPath?: string | undefined;
};

function joinPath(base: string, relative: string): string {
  const root = normalizeSlashes(base).replace(/\/+$/, '');
  const tail = normalizeSlashes(relative).replace(/^\/+/, '');
  return tail ? `${root}/${tail}` : root;
}

/**
 * Interpret `rawPath` once. Never throws: an unreadable path is an answer with
 * a reason, because a thrown error becomes the generic `not-found` copy again.
 */
export async function resolveDocumentPath(
  input: ResolveDocumentPathInput,
  deps: DocumentPathResolutionDeps,
): Promise<DocumentPathResolveData> {
  const attempts: DocumentPathAttempt[] = [];
  const normalized = normalizeDocumentPathText(input.rawPath);
  if (!normalized.ok) {
    return { status: 'unresolved', reason: normalized.reason, attempts };
  }
  const rawPath = normalized.path;
  const expandedPath = expandHomePath(rawPath, deps.homeDir);
  const localFilePolicy = deps.localFilePolicy ?? 'allowed';

  const mediaTarget =
    mediaTargetFromVaultPath(rawPath, deps.piwinRoot) ??
    mediaTargetFromVaultPath(expandedPath, deps.piwinRoot);
  if (mediaTarget) {
    attempts.push({ route: 'media', reason: 'vault-asset' });
    return { status: 'resolved', target: mediaTarget, attempts };
  }
  attempts.push({ route: 'media', reason: 'not-a-vault-path' });

  const skillTarget = skillTargetFromPath(rawPath, deps.skillEntries ?? []);
  if (skillTarget) {
    attempts.push({ route: 'skill', reason: 'skill-resource' });
    return { status: 'resolved', target: skillTarget, attempts };
  }
  attempts.push({ route: 'skill', reason: 'no-skill-match' });

  const projectPath = input.projectPath?.trim();
  if (!projectPath) {
    attempts.push({ route: 'project', reason: 'no-project-context' });
  } else {
    const projectRoute = await resolveInsideProject({
      projectPath,
      rawPath,
      expandedPath,
      attempts,
      deps,
    });
    if (projectRoute) {
      return projectRoute;
    }
  }

  const trustedTarget = trustedConfigTargetFromPath(expandedPath, deps.piwinRoot, deps.homeDir);
  if (trustedTarget) {
    attempts.push({ route: 'trusted-config', reason: 'under-config-root' });
    return { status: 'resolved', target: trustedTarget, attempts };
  }
  attempts.push({ route: 'trusted-config', reason: 'not-under-config-root' });

  // A miss inside the workspace is still a *workspace* miss: saying "outside
  // the domains" would point the user at the wrong problem.
  const insideProjectMiss = attempts.some(
    (attempt) => attempt.route === 'project' && attempt.reason === 'no-such-file-in-project',
  );
  return resolveLocalFile({
    rawPath,
    expandedPath,
    attempts,
    deps,
    localFilePolicy,
    fallbackReason: insideProjectMiss ? 'not-found' : 'outside-domains',
  });
}

/** The project branch, including the bounded `find-file` fallback. */
async function resolveInsideProject(input: {
  projectPath: string;
  rawPath: string;
  expandedPath: string;
  attempts: DocumentPathAttempt[];
  deps: DocumentPathResolutionDeps;
}): Promise<DocumentPathResolveData | null> {
  const { attempts, deps } = input;
  const projectRoot = expandHomePath(input.projectPath, deps.homeDir);
  const realProjectRoot = await deps.realpath(projectRoot);
  const candidateAbsolute = isAbsoluteDocumentPath(input.rawPath)
    ? input.expandedPath
    : joinPath(projectRoot, input.rawPath);
  // Realpath both sides before comparing: a chip can name the workspace
  // through another form of the same folder (`/tmp/proj/a.md` while the
  // registered root is `/private/tmp/proj`, or a symlinked checkout).
  const realCandidate = await deps.realpath(candidateAbsolute);

  const relative =
    relativeNonEmpty(projectRoot, candidateAbsolute) ??
    (realCandidate ? relativeNonEmpty(projectRoot, realCandidate) : null) ??
    (realProjectRoot ? relativeNonEmpty(realProjectRoot, candidateAbsolute) : null) ??
    (realProjectRoot && realCandidate ? relativeNonEmpty(realProjectRoot, realCandidate) : null);

  if (relative === null) {
    attempts.push({ route: 'project', reason: 'not-inside-project-root' });
    return null;
  }
  // `project/read-file` rejects a `..` segment before touching disk, so a
  // target resolved that way could never be read: say the path leaves the
  // workspace and let the other domains answer (the local-file channel is what
  // actually reads such a chip today).
  if (relative.split('/').includes('..')) {
    attempts.push({ route: 'project', reason: 'path-escapes-project-root', detail: relative });
    return null;
  }

  if (realProjectRoot === null) {
    // The whole workspace is gone — blaming the file sends the user looking
    // for the wrong problem.
    attempts.push({ route: 'project', reason: 'project-root-missing' });
    return { status: 'unresolved', reason: 'project-root-missing', attempts };
  }

  // A file that exists on disk is read through its realpath; a path the
  // message wrote incompletely still gets the raw candidate checked, so an
  // off-root alias never silently wins.
  const verifiedPath = realCandidate ?? candidateAbsolute;
  if (await deps.isFile(verifiedPath)) {
    attempts.push({ route: 'project', reason: 'inside-project-root', detail: relative });
    return {
      status: 'resolved',
      target: { kind: 'project-file', relativePath: relative, displayRef: relative },
      attempts,
    };
  }

  attempts.push({
    route: 'project',
    reason: 'no-such-file-in-project',
    detail: relative,
  });

  const findProjectFile = deps.findProjectFile;
  if (!findProjectFile) {
    return null;
  }
  const found = await findProjectFile({ projectPath: input.projectPath, query: relative });
  if (found.kind === 'root-missing') {
    attempts.push({ route: 'find-file', reason: 'root-missing' });
    return { status: 'unresolved', reason: 'project-root-missing', attempts };
  }
  if (found.kind === 'unique') {
    attempts.push({ route: 'find-file', reason: 'unique-match', detail: found.relativePath });
    return {
      status: 'resolved',
      target: {
        kind: 'project-file',
        relativePath: found.relativePath,
        displayRef: found.relativePath,
      },
      attempts,
    };
  }
  if (found.kind === 'ambiguous') {
    attempts.push({
      route: 'find-file',
      reason: 'ambiguous-match',
      detail: found.relativePaths.slice(0, 5).join(', '),
    });
    return { status: 'unresolved', reason: 'ambiguous-file', attempts };
  }
  attempts.push({ route: 'find-file', reason: 'no-match' });
  return null;
}

/**
 * A host-absolute path the local shell may preview. A remote client gets an
 * explicit refusal instead of a target it must not follow.
 */
async function resolveLocalFile(input: {
  rawPath: string;
  expandedPath: string;
  attempts: DocumentPathAttempt[];
  deps: DocumentPathResolutionDeps;
  localFilePolicy: 'allowed' | 'denied';
  fallbackReason: DocumentPathFailureReason;
}): Promise<DocumentPathResolveData> {
  const { attempts, deps } = input;
  if (!isAbsoluteDocumentPath(input.rawPath)) {
    attempts.push({ route: 'local-file', reason: 'not-an-absolute-path' });
    return { status: 'unresolved', reason: input.fallbackReason, attempts };
  }
  if (input.localFilePolicy === 'denied') {
    attempts.push({ route: 'local-file', reason: 'channel-denied-by-remote-shell' });
    return { status: 'unresolved', reason: 'remote-local-path-denied', attempts };
  }

  const real = await deps.realpath(input.expandedPath);
  if (real === null) {
    attempts.push({ route: 'local-file', reason: 'no-such-file' });
    return { status: 'unresolved', reason: 'not-found', attempts };
  }
  if (!(await deps.isFile(real))) {
    attempts.push({ route: 'local-file', reason: 'not-a-file' });
    return { status: 'unresolved', reason: 'not-a-file', attempts };
  }
  attempts.push({ route: 'local-file', reason: 'exists' });
  const target: DocumentTargetRef = {
    kind: 'local-file',
    absolutePath: real,
    displayRef: input.rawPath,
  };
  return { status: 'resolved', target, attempts };
}

function relativeNonEmpty(root: string, candidate: string): string | null {
  const relative = relativeUnder(root, candidate);
  return relative === null || relative === '' ? null : relative;
}
