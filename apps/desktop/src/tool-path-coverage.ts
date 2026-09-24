/**
 * Dedup expanded tool-card path chips: Host keeps absolute targetPaths for
 * audit, and also emits logical documentTargets. Showing both is the same file
 * twice (relative + absolute).
 */
import type { DocumentTargetRef } from '@piwin/contracts';
import { formatFilePillPath } from './activity-timeline.js';

const PATH_ARG_KEYS = new Set([
  'path',
  'file',
  'file_path',
  'filename',
  'filepath',
  'filePath',
  'target',
  'target_file',
  'targetFile',
  'target_path',
  'targetPath',
  'TargetFile',
  'TargetPath',
  'AbsolutePath',
  'absolutePath',
]);

const RANGE_ARG_KEYS = new Set([
  'offset',
  'limit',
  'line_offset',
  'line_limit',
  'lines',
  'StartLine',
  'startLine',
  'start_line',
  'EndLine',
  'endLine',
  'end_line',
]);

function posixLower(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value);
}

export function sameToolPath(
  left: string,
  right: string,
  projectPath?: string | null,
): boolean {
  const a = left.trim();
  const b = right.trim();
  if (!a || !b) return false;
  if (posixLower(a) === posixLower(b)) return true;

  const formattedA = formatFilePillPath(a, undefined, projectPath);
  const formattedB = formatFilePillPath(b, undefined, projectPath);
  if (posixLower(formattedA.relativePath) === posixLower(formattedB.relativePath)) {
    return true;
  }
  if (posixLower(formattedA.absolutePath) === posixLower(formattedB.absolutePath)) {
    return true;
  }

  const aNorm = a.replace(/\\/g, '/').toLowerCase();
  const bNorm = b.replace(/\\/g, '/').toLowerCase();
  return aNorm.endsWith(`/${posixLower(b)}`) || bNorm.endsWith(`/${posixLower(a)}`);
}

export function documentTargetCoversPath(
  target: DocumentTargetRef,
  filePath: string,
  projectPath?: string | null,
): boolean {
  const clean = filePath.replace(/\\/g, '/').trim();
  if (!clean) return false;

  if (target.kind === 'project-file') {
    return (
      sameToolPath(target.relativePath, clean, projectPath) ||
      sameToolPath(target.displayRef, clean, projectPath)
    );
  }

  if (target.kind === 'skill') {
    const skill = target.skillId.toLowerCase();
    const lower = clean.toLowerCase();
    return (
      lower.includes(`/skills/${skill}/`) ||
      lower.endsWith(`/skills/${skill}`) ||
      lower.endsWith(`/${skill}/skill.md`)
    );
  }

  if (target.kind === 'media') {
    return clean.includes(target.assetId);
  }

  if (target.kind === 'local-file') {
    return posixLower(clean) === posixLower(target.absolutePath);
  }

  const relative = target.relativePath.replace(/\\/g, '/').toLowerCase();
  const lower = clean.toLowerCase();
  return lower.endsWith(`/${relative}`) || posixLower(clean) === relative;
}

function preferDisplayPath(current: string, candidate: string): string {
  const currentAbs = isAbsolutePath(current);
  const candidateAbs = isAbsolutePath(candidate);
  if (currentAbs && !candidateAbs) return candidate;
  if (!currentAbs && candidateAbs) return current;
  return current.length <= candidate.length ? current : candidate;
}

/** Paths still worth a chip after documentTargets take the same file. */
export function visibleTargetPaths(
  paths: readonly string[],
  targets: readonly DocumentTargetRef[],
  projectPath?: string | null,
): string[] {
  const uncovered = paths.filter(
    (path) => !targets.some((target) => documentTargetCoversPath(target, path, projectPath)),
  );
  const out: string[] = [];
  for (const path of uncovered) {
    const index = out.findIndex((existing) => sameToolPath(existing, path, projectPath));
    if (index === -1) {
      out.push(path);
      continue;
    }
    const current = out[index];
    if (current !== undefined) {
      out[index] = preferDisplayPath(current, path);
    }
  }
  return out;
}

export function documentTargetCoveragePaths(targets: readonly DocumentTargetRef[]): string[] {
  const paths: string[] = [];
  for (const target of targets) {
    paths.push(target.displayRef);
    if (target.kind === 'project-file' || target.kind === 'trusted-config') {
      paths.push(target.relativePath);
    }
  }
  return paths;
}

/**
 * True when inputPreview is only the path (plus optional line range) already
 * shown as a chip — dumping the JSON just repeats the same file.
 */
export function isRedundantPathArgsPreview(
  inputPreview: string | undefined,
  shownPaths: readonly string[],
  projectPath?: string | null,
): boolean {
  if (!inputPreview || shownPaths.length === 0) return false;
  const trimmed = inputPreview.trim();
  if (!trimmed.startsWith('{')) return false;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return false;
    }
    const record = parsed as Record<string, unknown>;
    let sawPath = false;
    for (const [key, value] of Object.entries(record)) {
      if (RANGE_ARG_KEYS.has(key)) continue;
      if (PATH_ARG_KEYS.has(key) && typeof value === 'string' && value.trim()) {
        sawPath = true;
        const pathValue = value.trim();
        if (!shownPaths.some((shown) => sameToolPath(shown, pathValue, projectPath))) {
          return false;
        }
        continue;
      }
      return false;
    }
    return sawPath;
  } catch {
    return false;
  }
}
