/**
 * Read-only inventory of Pi-native packages and loose agentDir resources.
 * Does not write ~/.pi, does not import extension modules, does not copy into
 * ~/.piwin. Host catalog unions this with piwin scanners.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path';
import {
  isExtensionBlueprintEligible,
  normalizeResourceId,
  type ExtensionSummary,
  type PromptTemplateSummary,
  type SkillSummary,
} from '@piwin/contracts';
import {
  readExtensionCompatibility,
  readExtensionHookEvents,
} from './detect-extension-hooks.js';

export type PiNativeInventoryDiagnostic = {
  code: 'invalid-settings' | 'unresolved' | 'empty-package';
  message: string;
  spec?: string;
};

export type PiNativeInventory = {
  extensions: ExtensionSummary[];
  skills: SkillSummary[];
  prompts: PromptTemplateSummary[];
  diagnostics: PiNativeInventoryDiagnostic[];
};

export type LoadPiNativeInventoryOptions = {
  agentDir?: string;
  projectPath?: string;
  /** When false, skip user-global ~/.pi/agent; project `.pi/` may still load. */
  includeUserGlobal?: boolean;
};

type InventorySource = 'pi-native' | 'project';

type PackageKindFilter = {
  extensions?: string[];
  skills?: string[];
  prompts?: string[];
};

type ParsedPackageSpec = {
  raw: string;
  kind: 'npm' | 'git' | 'local';
  /** Relative to the settings directory for local specs; unused for npm/git. */
  locator: string;
  filter: PackageKindFilter;
};

const SKIP_DIR_NAMES = new Set(['node_modules', '.git', 'dist', 'coverage']);

export async function loadPiNativeInventory(
  options: LoadPiNativeInventoryOptions,
): Promise<PiNativeInventory> {
  const extensions: ExtensionSummary[] = [];
  const skills: SkillSummary[] = [];
  const prompts: PromptTemplateSummary[] = [];
  const diagnostics: PiNativeInventoryDiagnostic[] = [];

  if (options.includeUserGlobal !== false && options.agentDir) {
    await collectLooseAgentDir(options.agentDir, 'pi-native', extensions, skills, prompts);
    await collectSettingsLayer({
      settingsPath: join(options.agentDir, 'settings.json'),
      settingsDir: options.agentDir,
      storeRoot: options.agentDir,
      source: 'pi-native',
      extensions,
      skills,
      prompts,
      diagnostics,
    });
  }

  const projectPath = options.projectPath?.trim();
  if (projectPath) {
    const projectPiDir = join(projectPath, '.pi');
    await collectSettingsLayer({
      settingsPath: join(projectPiDir, 'settings.json'),
      settingsDir: projectPiDir,
      storeRoot: projectPiDir,
      source: 'project',
      extensions,
      skills,
      prompts,
      diagnostics,
    });
  }

  return { extensions, skills, prompts, diagnostics };
}

async function collectLooseAgentDir(
  agentDir: string,
  source: InventorySource,
  extensions: ExtensionSummary[],
  skills: SkillSummary[],
  prompts: PromptTemplateSummary[],
): Promise<void> {
  extensions.push(...(await scanExtensionTree(join(agentDir, 'extensions'), source)));
  skills.push(...(await scanSkillTree(join(agentDir, 'skills'), source)));
  prompts.push(...(await scanPromptTree(join(agentDir, 'prompts'), source)));
}

async function collectSettingsLayer(input: {
  settingsPath: string;
  settingsDir: string;
  storeRoot: string;
  source: InventorySource;
  extensions: ExtensionSummary[];
  skills: SkillSummary[];
  prompts: PromptTemplateSummary[];
  diagnostics: PiNativeInventoryDiagnostic[];
}): Promise<void> {
  const parsed = await readSettingsDocument(input.settingsPath, input.diagnostics);
  if (!parsed) return;

  for (const spec of parsed.packages) {
    const root = resolvePackageRoot(spec, input.settingsDir, input.storeRoot);
    if (!root || !(await pathExists(root))) {
      input.diagnostics.push({
        code: 'unresolved',
        spec: spec.raw,
        message: `Pi package is listed but its files were not found: ${spec.raw}`,
      });
      continue;
    }
    const listed = await listPackageResources(root, input.source, spec);
    if (
      listed.extensions.length === 0 &&
      listed.skills.length === 0 &&
      listed.prompts.length === 0
    ) {
      input.diagnostics.push({
        code: 'empty-package',
        spec: spec.raw,
        message: `Pi package declared no loadable extensions, skills, or prompts: ${spec.raw}`,
      });
      continue;
    }
    input.extensions.push(...listed.extensions);
    input.skills.push(...listed.skills);
    input.prompts.push(...listed.prompts);
  }

  for (const resourcePath of parsed.extensionPaths) {
    const absolute = resolveSettingsPath(resourcePath, input.settingsDir);
    input.extensions.push(...(await scanExtensionEntry(absolute, input.source)));
  }
  for (const resourcePath of parsed.skillPaths) {
    const absolute = resolveSettingsPath(resourcePath, input.settingsDir);
    input.skills.push(...(await scanSkillTree(absolute, input.source)));
  }
  for (const resourcePath of parsed.promptPaths) {
    const absolute = resolveSettingsPath(resourcePath, input.settingsDir);
    input.prompts.push(...(await scanPromptTree(absolute, input.source)));
  }
}

async function readSettingsDocument(
  settingsPath: string,
  diagnostics: PiNativeInventoryDiagnostic[],
): Promise<{
  packages: ParsedPackageSpec[];
  extensionPaths: string[];
  skillPaths: string[];
  promptPaths: string[];
} | null> {
  let raw: string;
  try {
    raw = await readFile(settingsPath, 'utf8');
  } catch {
    return null;
  }
  let document: unknown;
  try {
    document = JSON.parse(raw) as unknown;
  } catch {
    diagnostics.push({
      code: 'invalid-settings',
      message: `Pi settings are not valid JSON: ${settingsPath}`,
    });
    return null;
  }
  if (!isRecord(document)) {
    diagnostics.push({
      code: 'invalid-settings',
      message: `Pi settings root must be an object: ${settingsPath}`,
    });
    return null;
  }
  return {
    packages: parsePackagesField(document.packages),
    extensionPaths: asStringArray(document.extensions),
    skillPaths: asStringArray(document.skills),
    promptPaths: asStringArray(document.prompts),
  };
}

export function parsePackagesField(value: unknown): ParsedPackageSpec[] {
  if (!Array.isArray(value)) return [];
  const parsed: ParsedPackageSpec[] = [];
  for (const item of value) {
    const spec = parsePackageSpec(item);
    if (spec) parsed.push(spec);
  }
  return parsed;
}

function parsePackageSpec(value: unknown): ParsedPackageSpec | null {
  if (typeof value === 'string') {
    return parsePackageSource(value, {});
  }
  if (!isRecord(value) || typeof value.source !== 'string') {
    return null;
  }
  const filter: PackageKindFilter = {};
  if (Array.isArray(value.extensions)) {
    filter.extensions = value.extensions.filter((entry): entry is string => typeof entry === 'string');
  }
  if (Array.isArray(value.skills)) {
    filter.skills = value.skills.filter((entry): entry is string => typeof entry === 'string');
  }
  if (Array.isArray(value.prompts)) {
    filter.prompts = value.prompts.filter((entry): entry is string => typeof entry === 'string');
  }
  return parsePackageSource(value.source, filter);
}

function parsePackageSource(raw: string, filter: PackageKindFilter): ParsedPackageSpec | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('npm:')) {
    const name = npmPackageName(trimmed.slice(4));
    if (!name) return null;
    return { raw: trimmed, kind: 'npm', locator: name, filter };
  }
  if (
    trimmed.startsWith('git:') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('ssh://') ||
    trimmed.startsWith('git://') ||
    trimmed.startsWith('git@')
  ) {
    const locator = gitCloneRelativePath(trimmed);
    if (!locator) return null;
    return { raw: trimmed, kind: 'git', locator, filter };
  }
  if (trimmed.startsWith('.') || trimmed.startsWith('/') || trimmed.startsWith('~')) {
    return { raw: trimmed, kind: 'local', locator: trimmed, filter };
  }
  const name = npmPackageName(trimmed);
  if (!name) return null;
  return { raw: trimmed, kind: 'npm', locator: name, filter };
}

export function npmPackageName(spec: string): string | undefined {
  const value = spec.trim();
  if (!value) return undefined;
  if (value.startsWith('@')) {
    const slash = value.indexOf('/');
    if (slash <= 1 || slash === value.length - 1) return undefined;
    const scope = value.slice(0, slash);
    const rest = value.slice(slash + 1);
    const name = rest.includes('@') ? rest.slice(0, rest.lastIndexOf('@')) : rest;
    if (!name) return undefined;
    return `${scope}/${name}`;
  }
  return value.includes('@') ? value.slice(0, value.lastIndexOf('@')) : value;
}

export function gitCloneRelativePath(spec: string): string | undefined {
  let value = spec.trim();
  if (value.startsWith('git:') && !value.startsWith('git://')) {
    value = value.slice(4);
  }
  if (value.startsWith('git@')) {
    const hostPath = value.slice(4);
    const colon = hostPath.indexOf(':');
    if (colon === -1) return undefined;
    return joinPosix(hostPath.slice(0, colon), stripGitSuffix(hostPath.slice(colon + 1)));
  }
  try {
    if (value.startsWith('https://') || value.startsWith('http://') || value.startsWith('ssh://') || value.startsWith('git://')) {
      const url = new URL(value);
      const host = url.hostname;
      const repoPath = stripGitSuffix(url.pathname.replace(/^\/+/, ''));
      if (!host || !repoPath) return undefined;
      return joinPosix(host, repoPath);
    }
  } catch {
    return undefined;
  }
  const at = value.lastIndexOf('@');
  if (at > 0 && !value.slice(at + 1).includes('/')) {
    value = value.slice(0, at);
  }
  const parts = value.replace(/^\/+/, '').split('/').filter(Boolean);
  if (parts.length < 2) return undefined;
  const host = parts[0];
  const repoPath = stripGitSuffix(parts.slice(1).join('/'));
  if (!host || !repoPath) return undefined;
  return joinPosix(host, repoPath);
}

function resolvePackageRoot(
  spec: ParsedPackageSpec,
  settingsDir: string,
  storeRoot: string,
): string | undefined {
  if (spec.kind === 'npm') {
    return join(storeRoot, 'npm', 'node_modules', spec.locator);
  }
  if (spec.kind === 'git') {
    return join(storeRoot, 'git', ...spec.locator.split('/'));
  }
  return resolveSettingsPath(spec.locator, settingsDir);
}

function resolveSettingsPath(pathValue: string, settingsDir: string): string {
  if (pathValue.startsWith('~/')) {
    return join(process.env.HOME ?? '', pathValue.slice(2));
  }
  if (isAbsolute(pathValue)) return pathValue;
  return resolve(settingsDir, pathValue);
}

async function listPackageResources(
  packageRoot: string,
  source: InventorySource,
  spec: ParsedPackageSpec,
): Promise<{
  extensions: ExtensionSummary[];
  skills: SkillSummary[];
  prompts: PromptTemplateSummary[];
}> {
  let rootStat;
  try {
    rootStat = await stat(packageRoot);
  } catch {
    return { extensions: [], skills: [], prompts: [] };
  }
  if (rootStat.isFile()) {
    return {
      extensions: await scanExtensionEntry(packageRoot, source),
      skills: [],
      prompts: [],
    };
  }

  const manifest = await readPiManifest(packageRoot);
  const extensionGlobs = manifest.extensions.length > 0 ? manifest.extensions : ['extensions'];
  const skillGlobs = manifest.skills.length > 0 ? manifest.skills : ['skills'];
  const promptGlobs = manifest.prompts.length > 0 ? manifest.prompts : ['prompts'];

  const extensions = await collectExtensions(packageRoot, extensionGlobs, spec.filter.extensions, source);
  const skills = await collectSkills(packageRoot, skillGlobs, spec.filter.skills, source);
  const prompts = await collectPrompts(packageRoot, promptGlobs, spec.filter.prompts, source);
  return { extensions, skills, prompts };
}

async function readPiManifest(packageRoot: string): Promise<{
  extensions: string[];
  skills: string[];
  prompts: string[];
}> {
  try {
    const raw = await readFile(join(packageRoot, 'package.json'), 'utf8');
    const document = JSON.parse(raw) as unknown;
    if (!isRecord(document) || !isRecord(document.pi)) {
      return { extensions: [], skills: [], prompts: [] };
    }
    return {
      extensions: asStringArray(document.pi.extensions),
      skills: asStringArray(document.pi.skills),
      prompts: asStringArray(document.pi.prompts),
    };
  } catch {
    return { extensions: [], skills: [], prompts: [] };
  }
}

async function collectExtensions(
  packageRoot: string,
  globs: string[],
  filter: string[] | undefined,
  source: InventorySource,
): Promise<ExtensionSummary[]> {
  const selected = await expandGlobs(packageRoot, applyFilter(globs, filter));
  const results: ExtensionSummary[] = [];
  for (const absolute of selected) {
    results.push(...(await scanExtensionEntry(absolute, source)));
  }
  return results;
}

async function collectSkills(
  packageRoot: string,
  globs: string[],
  filter: string[] | undefined,
  source: InventorySource,
): Promise<SkillSummary[]> {
  const selected = await expandGlobs(packageRoot, applyFilter(globs, filter));
  const results: SkillSummary[] = [];
  for (const absolute of selected) {
    results.push(...(await scanSkillTree(absolute, source)));
  }
  return results;
}

async function collectPrompts(
  packageRoot: string,
  globs: string[],
  filter: string[] | undefined,
  source: InventorySource,
): Promise<PromptTemplateSummary[]> {
  const selected = await expandGlobs(packageRoot, applyFilter(globs, filter));
  const results: PromptTemplateSummary[] = [];
  for (const absolute of selected) {
    results.push(...(await scanPromptTree(absolute, source)));
  }
  return results;
}

function applyFilter(declared: string[], filter: string[] | undefined): string[] {
  if (filter === undefined) return declared;
  if (filter.length === 0) return [];
  const forced: string[] = [];
  const includes: string[] = [];
  const excludes: string[] = [];
  for (const entry of filter) {
    if (entry.startsWith('+')) {
      forced.push(entry.slice(1));
    } else if (entry.startsWith('-') || entry.startsWith('!')) {
      excludes.push(entry.slice(1));
    } else {
      includes.push(entry);
    }
  }
  const narrowed = includes.length > 0 ? includes : declared;
  return [...narrowed.filter((item) => !excludes.some((rule) => globMatch(item, rule))), ...forced];
}

async function expandGlobs(packageRoot: string, patterns: string[]): Promise<string[]> {
  const files = await listPackageFiles(packageRoot);
  const matches = new Set<string>();
  for (const pattern of patterns) {
    const normalized = pattern.replace(/^\.\//, '').replace(/\\/g, '/');
    if (!hasGlobMeta(normalized)) {
      matches.add(resolve(packageRoot, normalized));
      continue;
    }
    for (const relativePath of files) {
      if (globMatch(relativePath, normalized) || globMatch(relativePath, `${normalized}/**`)) {
        matches.add(resolve(packageRoot, relativePath));
      }
    }
  }
  return [...matches];
}

async function listPackageFiles(packageRoot: string): Promise<string[]> {
  const files: string[] = [];
  await walkFiles(packageRoot, packageRoot, files, 0);
  return files;
}

async function walkFiles(
  root: string,
  current: string,
  files: string[],
  depth: number,
): Promise<void> {
  if (depth > 8) return;
  let entries;
  try {
    entries = await readdir(current, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIR_NAMES.has(entry.name) || entry.name.startsWith('.')) continue;
    const absolute = join(current, entry.name);
    const relativePath = posix.normalize(relative(root, absolute).split(sep).join('/'));
    if (entry.isDirectory()) {
      files.push(relativePath);
      await walkFiles(root, absolute, files, depth + 1);
      continue;
    }
    if (entry.isFile()) {
      files.push(relativePath);
    }
  }
}

async function scanExtensionTree(rootPath: string, source: InventorySource): Promise<ExtensionSummary[]> {
  return scanExtensionEntry(rootPath, source);
}

async function scanExtensionEntry(
  entryPath: string,
  source: InventorySource,
): Promise<ExtensionSummary[]> {
  let entryStat;
  try {
    entryStat = await stat(entryPath);
  } catch {
    return [];
  }
  if (entryStat.isFile()) {
    if (!isExtensionFile(entryPath)) return [];
    const summary = await buildExtension(entryPath, basename(entryPath).replace(/\.(ts|js)$/i, ''), source);
    return summary ? [summary] : [];
  }
  if (!entryStat.isDirectory()) return [];
  const indexTs = join(entryPath, 'index.ts');
  const indexJs = join(entryPath, 'index.js');
  if (await isFile(indexTs)) {
    const summary = await buildExtension(indexTs, basename(entryPath), source, entryPath);
    return summary ? [summary] : [];
  }
  if (await isFile(indexJs)) {
    const summary = await buildExtension(indexJs, basename(entryPath), source, entryPath);
    return summary ? [summary] : [];
  }
  let names: string[] = [];
  try {
    names = await readdir(entryPath);
  } catch {
    return [];
  }
  const results: ExtensionSummary[] = [];
  for (const name of names) {
    if (!isExtensionFile(name)) continue;
    const filePath = join(entryPath, name);
    if (!(await isFile(filePath))) continue;
    const summary = await buildExtension(filePath, name.replace(/\.(ts|js)$/i, ''), source);
    if (summary) results.push(summary);
  }
  return results;
}

async function buildExtension(
  entryPath: string,
  nameHint: string,
  source: InventorySource,
  directoryPath?: string,
): Promise<ExtensionSummary | null> {
  const name = nameHint.trim();
  if (!name) return null;
  const pathForLoader = directoryPath ?? entryPath;
  const contentRevision = await hashPath(pathForLoader);
  const hookEvents = await readExtensionHookEvents(entryPath);
  const compatibility = await readExtensionCompatibility(entryPath);
  return {
    id: normalizeResourceId(name),
    name,
    description: await readExtensionDescription(entryPath),
    source,
    path: pathForLoader,
    enabled: isExtensionBlueprintEligible(compatibility),
    configuredEnabled: true,
    contentRevision,
    ...(hookEvents ? { hookEvents: [...hookEvents] } : {}),
    compatibility,
  };
}

async function scanSkillTree(rootPath: string, source: InventorySource): Promise<SkillSummary[]> {
  let entryStat;
  try {
    entryStat = await stat(rootPath);
  } catch {
    return [];
  }
  if (entryStat.isFile() && rootPath.toLowerCase().endsWith('.md')) {
    const parsed = await parseSkill(rootPath, source);
    return parsed ? [parsed] : [];
  }
  if (!entryStat.isDirectory()) return [];
  const direct = join(rootPath, 'SKILL.md');
  if (await isFile(direct)) {
    const parsed = await parseSkill(direct, source, rootPath);
    return parsed ? [parsed] : [];
  }
  let names: string[] = [];
  try {
    names = await readdir(rootPath);
  } catch {
    return [];
  }
  const results: SkillSummary[] = [];
  for (const name of names) {
    const child = join(rootPath, name);
    let childStat;
    try {
      childStat = await stat(child);
    } catch {
      continue;
    }
    if (childStat.isFile() && name.toLowerCase().endsWith('.md')) {
      const parsed = await parseSkill(child, source);
      if (parsed) results.push(parsed);
      continue;
    }
    if (!childStat.isDirectory()) continue;
    const skillMd = join(child, 'SKILL.md');
    if (!(await isFile(skillMd))) continue;
    const parsed = await parseSkill(skillMd, source, child);
    if (parsed) results.push(parsed);
  }
  return results;
}

async function parseSkill(
  filePath: string,
  source: InventorySource,
  directoryPath?: string,
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
  return {
    id: normalizeResourceId(name),
    name,
    description: (fm.description ?? '').trim() || '(no description)',
    source,
    path: directoryPath ?? filePath,
    enabled: true,
  };
}

async function scanPromptTree(rootPath: string, source: InventorySource): Promise<PromptTemplateSummary[]> {
  let entryStat;
  try {
    entryStat = await stat(rootPath);
  } catch {
    return [];
  }
  if (entryStat.isFile() && rootPath.toLowerCase().endsWith('.md')) {
    const parsed = await buildPrompt(rootPath, source);
    return parsed ? [parsed] : [];
  }
  if (!entryStat.isDirectory()) return [];
  let names: string[] = [];
  try {
    names = await readdir(rootPath);
  } catch {
    return [];
  }
  const results: PromptTemplateSummary[] = [];
  for (const name of names) {
    if (!name.toLowerCase().endsWith('.md')) continue;
    const filePath = join(rootPath, name);
    if (!(await isFile(filePath))) continue;
    const parsed = await buildPrompt(filePath, source);
    if (parsed) results.push(parsed);
  }
  return results;
}

async function buildPrompt(
  filePath: string,
  source: InventorySource,
): Promise<PromptTemplateSummary | null> {
  const name = basename(filePath).replace(/\.md$/i, '').trim();
  if (!name) return null;
  return {
    id: normalizeResourceId(name),
    name,
    description: await readPromptDescription(filePath),
    source,
    path: filePath,
    enabled: true,
  };
}

async function readExtensionDescription(entryPath: string): Promise<string> {
  try {
    const raw = await readFile(entryPath, 'utf8');
    const start = raw.indexOf('/**');
    const end = start === -1 ? -1 : raw.indexOf('*/', start + 3);
    if (start !== -1 && end !== -1) {
      const lines = raw
        .slice(start + 3, end)
        .split('\n')
        .map((line) => {
          const trimmed = line.trim();
          return trimmed.startsWith('*') ? trimmed.slice(1).trim() : trimmed;
        })
        .filter((line) => line.length > 0 && !line.startsWith('@'));
      if (lines[0]) return lines[0];
    }
  } catch {
    // ignore
  }
  return '(extension)';
}

async function readPromptDescription(filePath: string): Promise<string> {
  try {
    const raw = await readFile(filePath, 'utf8');
    const fm = parseFrontmatter(raw);
    if (fm.description?.trim()) return fm.description.trim();
  } catch {
    // ignore
  }
  return '(prompt)';
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

async function hashPath(targetPath: string): Promise<string> {
  const hash = createHash('sha256');
  let targetStat;
  try {
    targetStat = await stat(targetPath);
  } catch {
    return createHash('sha256').update(targetPath).digest('hex').slice(0, 12);
  }
  if (targetStat.isFile()) {
    hash.update(await readFile(targetPath));
    return hash.digest('hex').slice(0, 12);
  }
  const files = await listPackageFiles(targetPath);
  files.sort();
  for (const relativePath of files) {
    const absolute = resolve(targetPath, relativePath);
    if (!(await isFile(absolute))) continue;
    hash.update(relativePath);
    hash.update(await readFile(absolute));
  }
  return hash.digest('hex').slice(0, 12);
}

function isExtensionFile(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower.endsWith('.d.ts')) return false;
  if (/\.test\.(ts|js)$/.test(lower) || /\.spec\.(ts|js)$/.test(lower)) return false;
  return lower.endsWith('.ts') || lower.endsWith('.js');
}

async function isFile(pathValue: string): Promise<boolean> {
  try {
    return (await stat(pathValue)).isFile();
  } catch {
    return false;
  }
}

async function pathExists(pathValue: string): Promise<boolean> {
  try {
    await stat(pathValue);
    return true;
  } catch {
    return false;
  }
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasGlobMeta(pattern: string): boolean {
  return /[*?]/.test(pattern);
}

function globMatch(relativePath: string, pattern: string): boolean {
  const normalizedPattern = pattern.replace(/^\.\//, '').replace(/\\/g, '/');
  const regex = globToRegExp(normalizedPattern);
  return regex.test(relativePath.replace(/\\/g, '/'));
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '::DOUBLESTAR::')
    .replace(/\*/g, '[^/]*')
    .replace(/::DOUBLESTAR::/g, '.*');
  return new RegExp(`^${escaped}$`);
}

function stripGitSuffix(value: string): string {
  return value.replace(/\.git$/i, '').replace(/\/+$/, '');
}

function joinPosix(...parts: string[]): string {
  return parts.filter(Boolean).join('/');
}

export function skillLoaderPath(skillPath: string): string {
  const normalized = skillPath.replace(/\\/g, '/');
  if (normalized.toLowerCase().endsWith('.md')) {
    return dirname(skillPath);
  }
  return skillPath;
}
