/**
 * Authoritative Skill preview reader (packages/skills owns scan + read).
 *
 * Host supplies scan context; this module:
 * - discovers skills via scanSkills (same precedence/catalog as list)
 * - picks the effective entry for a skillId (first enabled match in scan order,
 *   which already encodes source precedence from the scanner)
 * - optionally maps a legacy absolute path to a catalog entry
 * - realpath-verifies the skill file stays under an authorized skill root
 * - returns bounded UTF-8 content with current-resource provenance
 */
import { readFile, realpath, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import {
  normalizeResourceId,
  type SkillPreviewFailureReason,
  type SkillResourceOrigin,
  type SkillSource,
  type SkillSummary,
  type SkillsConfig,
  type SkillsReadData,
} from '@piwin/contracts';
import { scanSkills, type ScanSkillsOptions } from './skill-scanner.js';

const DEFAULT_MAX_BYTES = 256 * 1024;
const HARD_MAX_BYTES = 512 * 1024;

export type SkillPreviewReadInput = {
  piwinRoot: string;
  projectPath?: string;
  skillsConfig?: SkillsConfig;
  bundledRoot?: string;
  skillId?: string;
  legacyPath?: string;
  maxBytes?: number;
  /** Precomputed catalog (includes Pi-native skills). */
  discoveredSkills?: SkillSummary[];
  additionalAuthorizedRoots?: string[];
};

/**
 * Read the effective Skill body for preview.
 * Always returns typed SkillsReadData (ready | unavailable) — never throws for
 * expected not-found / policy failures.
 */
export async function readSkillPreview(input: SkillPreviewReadInput): Promise<SkillsReadData> {
  const skillIdRaw = input.skillId?.trim() ?? '';
  const legacyPath = input.legacyPath?.trim() ?? '';
  if (!skillIdRaw && !legacyPath) {
    return unavailable('invalid-request', {
      displayRef: '',
      suggestion: 'Provide skillId or legacyPath',
    });
  }

  const scanOptions: ScanSkillsOptions = {
    piwinRoot: input.piwinRoot,
  };
  if (input.skillsConfig) scanOptions.skillsConfig = input.skillsConfig;
  if (input.projectPath?.trim()) scanOptions.projectPath = input.projectPath.trim();
  if (input.bundledRoot) scanOptions.bundledRoot = input.bundledRoot;

  const discovered = input.discoveredSkills ?? (await scanSkills(scanOptions));
  const authorizedRoots = [
    ...(await collectAuthorizedSkillRoots(scanOptions)),
    ...(input.additionalAuthorizedRoots ?? []),
  ];

  let skillId = skillIdRaw ? safeNormalizeId(skillIdRaw) : null;
  if (!skillId && legacyPath) {
    skillId = extractSkillIdFromLegacyPath(legacyPath);
  }

  let entry: SkillSummary | null = null;
  if (skillId) {
    entry = pickEffectiveSkill(discovered, skillId);
  }
  if (!entry && legacyPath) {
    entry = matchSkillByLegacyPath(discovered, legacyPath);
  }
  if (!entry) {
    return unavailable('skill-unresolved', {
      ...(skillId ? { skillId } : {}),
      displayRef: skillId ? `skill:${skillId}` : legacyPath,
      suggestion: 'Open Skills panel or re-sync bundled skills',
    });
  }

  const filePath = await resolveSkillMarkdownPath(entry.path);
  if (!filePath) {
    return unavailable('not-found', {
      skillId: entry.id,
      displayRef: `skill:${entry.id}`,
    });
  }

  const containment = await assertPathUnderAuthorizedRoots(filePath, authorizedRoots);
  if (!containment.ok) {
    return unavailable(containment.reason, {
      skillId: entry.id,
      displayRef: `skill:${entry.id}`,
    });
  }

  const maxBytes = Math.min(
    HARD_MAX_BYTES,
    Math.max(1024, input.maxBytes ?? DEFAULT_MAX_BYTES),
  );

  let fileStats;
  try {
    fileStats = await stat(containment.realPath);
  } catch {
    return unavailable('not-found', {
      skillId: entry.id,
      displayRef: `skill:${entry.id}`,
    });
  }
  if (!fileStats.isFile()) {
    return unavailable('not-a-file', {
      skillId: entry.id,
      displayRef: `skill:${entry.id}`,
    });
  }

  let buffer: Buffer;
  try {
    buffer = await readFile(containment.realPath);
  } catch {
    return unavailable('not-found', {
      skillId: entry.id,
      displayRef: `skill:${entry.id}`,
    });
  }

  const byteSize = buffer.byteLength;
  const sample = buffer.subarray(0, Math.min(buffer.length, 8000));
  if (sample.includes(0)) {
    return unavailable('binary', {
      skillId: entry.id,
      displayRef: `skill:${entry.id}`,
    });
  }

  let truncated = false;
  let contentBuffer = buffer;
  if (contentBuffer.byteLength > maxBytes) {
    contentBuffer = contentBuffer.subarray(0, maxBytes);
    truncated = true;
  }

  return {
    status: 'ready',
    skillId: entry.id,
    name: entry.name,
    effectiveSource: entry.source,
    origin: originFromSource(entry.source),
    displayRef: `skill:${entry.id}`,
    content: contentBuffer.toString('utf8'),
    byteSize,
    truncated,
    provenance: 'current-resource',
  };
}

function unavailable(
  reason: SkillPreviewFailureReason,
  extra: { skillId?: string; displayRef: string; suggestion?: string },
): SkillsReadData {
  return {
    status: 'unavailable',
    reason,
    displayRef: extra.displayRef,
    ...(extra.skillId ? { skillId: extra.skillId } : {}),
    ...(extra.suggestion ? { suggestion: extra.suggestion } : {}),
  };
}

function safeNormalizeId(value: string): string | null {
  try {
    return normalizeResourceId(value);
  } catch {
    return null;
  }
}

/**
 * Prefer enabled entries; among them, first in scan order wins (scanner already
 * walks roots in product precedence). If all disabled, still return the first
 * match so preview can show content with source metadata.
 */
export function pickEffectiveSkill(
  skills: readonly SkillSummary[],
  skillId: string,
): SkillSummary | null {
  const id = safeNormalizeId(skillId);
  if (!id) return null;
  const matches = skills.filter((skill) => skill.id === id || safeNormalizeId(skill.name) === id);
  if (matches.length === 0) return null;
  const enabled = matches.find((skill) => skill.enabled);
  return enabled ?? matches[0] ?? null;
}

/**
 * Map a Host absolute path from old transcripts to a catalog skill without
 * treating that path as a free-form read root.
 */
export function matchSkillByLegacyPath(
  skills: readonly SkillSummary[],
  legacyPath: string,
): SkillSummary | null {
  const normalized = resolve(legacyPath.replace(/^file:\/\//, '').trim());
  for (const skill of skills) {
    const skillPath = resolve(skill.path);
    if (normalized === skillPath) return skill;
    if (normalized === join(skillPath, 'SKILL.md')) return skill;
    // Directory containment: .../skills/executing-plans/SKILL.md vs path dir
    if (normalized.startsWith(skillPath + '/') || normalized.startsWith(skillPath + '\\')) {
      return skill;
    }
  }
  const extracted = extractSkillIdFromLegacyPath(legacyPath);
  if (extracted) {
    return pickEffectiveSkill(skills, extracted);
  }
  return null;
}

/**
 * Extract skill id from common layouts:
 * - .../skills/<id>/SKILL.md
 * - .../skills/<id>.md
 * - .../skills/<id>/
 */
export function extractSkillIdFromLegacyPath(legacyPath: string): string | null {
  const normalized = legacyPath.replace(/\\/g, '/').replace(/^file:\/\//, '');
  const skillMd = normalized.match(/\/skills\/([^/]+)\/SKILL\.md$/i);
  if (skillMd?.[1]) return safeNormalizeId(skillMd[1]);
  const skillDir = normalized.match(/\/skills\/([^/]+)\/?$/i);
  if (skillDir?.[1] && !skillDir[1].includes('.')) return safeNormalizeId(skillDir[1]);
  const skillFile = normalized.match(/\/skills\/([^/]+)\.md$/i);
  if (skillFile?.[1]) return safeNormalizeId(skillFile[1]);
  // Bare SKILL.md with parent folder name
  if (/\/SKILL\.md$/i.test(normalized)) {
    const parent = basename(dirname(normalized));
    if (parent && parent !== 'skills') return safeNormalizeId(parent);
  }
  return null;
}

async function resolveSkillMarkdownPath(skillPath: string): Promise<string | null> {
  const absolute = resolve(skillPath);
  try {
    const info = await stat(absolute);
    if (info.isFile()) return absolute;
    if (info.isDirectory()) {
      const skillMd = join(absolute, 'SKILL.md');
      try {
        const mdInfo = await stat(skillMd);
        if (mdInfo.isFile()) return skillMd;
      } catch {
        return null;
      }
    }
  } catch {
    // path may be directory that only exists as SKILL.md sibling naming
    const asMd = absolute.endsWith('.md') ? absolute : join(absolute, 'SKILL.md');
    try {
      const mdInfo = await stat(asMd);
      if (mdInfo.isFile()) return asMd;
    } catch {
      return null;
    }
  }
  return null;
}

async function collectAuthorizedSkillRoots(options: ScanSkillsOptions): Promise<string[]> {
  const roots: string[] = [];
  const push = async (candidate: string) => {
    try {
      roots.push(await realpath(resolve(candidate)));
    } catch {
      // root may not exist yet
      roots.push(resolve(candidate));
    }
  };
  if (options.bundledRoot) await push(options.bundledRoot);
  await push(join(options.piwinRoot, 'skills'));
  if (options.projectPath) {
    await push(join(options.projectPath, '.pi', 'skills'));
    await push(join(options.projectPath, '.agents', 'skills'));
  }
  for (const extra of options.skillsConfig?.extraPaths ?? []) {
    const expanded = extra.startsWith('~/')
      ? join(process.env.HOME ?? '', extra.slice(2))
      : extra;
    await push(expanded);
  }
  return [...new Set(roots)];
}

async function assertPathUnderAuthorizedRoots(
  filePath: string,
  authorizedRoots: readonly string[],
): Promise<{ ok: true; realPath: string } | { ok: false; reason: SkillPreviewFailureReason }> {
  let realPath: string;
  try {
    realPath = await realpath(filePath);
  } catch {
    return { ok: false, reason: 'not-found' };
  }
  for (const root of authorizedRoots) {
    let rootReal = root;
    try {
      rootReal = await realpath(root);
    } catch {
      rootReal = resolve(root);
    }
    if (realPath === rootReal || realPath.startsWith(rootReal + '/') || realPath.startsWith(rootReal + '\\')) {
      return { ok: true, realPath };
    }
  }
  return { ok: false, reason: 'outside-catalog' };
}

function originFromSource(source: SkillSource): SkillResourceOrigin {
  switch (source) {
    case 'bundled':
      return 'bundled-installed';
    case 'user':
      return 'user-installed';
    case 'project':
      return 'project';
    case 'mapped':
      return 'mapped';
    case 'pi-native':
      return 'pi-native';
    default:
      return 'unknown';
  }
}
