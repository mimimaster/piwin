/**
 * Enrich ToolPresentation with logical documentTargets without rewriting
 * targetPaths (audit evidence stays as the tool actually saw them).
 */
import type {
  AgentEvent,
  DocumentTargetRef,
  ResourceCatalogEntry,
  ToolPresentation,
} from '@piwin/contracts';
import { normalizeResourceId } from '@piwin/contracts';

export type DocumentTargetEnrichmentContext = {
  projectPath?: string | null;
  /** Skill catalog entries for the current session (kind=skill). */
  skillEntries?: readonly ResourceCatalogEntry[];
};

/**
 * Map one tool path string into zero or more logical document targets.
 * targetPaths themselves are never mutated by the caller.
 */
export function buildDocumentTargetsForPath(
  filePath: string,
  context: DocumentTargetEnrichmentContext,
): DocumentTargetRef[] {
  const clean = filePath.replace(/^file:\/\//, '').trim();
  if (!clean) return [];

  const skillHit = matchSkillEntry(clean, context.skillEntries ?? []);
  if (skillHit) {
    const effectiveSource = skillHit.source === 'pi-native' ? undefined : skillHit.source;
    return [
      {
        kind: 'skill',
        skillId: skillHit.resourceId,
        displayRef: `skill:${skillHit.resourceId}`,
        ...(effectiveSource !== undefined ? { effectiveSource } : {}),
      },
    ];
  }

  // Bundle / installed skill layout without catalog entry: still emit skill ref
  // from path shape so Desktop can call skills/read.
  const skillIdFromPath = extractSkillIdFromPath(clean);
  if (skillIdFromPath) {
    return [
      {
        kind: 'skill',
        skillId: skillIdFromPath,
        displayRef: `skill:${skillIdFromPath}`,
      },
    ];
  }

  const projectPath = context.projectPath?.trim();
  if (projectPath) {
    const relative = relativeToProject(projectPath, clean);
    if (relative !== null) {
      return [
        {
          kind: 'project-file',
          relativePath: relative,
          displayRef: relative,
        },
      ];
    }
  }

  // Bare relative path (no leading slash / drive) → project-file when project known.
  if (projectPath && !isAbsolutePath(clean)) {
    const relative = clean.replace(/\\/g, '/').replace(/^\/+/, '');
    return [
      {
        kind: 'project-file',
        relativePath: relative,
        displayRef: relative,
      },
    ];
  }

  return [];
}

export function enrichToolPresentationDocumentTargets(
  presentation: ToolPresentation,
  context: DocumentTargetEnrichmentContext,
): ToolPresentation {
  if (presentation.documentTargets && presentation.documentTargets.length > 0) {
    return presentation;
  }
  const pathSources = [
    ...(presentation.targetPaths ?? []),
    ...(presentation.changedPaths ?? []),
  ];
  if (pathSources.length === 0) {
    return presentation;
  }
  const seen = new Set<string>();
  const documentTargets: DocumentTargetRef[] = [];
  for (const pathValue of pathSources) {
    for (const target of buildDocumentTargetsForPath(pathValue, context)) {
      const key =
        target.kind === 'skill'
          ? `skill:${target.skillId}`
          : `project:${target.relativePath}`;
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

/** Enrich tool/* AgentEvents; leave other events unchanged. */
export function enrichAgentEventDocumentTargets(
  event: AgentEvent,
  context: DocumentTargetEnrichmentContext,
): AgentEvent {
  if (
    event.type !== 'tool/start' &&
    event.type !== 'tool/update' &&
    event.type !== 'tool/end'
  ) {
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

function matchSkillEntry(
  filePath: string,
  entries: readonly ResourceCatalogEntry[],
): ResourceCatalogEntry | null {
  const normalized = normalizePath(filePath);
  for (const entry of entries) {
    if (entry.kind !== 'skill') continue;
    const skillPath = normalizePath(entry.path);
    if (
      normalized === skillPath ||
      normalized === `${skillPath}/skill.md` ||
      normalized.startsWith(`${skillPath}/`)
    ) {
      return entry;
    }
  }
  // Match by extracted id when path is under a skills root.
  const extracted = extractSkillIdFromPath(filePath);
  if (!extracted) return null;
  for (const entry of entries) {
    if (entry.kind !== 'skill') continue;
    if (entry.resourceId === extracted || safeId(entry.name) === extracted) {
      return entry;
    }
  }
  return null;
}

export function extractSkillIdFromPath(filePath: string): string | null {
  const normalized = normalizePath(filePath);
  const skillMd = normalized.match(/\/skills\/([^/]+)\/skill\.md$/);
  if (skillMd?.[1]) return safeId(skillMd[1]);
  const skillDir = normalized.match(/\/skills\/([^/]+)\/?$/);
  if (skillDir?.[1] && !skillDir[1].includes('.')) return safeId(skillDir[1]);
  if (/\/skill\.md$/.test(normalized)) {
    const parts = normalized.split('/').filter(Boolean);
    const parent = parts.length >= 2 ? parts[parts.length - 2] : null;
    if (parent && parent !== 'skills') return safeId(parent);
  }
  return null;
}

function relativeToProject(projectPath: string, filePath: string): string | null {
  const root = projectPath.replace(/\\/g, '/').replace(/^file:\/\//, '').trim().replace(/\/+$/, '');
  const candidate = filePath.replace(/\\/g, '/').replace(/^file:\/\//, '').trim();
  // Case-insensitive compare for Windows-ish roots; keep original relative casing.
  const rootKey = root.toLowerCase();
  const candidateKey = candidate.toLowerCase();
  if (candidate === root) return '';
  if (candidateKey === rootKey) return '';
  if (candidateKey.startsWith(`${rootKey}/`)) {
    return candidate.slice(root.length + 1);
  }
  return null;
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value);
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^file:\/\//, '').trim().toLowerCase();
}

function safeId(value: string): string | null {
  try {
    return normalizeResourceId(value);
  } catch {
    return null;
  }
}
