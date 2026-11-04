import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { WikiConceptDetail, WikiUpdateInput } from '@piwin/contracts';
import { hashWikiRaw, parseWikiPageKind, parseWikiSources } from './wiki-sources.js';
import {
  appendWikiLog,
  ensureWikiInitialized,
  extractWikilinks,
  formatFrontmatter,
  parseFrontmatter,
  slugify,
  updateWikiIndexRow,
} from './wiki-service.js';

export class WikiRevisionConflictError extends Error {
  readonly name = 'WikiRevisionConflictError';
  constructor(
    readonly slug: string,
    readonly actualContentHash: string,
  ) {
    super(`Wiki page ${slug} changed since the client last read it`);
  }
}

export class WikiPageNotFoundError extends Error {
  readonly name = 'WikiPageNotFoundError';
  constructor(readonly slug: string) {
    super(`Wiki page not found: ${slug}`);
  }
}

/**
 * CAS update of an existing concept file. The slug is the identity; renaming
 * the title does not move the file. Sources and kind are kept when omitted.
 */
export async function updateWikiConcept(
  piwinRoot: string | undefined,
  input: WikiUpdateInput,
): Promise<WikiConceptDetail> {
  const wikiDir = await ensureWikiInitialized(piwinRoot);
  const slug = slugify(input.slug);
  const conceptPath = join(wikiDir, 'concepts', `${slug}.md`);
  let raw: string;
  try {
    raw = await readFile(conceptPath, 'utf8');
  } catch {
    throw new WikiPageNotFoundError(slug);
  }
  const actualContentHash = hashWikiRaw(raw);
  if (input.expectedContentHash !== actualContentHash) {
    throw new WikiRevisionConflictError(slug, actualContentHash);
  }

  const { meta, body } = parseFrontmatter(raw);
  const title = input.title?.trim() || (typeof meta.title === 'string' ? meta.title : slug);
  const content = input.content !== undefined ? input.content.trim() : body;
  const tags = input.tags ?? (Array.isArray(meta.tags) ? (meta.tags as string[]) : []);
  const summary =
    input.summary !== undefined
      ? input.summary.trim()
      : typeof meta.summary === 'string'
        ? meta.summary
        : undefined;
  const sources = input.sources !== undefined ? input.sources : parseWikiSources(meta.sources);
  const kind = input.kind ?? parseWikiPageKind(meta.kind);
  const aliases = Array.isArray(meta.aliases) ? (meta.aliases as string[]) : [];

  const nextMeta: Record<string, unknown> = {
    title,
    updated: new Date().toISOString().slice(0, 10),
    tags,
  };
  if (summary) nextMeta.summary = summary;
  if (aliases.length > 0) nextMeta.aliases = aliases;
  if (sources.length > 0) nextMeta.sources = sources;
  if (kind) nextMeta.kind = kind;

  await writeFile(conceptPath, `${formatFrontmatter(nextMeta)}\n${content}\n`, 'utf8');
  await updateWikiIndexRow(wikiDir, { title, summary: summary ?? '', tags });
  await appendWikiLog(
    piwinRoot,
    'edit',
    input.logMessage ?? `Updated [[${title}]]`,
  );

  const written = await readFile(conceptPath, 'utf8');
  const fileStat = await stat(conceptPath);
  return {
    title,
    slug,
    content,
    ...(summary ? { summary } : {}),
    tags,
    ...(aliases.length > 0 ? { aliases } : {}),
    links: extractWikilinks(content),
    updatedAt: fileStat.mtime.toISOString(),
    relativePath: `concepts/${slug}.md`,
    contentHash: hashWikiRaw(written),
    ...(sources.length > 0 ? { sources } : {}),
    ...(kind ? { kind } : {}),
  };
}
