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
  /** Host config root (`~/.piwin` or override). Used for trusted-config targets. */
  piwinRoot?: string | null;
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

  // Media vault assets resolve to a logical media target (ADR 0052): the
  // click entry point stops carrying host paths, and remote clients address
  // bytes by sessionId + assetId through media/read.
  const mediaTarget = mediaTargetFromVaultPath(clean);
  if (mediaTarget) {
    return [mediaTarget];
  }

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

  const trustedTarget = trustedConfigTargetFromPath(clean, context.piwinRoot);
  if (trustedTarget) {
    return [trustedTarget];
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
          : target.kind === 'media'
            ? `media:${target.sessionId}/${target.assetId}`
            : target.kind === 'trusted-config'
              ? `trusted:${target.relativePath}`
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

/** Safe id segment for vault-derived session/asset ids (no traversal). */
const SAFE_VAULT_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/**
 * Derive a logical media target from a `~/.piwin/media/<sessionId>/<assetId><ext>`
 * vault path. Returns null unless both segments are safe ids — never forwards
 * a host path onward.
 */
function mediaTargetFromVaultPath(filePath: string): DocumentTargetRef | null {
  const normalized = filePath.replace(/\\/g, '/');
  const match = normalized.match(/\/\.piwin\/media\/([^/]+)\/([^/]+)$/);
  if (!match?.[1] || !match?.[2]) {
    return null;
  }
  const sessionId = match[1];
  const assetId = match[2].replace(/\.[a-zA-Z0-9]{1,12}$/, '');
  if (!SAFE_VAULT_SEGMENT.test(sessionId) || !SAFE_VAULT_SEGMENT.test(assetId)) {
    return null;
  }
  return {
    kind: 'media',
    sessionId,
    assetId,
    displayRef: match[2],
  };
}

/**
 * Derive a logical trusted-config target from a Host config-root path.
 * Media vault files stay on the media channel; the config root itself is
 * not a previewable file.
 */
function trustedConfigTargetFromPath(
  filePath: string,
  piwinRoot: string | null | undefined,
): DocumentTargetRef | null {
  const root = piwinRoot?.trim();
  if (!root) {
    return null;
  }
  const relative = relativeToProject(root, filePath);
  if (relative === null || relative === '') {
    return null;
  }
  const posix = relative.replace(/\\/g, '/');
  if (posix.includes('..') || posix === 'media' || posix.startsWith('media/')) {
    return null;
  }
  return {
    kind: 'trusted-config',
    relativePath: posix,
    displayRef: `~/.piwin/${posix}`,
  };
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
