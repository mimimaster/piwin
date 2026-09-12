import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import {
  canToggleSkill,
  createDefaultSkillsConfig,
  normalizeResourceId,
  type SkillSource,
  type SkillSummary,
  type SkillsConfig,
} from '@piwin/contracts';
import { frontmatterHasBundledOrigin, hasBundledSkillMarker } from './bundled-skill-origin.js';

export type ScanSkillsOptions = {
  piwinRoot: string;
  projectPath?: string;
  skillsConfig?: SkillsConfig;
  bundledRoot?: string;
};

const SOURCE_RANK: Record<SkillSource, number> = {
  project: 0,
  user: 1,
  bundled: 2,
  mapped: 3,
  'pi-native': 4,
};

export async function scanSkills(options: ScanSkillsOptions): Promise<SkillSummary[]> {
  const config = options.skillsConfig ?? createDefaultSkillsConfig();
  const disabled = new Set(config.disabledIds);
  const bundledCatalog = options.bundledRoot
    ? await scanSkillRoot(options.bundledRoot, 'bundled')
    : [];
  const bundledIds = new Set(bundledCatalog.map((skill) => skill.id));
  const results: SkillSummary[] = [];
  const roots: Array<{ path: string; source: SkillSource }> = [];
  roots.push({ path: join(options.piwinRoot, 'skills'), source: 'user' });
  if (options.projectPath) {
    roots.push({ path: join(options.projectPath, '.pi', 'skills'), source: 'project' });
    roots.push({ path: join(options.projectPath, '.agents', 'skills'), source: 'project' });
  }
  for (const extra of config.extraPaths) {
    roots.push({ path: expandHome(extra), source: 'mapped' });
  }
  for (const rootEntry of roots) {
    for (const skill of await scanSkillRoot(rootEntry.path, rootEntry.source, bundledIds)) {
      if (rootEntry.source === 'user' && bundledIds.has(skill.id)) {
        // Leftover copy under ~/.piwin/skills — the product tree is authority.
        continue;
      }
      results.push({
        ...skill,
        enabled: !canToggleSkill(skill.source) || !disabled.has(skill.id),
      });
    }
  }
  for (const skill of bundledCatalog) {
    results.push({ ...skill, enabled: true });
  }
  return collapseSkillCatalog(results).sort((left, right) => left.name.localeCompare(right.name));
}

async function scanSkillRoot(
  rootPath: string,
  source: SkillSource,
  bundledIds: ReadonlySet<string> = new Set(),
): Promise<SkillSummary[]> {
  const absolute = resolve(expandHome(rootPath));
  let entries: string[] = [];
  try {
    entries = await readdir(absolute);
  } catch {
    return [];
  }
  const skills: SkillSummary[] = [];
  for (const entry of entries) {
    const dir = join(absolute, entry);
    let isDir = false;
    try {
      isDir = (await stat(dir)).isDirectory();
    } catch {
      continue;
    }
    if (!isDir) {
      if (entry.endsWith('.md') && source === 'user') {
        const parsed = await parseSkillMarkdown(join(absolute, entry), source, undefined, bundledIds);
        if (parsed) skills.push(parsed);
      }
      continue;
    }
    const parsed = await parseSkillMarkdown(join(dir, 'SKILL.md'), source, dir, bundledIds);
    if (parsed) skills.push(parsed);
  }
  return skills;
}

async function parseSkillMarkdown(
  filePath: string,
  source: SkillSource,
  directoryPath: string | undefined,
  bundledIds: ReadonlySet<string>,
): Promise<SkillSummary | null> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch {
    return null;
  }
  const fm = parseFrontmatter(raw);
  const name = (fm.name ?? basename(directoryPath ?? filePath).replace(/\.md$/i, '')).trim();
  if (!name) return null;
  const description = (fm.description ?? '').trim() || '(no description)';
  const id = normalizeResourceId(name);
  const hiddenRaw = (fm.hidden ?? '').trim().toLowerCase();
  const hidden = hiddenRaw === 'true' || hiddenRaw === '1';
  const resolvedSource = await resolveSkillSource(source, fm, directoryPath, bundledIds, id);
  return {
    id,
    name,
    description,
    source: resolvedSource,
    path: directoryPath ?? filePath,
    enabled: true,
    ...(hidden ? { hidden: true } : {}),
  };
}

async function resolveSkillSource(
  rootSource: SkillSource,
  frontmatter: Record<string, string>,
  directoryPath: string | undefined,
  bundledIds: ReadonlySet<string>,
  id: string,
): Promise<SkillSource> {
  if (rootSource !== 'user') return rootSource;
  if (frontmatterHasBundledOrigin(frontmatter)) return 'bundled';
  if (directoryPath && (await hasBundledSkillMarker(directoryPath))) return 'bundled';
  if (bundledIds.has(id)) return 'bundled';
  return 'user';
}

/**
 * One row per skill id. Project wins, then a true user install, then the
 * product tree. Leftover copies under ~/.piwin/skills are dropped before this.
 */
function collapseSkillCatalog(skills: SkillSummary[]): SkillSummary[] {
  const byId = new Map<string, SkillSummary>();
  for (const skill of skills) {
    const current = byId.get(skill.id);
    if (!current || SOURCE_RANK[skill.source] < SOURCE_RANK[current.source]) {
      byId.set(skill.id, skill);
    }
  }
  return [...byId.values()];
}

function parseFrontmatter(markdown: string): Record<string, string> {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const result: Record<string, string> = {};
  for (const line of (match[1] ?? '').split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line
      .slice(idx + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
    if (key) result[key] = value;
  }
  return result;
}

function expandHome(pathValue: string): string {
  if (pathValue.startsWith('~/')) return join(homedir(), pathValue.slice(2));
  return pathValue;
}
