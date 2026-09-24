/**
 * Enrich ToolPresentation with logical documentTargets without rewriting
 * targetPaths (audit evidence stays as the tool actually saw them).
 *
 * Path interpretation lives in `document-path-classify.ts` — the same
 * classifier the Host uses for `preview/resolve-path` — so a tool card and a
 * clicked chip can never disagree about what a path means. Tool cards only
 * carry *logical* targets: a host-absolute `local-file` target is produced by
 * the resolve command for a local shell only, never projected remotely.
 */
import type { AgentEvent, DocumentTargetRef, ToolPresentation } from '@piwin/contracts';
import { homedir } from 'node:os';
import {
  expandHomePath,
  mediaTargetFromVaultPath,
  normalizeDocumentPathText,
  normalizeSlashes,
  skillTargetFromPath,
  trustedConfigTargetFromPath,
} from './document-path-classify.js';

export type DocumentTargetEnrichmentContext = {
  projectPath?: string | null;
  /** Skill catalog entries for the current session (kind=skill). */
  skillEntries?: readonly import('@piwin/contracts').ResourceCatalogEntry[];
  /** Host config root (`~/.piwin` or override). Used for trusted-config targets. */
  piwinRoot?: string | null;
  /** Host user's home. Defaults to this process's home (the Host's own). */
  homeDir?: string;
};

/**
 * Map one tool path string into zero or more logical document targets.
 * targetPaths themselves are never mutated by the caller.
 */
export function buildDocumentTargetsForPath(
  filePath: string,
  context: DocumentTargetEnrichmentContext,
): DocumentTargetRef[] {
  const normalized = normalizeDocumentPathText(filePath);
  if (!normalized.ok) return [];
  const homeDir = context.homeDir ?? homedir();
  const target = classifyLogicalDocumentTarget({
    rawPath: normalized.path,
    expandedPath: expandHomePath(normalized.path, homeDir),
    projectPath: context.projectPath,
    piwinRoot: context.piwinRoot,
    skillEntries: context.skillEntries ?? [],
    homeDir,
  });
  return target ? [target] : [];
}

type LogicalDocumentTargetInput = {
  /** Raw clicked/written text, scheme already stripped. */
  rawPath: string;
  /** `~` expanded with the Host user's home. */
  expandedPath: string;
  projectPath?: string | null | undefined;
  piwinRoot?: string | null | undefined;
  skillEntries: readonly import('@piwin/contracts').ResourceCatalogEntry[];
  homeDir: string;
};

/**
 * Which logical (path-free, remote-safe) route a path names. Order is
 * media → skill → project → config store, and the first match wins: a vault
 * asset stays a vault asset even under an odd project root, and a skill path
 * is never re-read as a project file.
 */
function classifyLogicalDocumentTarget(
  input: LogicalDocumentTargetInput,
): DocumentTargetRef | null {
  const mediaTarget =
    mediaTargetFromVaultPath(input.rawPath, input.piwinRoot) ??
    mediaTargetFromVaultPath(input.expandedPath, input.piwinRoot);
  if (mediaTarget) {
    return mediaTarget;
  }

  const skillTarget = skillTargetFromPath(input.rawPath, input.skillEntries);
  if (skillTarget) {
    return skillTarget;
  }

  const projectPath = input.projectPath?.trim();
  if (projectPath) {
    const relative = relativeToProject(projectPath, input.expandedPath);
    if (relative !== null && relative !== '') {
      return { kind: 'project-file', relativePath: relative, displayRef: relative };
    }
  }
  // Bare relative path (no leading slash / drive / home marker) → project-file.
  if (projectPath && !isAbsoluteDocumentPath(input.rawPath)) {
    const relative = normalizeSlashes(input.rawPath).replace(/^\/+/, '');
    if (relative) {
      return { kind: 'project-file', relativePath: relative, displayRef: relative };
    }
  }

  return trustedConfigTargetFromPath(input.expandedPath, input.piwinRoot, input.homeDir);
}

/** Project-relative form of `filePath`, or null when it is not under the root. */
function relativeToProject(projectPath: string, filePath: string): string | null {
  const root = normalizeSlashes(projectPath).replace(/\/+$/, '');
  const candidate = normalizeSlashes(filePath).trim();
  if (!root || !candidate) return null;
  const rootKey = root.toLowerCase();
  const candidateKey = candidate.toLowerCase();
  if (candidateKey === rootKey) return '';
  if (candidateKey.startsWith(`${rootKey}/`)) {
    return candidate.slice(root.length + 1);
  }
  return null;
}

function isAbsoluteDocumentPath(value: string): boolean {
  return (
    value.startsWith('/') ||
    /^[A-Za-z]:[\\/]/.test(value) ||
    // `~/x` is a user-space location: never a project-relative path.
    /^~[\\/]/.test(value) ||
    value === '~'
  );
}

export function enrichToolPresentationDocumentTargets(
  presentation: ToolPresentation,
  context: DocumentTargetEnrichmentContext,
): ToolPresentation {
  if (presentation.documentTargets && presentation.documentTargets.length > 0) {
    return presentation;
  }
  const pathSources = [...(presentation.targetPaths ?? []), ...(presentation.changedPaths ?? [])];
  if (pathSources.length === 0) {
    return presentation;
  }
  const seen = new Set<string>();
  const documentTargets: DocumentTargetRef[] = [];
  for (const pathValue of pathSources) {
    for (const target of buildDocumentTargetsForPath(pathValue, context)) {
      const key = documentTargetKey(target);
      if (seen.has(key)) continue;
      seen.add(key);
      documentTargets.push(target);
    }
  }
  if (documentTargets.length === 0) {
    return presentation;
  }
  return { ...presentation, documentTargets };
}

/** Stable de-duplication key for one logical target. */
function documentTargetKey(target: DocumentTargetRef): string {
  switch (target.kind) {
    case 'skill':
      return `skill:${target.skillId}`;
    case 'media':
      return `media:${target.sessionId}/${target.assetId}`;
    case 'trusted-config':
      return `trusted:${target.relativePath}`;
    case 'local-file':
      return `local:${target.absolutePath}`;
    case 'project-file':
      return `project:${target.relativePath}`;
  }
}

/** Enrich tool/* AgentEvents; leave other events unchanged. */
export function enrichAgentEventDocumentTargets(
  event: AgentEvent,
  context: DocumentTargetEnrichmentContext,
): AgentEvent {
  if (event.type !== 'tool/start' && event.type !== 'tool/update' && event.type !== 'tool/end') {
    return event;
  }
  if (!event.presentation) {
    return event;
  }
  const presentation = enrichToolPresentationDocumentTargets(event.presentation, context);
  if (presentation === event.presentation) {
    return event;
  }
  return { ...event, presentation };
}

/**
 * Skill id a Host path names, by path shape only (UI hint). Kept exported for
 * the desktop-facing enrichment tests.
 */
export { extractSkillIdFromPath } from './document-path-classify.js';
