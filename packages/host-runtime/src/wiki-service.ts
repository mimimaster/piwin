import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { WikiConceptItem, WikiConceptDetail, WikiOverviewResult } from '@piwin/contracts';
import { getPiwinRoot, getPiwinWikiDir } from './paths.js';

export type { WikiConceptItem, WikiConceptDetail, WikiOverviewResult };

export const WIKI_KNOWLEDGE_BASE_NAME = 'Wiki';

const DEFAULT_INDEX_CONTENT = `# Knowledge Index

> Curated LLM-Wiki concepts, entities, and synthesis. Maintained by Pi Agent.

## Concepts
_No concepts compiled yet. Use \`/wiki digest <file>\` to compile knowledge._

## Entities
_No entities registered yet._

## Synthesis
_No synthesis reports yet._
`;

const DEFAULT_LOG_CONTENT = `# Wiki Log

All changes made to the Wiki are recorded below in chronological order.

## [${new Date().toISOString().slice(0, 10)}] init | Knowledge Wiki initialized
`;

export async function ensureWikiInitialized(piwinRoot?: string): Promise<string> {
  const root = getPiwinRoot(piwinRoot);
  const wikiDir = getPiwinWikiDir(root);
  await mkdir(join(wikiDir, 'concepts'), { recursive: true });
  await mkdir(join(wikiDir, 'entities'), { recursive: true });
  await mkdir(join(wikiDir, 'synthesis'), { recursive: true });
  await mkdir(join(wikiDir, 'raw'), { recursive: true });

  const indexPath = join(wikiDir, 'INDEX.md');
  try {
    await stat(indexPath);
  } catch {
    await writeFile(indexPath, DEFAULT_INDEX_CONTENT, 'utf8');
  }

  const logPath = join(wikiDir, 'LOG.md');
  try {
    await stat(logPath);
  } catch {
    await writeFile(logPath, DEFAULT_LOG_CONTENT, 'utf8');
  }

  return wikiDir;
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '') || 'untitled';
}

const WIKILINK_REGEX = /\[\[([^[\]]+)\]\]/g;

export function extractWikilinks(text: string): string[] {
  const links = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = WIKILINK_REGEX.exec(text)) !== null) {
    const raw = match[1]?.trim();
    if (raw) {
      const target = raw.split('|')[0]?.trim();
      if (target) links.add(target);
    }
  }
  return [...links];
}

export function parseFrontmatter(raw: string): { meta: Record<string, unknown>; body: string } {
  if (!raw.startsWith('---')) {
    return { meta: {}, body: raw };
  }
  const endIdx = raw.indexOf('\n---', 3);
  if (endIdx === -1) {
    return { meta: {}, body: raw };
  }
  const yamlBlock = raw.slice(3, endIdx).trim();
  const body = raw.slice(endIdx + 4).replace(/^\r?\n/, '');
  const meta: Record<string, unknown> = {};

  for (const line of yamlBlock.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const val = line.slice(colonIdx + 1).trim();
    if (val.startsWith('[') && val.endsWith(']')) {
      meta[key] = val
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
    } else {
      meta[key] = val.replace(/^['"]|['"]$/g, '');
    }
  }
  return { meta, body };
}

export async function listWikiConcepts(piwinRoot?: string): Promise<WikiConceptItem[]> {
  const wikiDir = await ensureWikiInitialized(piwinRoot);
  const conceptsDir = join(wikiDir, 'concepts');
  let entries: string[] = [];
  try {
    entries = await readdir(conceptsDir);
  } catch {
    return [];
  }

  const items: WikiConceptItem[] = [];
  for (const file of entries) {
    if (!file.endsWith('.md')) continue;
    const fullPath = join(conceptsDir, file);
    try {
      const raw = await readFile(fullPath, 'utf8');
      const s = await stat(fullPath);
      const { meta } = parseFrontmatter(raw);
      const slug = file.replace(/\.md$/, '');
      const title = typeof meta.title === 'string' ? meta.title : slug;
      const summary = typeof meta.summary === 'string' ? meta.summary : undefined;
      const tags = Array.isArray(meta.tags) ? (meta.tags as string[]) : [];

      items.push({
        title,
        slug,
        ...(summary ? { summary } : {}),
        tags,
        relativePath: `concepts/${file}`,
        updatedAt: s.mtime.toISOString(),
      });
    } catch {
      // skip
    }
  }

  return items.sort((a, b) => a.title.localeCompare(b.title));
}

export async function readWikiConcept(
  piwinRoot: string | undefined,
  nameOrSlug: string,
): Promise<WikiConceptDetail | null> {
  const wikiDir = await ensureWikiInitialized(piwinRoot);
  const slug = slugify(nameOrSlug);
  const fullPath = join(wikiDir, 'concepts', `${slug}.md`);
  try {
    const raw = await readFile(fullPath, 'utf8');
    const s = await stat(fullPath);
    const { meta, body } = parseFrontmatter(raw);
    const title = typeof meta.title === 'string' ? meta.title : nameOrSlug;
    const summary = typeof meta.summary === 'string' ? meta.summary : undefined;
    const tags = Array.isArray(meta.tags) ? (meta.tags as string[]) : [];
    const aliases = Array.isArray(meta.aliases) ? (meta.aliases as string[]) : [];
    const links = extractWikilinks(body);

    return {
      title,
      slug,
      content: body,
      ...(summary ? { summary } : {}),
      tags,
      ...(aliases.length > 0 ? { aliases } : {}),
      links,
      updatedAt: s.mtime.toISOString(),
      relativePath: `concepts/${slug}.md`,
    };
  } catch {
    return null;
  }
}

export async function readWikiIndex(piwinRoot?: string): Promise<string> {
  const wikiDir = await ensureWikiInitialized(piwinRoot);
  const indexPath = join(wikiDir, 'INDEX.md');
  try {
    return await readFile(indexPath, 'utf8');
  } catch {
    return DEFAULT_INDEX_CONTENT;
  }
}

export async function readWikiLog(piwinRoot?: string): Promise<string> {
  const wikiDir = await ensureWikiInitialized(piwinRoot);
  const logPath = join(wikiDir, 'LOG.md');
  try {
    return await readFile(logPath, 'utf8');
  } catch {
    return DEFAULT_LOG_CONTENT;
  }
}

export async function getWikiOverview(piwinRoot?: string): Promise<WikiOverviewResult> {
  const [indexContent, logContent, concepts] = await Promise.all([
    readWikiIndex(piwinRoot),
    readWikiLog(piwinRoot),
    listWikiConcepts(piwinRoot),
  ]);
  return {
    indexContent,
    logSnippet: logContent.slice(-1000),
    concepts,
    totalConcepts: concepts.length,
  };
}

function formatFrontmatter(meta: Record<string, unknown>): string {
  const lines = ['---'];
  for (const [key, value] of Object.entries(meta)) {
    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.map((item) => JSON.stringify(item)).join(', ')}]`);
    } else if (value !== undefined && value !== null) {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    }
  }
  lines.push('---\n');
  return lines.join('\n');
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Upserts the concept's row in INDEX.md so the catalog stays in step. */
async function updateWikiIndexRow(
  wikiDir: string,
  entry: { title: string; summary: string; tags: string[] },
): Promise<void> {
  const indexPath = join(wikiDir, 'INDEX.md');
  let content: string;
  try {
    content = await readFile(indexPath, 'utf8');
  } catch {
    content = DEFAULT_INDEX_CONTENT;
  }
  const row = `| [[${entry.title}]] | ${entry.summary.replace(/\|/g, '/')} | ${entry.tags
    .map((tag) => `#${tag}`)
    .join(' ')} |`;
  const existing = new RegExp(`\\|\\s*\\[\\[${escapeRegex(entry.title)}\\]\\]\\s*\\|.*`, 'i');
  if (existing.test(content)) {
    await writeFile(indexPath, content.replace(existing, row), 'utf8');
    return;
  }
  const lines = content.split('\n');
  const header = lines.findIndex((line) => line.trim().startsWith('| Concept |'));
  if (header === -1) {
    await writeFile(
      indexPath,
      `${content.trimEnd()}\n\n| Concept | Summary | Tags |\n| --- | --- | --- |\n${row}\n`,
      'utf8',
    );
    return;
  }
  let insertAt = header + 2;
  while (insertAt < lines.length && lines[insertAt]?.trim().startsWith('|')) insertAt += 1;
  lines.splice(insertAt, 0, row);
  await writeFile(indexPath, lines.join('\n'), 'utf8');
}

/**
 * Writes one concept page and keeps INDEX.md / LOG.md in step — the same
 * contract the `wiki_write` agent tool honours, so both writers agree.
 */
export async function writeWikiConcept(
  piwinRoot: string | undefined,
  input: {
    title: string;
    content: string;
    summary?: string;
    tags?: string[];
    logMessage?: string;
  },
): Promise<WikiConceptDetail> {
  const wikiDir = await ensureWikiInitialized(piwinRoot);
  const slug = slugify(input.title);
  const tags = input.tags ?? [];
  const meta: Record<string, unknown> = {
    title: input.title,
    updated: new Date().toISOString().slice(0, 10),
    tags,
  };
  if (input.summary) meta.summary = input.summary;

  const body = input.content.trim();
  await writeFile(
    join(wikiDir, 'concepts', `${slug}.md`),
    `${formatFrontmatter(meta)}\n${body}\n`,
    'utf8',
  );
  await updateWikiIndexRow(wikiDir, { title: input.title, summary: input.summary ?? '', tags });
  await appendWikiLog(
    piwinRoot,
    'distill',
    input.logMessage ?? `Distilled concept [[${input.title}]]`,
  );

  return {
    title: input.title,
    slug,
    content: body,
    ...(input.summary ? { summary: input.summary } : {}),
    tags,
    links: extractWikilinks(body),
    updatedAt: new Date().toISOString(),
    relativePath: `concepts/${slug}.md`,
  };
}

export async function appendWikiLog(
  piwinRoot: string | undefined,
  action: string,
  detail: string,
): Promise<void> {
  const wikiDir = await ensureWikiInitialized(piwinRoot);
  const logPath = join(wikiDir, 'LOG.md');
  const dateStr = new Date().toISOString().slice(0, 10);
  const entry = `\n## [${dateStr}] ${action} | ${detail}\n`;
  try {
    const existing = await readFile(logPath, 'utf8');
    await writeFile(logPath, existing + entry, 'utf8');
  } catch {
    await writeFile(logPath, `# Wiki Log\n${entry}`, 'utf8');
  }
}
