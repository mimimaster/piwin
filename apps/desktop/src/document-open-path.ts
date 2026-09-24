/**
 * Pure helpers for Desktop document open routing (Slice 1+).
 *
 * Desktop must not invent a project root from dirname(absolutePath).
 * Only paths under the active workspace projectPath may use project/read-file.
 * Media vault paths / remote-asset refs dispatch to the media viewer by store
 * identity (ADR 0052). Skill / host absolute paths are classified as legacy.
 */
import { configStoreRelativePath } from '@piwin/contracts';
import { isPiwinMediaPath, isRemoteMediaAssetRef, REMOTE_MEDIA_ASSET_PREFIX } from './media-path';

export type DocumentOpenPathKind =
  | 'media'
  | 'project'
  | 'skill-legacy'
  | 'trusted-config'
  | 'legacy-absolute'
  | 'relative-outside'
  | 'empty';

export type DocumentOpenPathPlan =
  | {
      kind: 'media';
      absolutePath: string;
      /** Opaque asset id when the ref came from the remote projection. */
      assetId: string | null;
      displayPath: string;
    }
  | {
      kind: 'project';
      projectPath: string;
      relativePath: string;
      displayPath: string;
    }
  | {
      kind: 'skill-legacy';
      absolutePath: string;
      skillIdHint: string | null;
      displayPath: string;
    }
  | {
      kind: 'trusted-config';
      relativePath: string;
      displayPath: string;
    }
  | {
      kind: 'legacy-absolute';
      absolutePath: string;
      displayPath: string;
    }
  | {
      kind: 'relative-outside';
      path: string;
      displayPath: string;
    }
  | {
      kind: 'empty';
      displayPath: string;
    };

function normalizeSeparators(value: string): string {
  return value.replace(/\\/g, '/');
}

/**
 * Home-relative paths such as `~/notes.md` name the Host user's home, never
 * the workspace. Without this they took the project-relative branch and
 * resolved inside the active project, so a `~/.piwin/...` chip read as
 * not-found.
 */
function isHomeRelativePath(value: string): boolean {
  return /^~[\\/]/.test(value);
}

/**
 * True when `candidatePath` is the project root or a path under it.
 * Uses normalized string prefix with a boundary check (no naive prefix match).
 */
export function isPathInsideProjectRoot(
  projectPath: string | null | undefined,
  candidatePath: string,
): boolean {
  const root = (projectPath ?? '').trim();
  const candidate = candidatePath.trim();
  if (!root || !candidate) {
    return false;
  }
  const rootNorm = normalizeSeparators(root).replace(/\/+$/, '');
  const candidateNorm = normalizeSeparators(candidate);
  if (candidateNorm === rootNorm) {
    return true;
  }
  return candidateNorm.startsWith(`${rootNorm}/`);
}

/**
 * Plan how Desktop should open a path for Doc Preview.
 *
 * - project: only when path is under active projectPath → project/read-file
 * - legacy-absolute: absolute path outside project (skills, bundle, etc.) —
 *   do NOT call project/read-file; later slices use skills/read or snapshot
 * - relative-outside: relative path without a project context
 * - empty: no path
 */

/**
 * Best-effort skill id from a Host absolute path (UI hint only).
 * Host still re-resolves via skills/read; Desktop must not invent roots.
 */
export function extractSkillIdHintFromPath(filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, '/').replace(/^file:\/\//, '');
  const skillMd = normalized.match(/\/skills\/([^/]+)\/SKILL\.md$/i);
  if (skillMd?.[1]) return skillMd[1].toLowerCase();
  const skillDir = normalized.match(/\/skills\/([^/]+)\/?$/i);
  if (skillDir?.[1] && !skillDir[1].includes('.')) return skillDir[1].toLowerCase();
  if (/\/SKILL\.md$/i.test(normalized)) {
    const parts = normalized.split('/').filter(Boolean);
    const parent = parts.length >= 2 ? parts[parts.length - 2] : null;
    if (parent && parent !== 'skills') return parent.toLowerCase();
  }
  return null;
}

/**
 * True when the user clicked an extension mention such as `.svg` or `.html`,
 * not a real file name. Those must recover from the transcript, not the
 * workspace filesystem.
 */
export function isBareExtensionPath(path: string): boolean {
  return /^\.[A-Za-z][A-Za-z0-9]*$/.test(path.trim());
}

function looksLikeSkillPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return (
    /\/skills\/[^/]+\/SKILL\.md$/i.test(normalized) ||
    /\/skills\/[^/]+\/?$/i.test(normalized) ||
    /\/host\/skills\//i.test(normalized) ||
    // Product config root is `~/.piwin`, but local/dev hosts use `~/.piwin-test`.
    /(?:^|\/)\.piwin(?:-[^/]+)?\/skills\//i.test(normalized)
  );
}

export function planDocumentOpenPath(input: {
  path: string;
  projectPath?: string | null | undefined;
  /** Host config root (`~/.piwin`). Used to classify trusted-config text. */
  configRoot?: string | null | undefined;
}): DocumentOpenPathPlan {
  const cleanPath = (input.path || '').replace(/^file:\/\//, '').trim();
  if (!cleanPath) {
    return { kind: 'empty', displayPath: '' };
  }

  const projectPath = input.projectPath?.trim() || null;

  // Media dispatch is by STORE IDENTITY and takes precedence over the project
  // branch: vault assets always preview through the media viewer, even under
  // an unusual project root. Extension sniffing never grants read authority.
  if (isRemoteMediaAssetRef(cleanPath)) {
    return {
      kind: 'media',
      absolutePath: cleanPath,
      assetId: cleanPath.slice(REMOTE_MEDIA_ASSET_PREFIX.length),
      displayPath: cleanPath,
    };
  }
  if (isPiwinMediaPath(cleanPath) && /^([A-Za-z]:[\\/]|\/)/.test(cleanPath)) {
    return {
      kind: 'media',
      absolutePath: cleanPath,
      assetId: null,
      displayPath: cleanPath,
    };
  }

  if (projectPath && isPathInsideProjectRoot(projectPath, cleanPath)) {
    const rootNorm = normalizeSeparators(projectPath).replace(/\/+$/, '');
    const candidateNorm = normalizeSeparators(cleanPath);
    const relativePath =
      candidateNorm === rootNorm
        ? ''
        : candidateNorm.slice(rootNorm.length).replace(/^\/+/, '');
    return {
      kind: 'project',
      projectPath,
      relativePath,
      displayPath: cleanPath,
    };
  }

  // Relative path that looks project-relative when we have a project root.
  // Home-relative paths are absolute user locations, not workspace paths.
  const looksAbsolute =
    cleanPath.startsWith('/') ||
    /^[A-Za-z]:[\\/]/.test(cleanPath) ||
    isHomeRelativePath(cleanPath);
  if (!looksAbsolute && projectPath) {
    return {
      kind: 'project',
      projectPath,
      relativePath: normalizeSeparators(cleanPath).replace(/^\/+/, ''),
      displayPath: cleanPath,
    };
  }

  if (looksAbsolute) {
    if (looksLikeSkillPath(cleanPath)) {
      return {
        kind: 'skill-legacy',
        absolutePath: cleanPath,
        skillIdHint: extractSkillIdHintFromPath(cleanPath),
        displayPath: cleanPath,
      };
    }
    const trustedRelative = trustedConfigRelativeFromPath(cleanPath, input.configRoot);
    if (trustedRelative) {
      return {
        kind: 'trusted-config',
        relativePath: trustedRelative,
        displayPath: cleanPath,
      };
    }
    return {
      kind: 'legacy-absolute',
      absolutePath: cleanPath,
      displayPath: cleanPath,
    };
  }

  return {
    kind: 'relative-outside',
    path: cleanPath,
    displayPath: cleanPath,
  };
}

/**
 * Human-readable unavailable stub when no disk/transcript body is available.
 * Kept as Markdown for the current DocPreview content slot (Slice 4 upgrades UI).
 */
export function buildDocumentUnavailableStub(input: {
  title: string;
  displayPath: string;
  reason: 'outside-project' | 'not-found' | 'no-path';
  locale?: 'zh-CN' | 'en';
}): string {
  const locale = input.locale ?? 'zh-CN';
  if (locale === 'en') {
    if (input.reason === 'outside-project') {
      return [
        `# ${input.title}`,
        '',
        `*Cannot preview this path as a project file.*`,
        '',
        `Path: \`${input.displayPath}\``,
        '',
        `This location is outside the active workspace. Skill and Host resource previews use a separate read path (coming online).`,
      ].join('\n');
    }
    return [
      `# ${input.title}`,
      '',
      `*No file content found at \`${input.displayPath}\`.*`,
    ].join('\n');
  }

  if (input.reason === 'outside-project') {
    return [
      `# ${input.title}`,
      '',
      `*无法将此路径作为项目文件预览。*`,
      '',
      `路径：\`${input.displayPath}\``,
      '',
      `该位置不在当前工作区内。Skill / Host 资源预览将走独立读取接口（后续切片接入）。`,
    ].join('\n');
  }

  return [
    `# ${input.title}`,
    '',
    `*暂未在路径 \`${input.displayPath}\` 找到文件内容*`,
  ].join('\n');
}

/**
 * Where the product config store lives unless the Host says otherwise. A
 * remote Host never reports its root (paths are projected out), so this is the
 * best claim a remote shell can make; the Host re-validates every read.
 */
const CONVENTIONAL_CONFIG_ROOT = '~/.piwin';

/**
 * Config-root-relative path for trusted text preview, or null when the path is
 * not under this Host's config root (see `configStoreRelativePath`).
 */
export function trustedConfigRelativeFromPath(
  filePath: string,
  configRoot?: string | null | undefined,
): string | null {
  return configStoreRelativePath(filePath, configRoot?.trim() || CONVENTIONAL_CONFIG_ROOT);
}

/**
 * Host-absolute path to try as a local file preview (ADR 0052 Slice 4).
 * Classification stays `legacy-absolute` / `project` — the Host sniffs bytes
 * and renders whatever the UI can show (image or text).
 */
export function localPreviewPathForPlan(plan: DocumentOpenPathPlan): string | null {
  if (plan.kind === 'legacy-absolute') {
    return plan.absolutePath;
  }
  if (plan.kind === 'project' && plan.relativePath) {
    const rootNorm = normalizeSeparators(plan.projectPath).replace(/\/+$/, '');
    const relativeNorm = normalizeSeparators(plan.relativePath).replace(/^\/+/, '');
    return `${rootNorm}/${relativeNorm}`;
  }
  return null;
}
