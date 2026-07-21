import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import type { SkillSource, SkillSummary, SkillsConfig } from '@piwin/contracts';
import { createDefaultSkillsConfig } from '@piwin/contracts';

export type ScanSkillsOptions = {
  piwinRoot: string;
  projectPath?: string;
  skillsConfig?: SkillsConfig;
  bundledRoot?: string;
};

export async function scanSkills(options: ScanSkillsOptions): Promise<SkillSummary[]> {
  const config = options.skillsConfig ?? createDefaultSkillsConfig();
  const disabled = new Set(config.disabledIds);
  const results: SkillSummary[] = [];
  const roots: Array<{ path: string; source: SkillSource }> = [];
  if (options.bundledRoot) roots.push({ path: options.bundledRoot, source: 'bundled' });
  roots.push({ path: join(options.piwinRoot, 'skills'), source: 'user' });
  if (options.projectPath) {
    roots.push({ path: join(options.projectPath, '.pi', 'skills'), source: 'project' });
    roots.push({ path: join(options.projectPath, '.agents', 'skills'), source: 'project' });
  }
  for (const extra of config.extraPaths) {
    roots.push({ path: expandHome(extra), source: 'mapped' });
  }
  for (const rootEntry of roots) {
    for (const skill of await scanSkillRoot(rootEntry.path, rootEntry.source)) {
      if (results.some((item) => item.id === skill.id)) continue;
      results.push({ ...skill, enabled: !disabled.has(skill.id) });
    }
  }
  return results.sort((a, b) => a.name.localeCompare(b.name));
}

async function scanSkillRoot(rootPath: string, source: SkillSource): Promise<SkillSummary[]> {
  const absolute = resolve(expandHome(rootPath));
  let entries: string[] = [];
  try { entries = await readdir(absolute); } catch { return []; }
  const skills: SkillSummary[] = [];
  for (const entry of entries) {
    const dir = join(absolute, entry);
    let isDir = false;
    try { isDir = (await stat(dir)).isDirectory(); } catch { continue; }
    if (!isDir) {
      if (entry.endsWith('.md') && source === 'user') {
        const parsed = await parseSkillMarkdown(join(absolute, entry), source);
        if (parsed) skills.push(parsed);
      }
      continue;
    }
    const parsed = await parseSkillMarkdown(join(dir, 'SKILL.md'), source, dir);
    if (parsed) skills.push(parsed);
  }
  return skills;
}

async function parseSkillMarkdown(filePath: string, source: SkillSource, directoryPath?: string): Promise<SkillSummary | null> {
  let raw: string;
  try { raw = await readFile(filePath, 'utf8'); } catch { return null; }
  const fm = parseFrontmatter(raw);
  const name = (fm.name ?? basename(directoryPath ?? filePath).replace(/\.md$/i, '')).trim();
  if (!name) return null;
  const description = (fm.description ?? '').trim() || '(no description)';
  const id = name.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  return { id, name, description, source, path: directoryPath ?? filePath, enabled: true };
}

function parseFrontmatter(markdown: string): Record<string, string> {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const result: Record<string, string> = {};
  for (const line of (match[1] ?? '').split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
    if (key) result[key] = value;
  }
  return result;
}

function expandHome(pathValue: string): string {
  if (pathValue.startsWith('~/')) return join(homedir(), pathValue.slice(2));
  return pathValue;
}
