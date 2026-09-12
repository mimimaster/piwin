/**
 * Andrej Karpathy LLM-Wiki design pattern extension for Piwin.
 * @piwin-bundled-extension
 *
 * Loaded by Pi jiti as a product extension under ~/.piwin/extensions.
 * Manages ~/.piwin/wiki with concepts/, INDEX.md, LOG.md, and raw/.
 */

import { mkdir, readdir, readFile, stat, writeFile, appendFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type JsonSchema = {
  type: 'object' | 'array' | 'string' | 'boolean' | 'number';
  description?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  additionalProperties?: boolean;
  minItems?: number;
  minLength?: number;
};

export type RegisteredTool = {
  name: string;
  label: string;
  description: string;
  parameters: JsonSchema;
  execute: (
    toolCallId: string,
    params: unknown,
    signal?: AbortSignal,
    onUpdate?: unknown,
    context?: unknown,
  ) => Promise<{
    content: Array<{ type: 'text'; text: string }>;
    details?: Record<string, unknown>;
  }>;
};

export type ExtensionApi = {
  registerTool?: (tool: RegisteredTool) => void;
  registerCommand?: (command: {
    name: string;
    description: string;
    callback: (args: string, ctx: unknown) => Promise<void> | void;
  }) => void;
  on?: (event: string, handler: (...args: unknown[]) => unknown) => void;
};

export function resolveWikiDir(customRoot?: string): string {
  if (customRoot) return customRoot;
  const fromEnv = process.env.PIWIN_ROOT?.trim();
  if (fromEnv) return join(fromEnv, 'wiki');
  return join(homedir(), '.piwin', 'wiki');
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
      // support [[target|alias]]
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

export function formatFrontmatter(meta: Record<string, unknown>): string {
  const lines = ['---'];
  for (const [key, value] of Object.entries(meta)) {
    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.map((v) => JSON.stringify(v)).join(', ')}]`);
    } else if (value !== undefined && value !== null) {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    }
  }
  lines.push('---\n');
  return lines.join('\n');
}

export async function ensureWikiInitialized(wikiDir: string): Promise<void> {
  await mkdir(join(wikiDir, 'concepts'), { recursive: true });
  await mkdir(join(wikiDir, 'raw'), { recursive: true });

  const indexPath = join(wikiDir, 'INDEX.md');
  try {
    await stat(indexPath);
  } catch {
    const initialIndex = `# Knowledge Wiki\n\nCentral concept index organized by domain. Updated automatically by LLM-Wiki.\n\n## Concepts\n\n| Concept | Summary | Tags |\n| --- | --- | --- |\n`;
    await writeFile(indexPath, initialIndex, 'utf-8');
  }

  const logPath = join(wikiDir, 'LOG.md');
  try {
    await stat(logPath);
  } catch {
    const initialLog = `# Wiki Ingest & Maintenance Log\n\nAppend-only chronological record of wiki modifications.\n\n`;
    await writeFile(logPath, initialLog, 'utf-8');
  }
}

export async function readWikiIndex(wikiDir: string): Promise<string> {
  await ensureWikiInitialized(wikiDir);
  return readFile(join(wikiDir, 'INDEX.md'), 'utf-8');
}

export async function readConceptFile(
  wikiDir: string,
  conceptName: string,
): Promise<{ title: string; slug: string; content: string; meta: Record<string, unknown>; links: string[] } | null> {
  const slug = slugify(conceptName);
  const filePath = join(wikiDir, 'concepts', `${slug}.md`);
  try {
    const raw = await readFile(filePath, 'utf-8');
    const { meta, body } = parseFrontmatter(raw);
    const title = typeof meta.title === 'string' ? meta.title : conceptName;
    return {
      title,
      slug,
      content: body,
      meta,
      links: extractWikilinks(body),
    };
  } catch {
    return null;
  }
}

export async function writeConceptFile(
  wikiDir: string,
  options: {
    title: string;
    content: string;
    summary?: string;
    tags?: string[];
    aliases?: string[];
    logMessage?: string;
  },
): Promise<{ slug: string; path: string; links: string[] }> {
  await ensureWikiInitialized(wikiDir);
  const slug = slugify(options.title);
  const filePath = join(wikiDir, 'concepts', `${slug}.md`);

  const meta: Record<string, unknown> = {
    title: options.title,
    updated: new Date().toISOString().split('T')[0],
    tags: options.tags ?? [],
  };
  if (options.aliases && options.aliases.length > 0) {
    meta.aliases = options.aliases;
  }
  if (options.summary) {
    meta.summary = options.summary;
  }

  const fileContent = `${formatFrontmatter(meta)}\n${options.content.trim()}\n`;
  await writeFile(filePath, fileContent, 'utf-8');

  // Update INDEX.md
  await updateIndexTable(wikiDir, {
    title: options.title,
    summary: options.summary ?? '',
    tags: options.tags ?? [],
  });

  // Append to LOG.md
  const dateStr = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const logMsg = options.logMessage || `Updated concept [[${options.title}]]`;
  await appendFile(
    join(wikiDir, 'LOG.md'),
    `- **${dateStr}**: ${logMsg}\n`,
    'utf-8',
  );

  return {
    slug,
    path: filePath,
    links: extractWikilinks(options.content),
  };
}

async function updateIndexTable(
  wikiDir: string,
  entry: { title: string; summary: string; tags: string[] },
): Promise<void> {
  const indexPath = join(wikiDir, 'INDEX.md');
  const content = await readFile(indexPath, 'utf-8');
  const rowPattern = new RegExp(`\\|\\s*\\[\\[${escapeRegex(entry.title)}\\]\\]\\s*\\|.*`, 'i');
  const tagsStr = entry.tags.map((t) => `#${t}`).join(' ');
  const newRow = `| [[${entry.title}]] | ${entry.summary.replace(/\|/g, '/')} | ${tagsStr} |`;

  if (rowPattern.test(content)) {
    const updated = content.replace(rowPattern, newRow);
    await writeFile(indexPath, updated, 'utf-8');
  } else {
    // Append to concepts section
    const lines = content.split('\n');
    let tableIndex = lines.findIndex((l) => l.trim().startsWith('| Concept |'));
    if (tableIndex !== -1) {
      // Find end of table
      let insertIdx = tableIndex + 2;
      while (insertIdx < lines.length && lines[insertIdx]?.trim().startsWith('|')) {
        insertIdx++;
      }
      lines.splice(insertIdx, 0, newRow);
      await writeFile(indexPath, lines.join('\n'), 'utf-8');
    } else {
      await appendFile(indexPath, `\n${newRow}\n`, 'utf-8');
    }
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export type WikiLintResult = {
  totalConcepts: number;
  brokenLinks: Array<{ fromConcept: string; target: string }>;
  orphanConcepts: string[];
  healthy: boolean;
};

export async function runWikiLint(wikiDir: string): Promise<WikiLintResult> {
  await ensureWikiInitialized(wikiDir);
  const conceptsDir = join(wikiDir, 'concepts');
  const files = (await readdir(conceptsDir)).filter((f) => f.endsWith('.md'));

  const conceptSlugs = new Set<string>();
  const conceptTitles = new Map<string, string>();
  const parsedMap = new Map<string, { title: string; links: string[] }>();

  for (const file of files) {
    const raw = await readFile(join(conceptsDir, file), 'utf-8');
    const slug = file.replace(/\.md$/, '');
    const { meta, body } = parseFrontmatter(raw);
    const title = typeof meta.title === 'string' ? meta.title : slug;
    conceptSlugs.add(slug);
    conceptSlugs.add(slugify(title));
    conceptTitles.set(slug, title);
    parsedMap.set(slug, { title, links: extractWikilinks(body) });
  }

  const incomingLinksCount = new Map<string, number>();
  for (const slug of conceptSlugs) {
    incomingLinksCount.set(slug, 0);
  }

  const brokenLinks: Array<{ fromConcept: string; target: string }> = [];

  for (const [slug, data] of parsedMap.entries()) {
    for (const target of data.links) {
      const targetSlug = slugify(target);
      if (conceptSlugs.has(targetSlug)) {
        incomingLinksCount.set(targetSlug, (incomingLinksCount.get(targetSlug) ?? 0) + 1);
      } else {
        brokenLinks.push({ fromConcept: data.title, target });
      }
    }
  }

  // Also check INDEX.md links
  const indexContent = await readFile(join(wikiDir, 'INDEX.md'), 'utf-8');
  const indexLinks = extractWikilinks(indexContent);
  for (const target of indexLinks) {
    const targetSlug = slugify(target);
    if (conceptSlugs.has(targetSlug)) {
      incomingLinksCount.set(targetSlug, (incomingLinksCount.get(targetSlug) ?? 0) + 1);
    }
  }

  const orphanConcepts: string[] = [];
  for (const [slug, data] of parsedMap.entries()) {
    const targetSlug = slugify(data.title);
    const count = (incomingLinksCount.get(slug) ?? 0) + (incomingLinksCount.get(targetSlug) ?? 0);
    if (count === 0) {
      orphanConcepts.push(data.title);
    }
  }

  return {
    totalConcepts: files.length,
    brokenLinks,
    orphanConcepts,
    healthy: brokenLinks.length === 0 && orphanConcepts.length === 0,
  };
}

export default function llmWikiExtension(pi: ExtensionApi): void {
  if (typeof pi.registerTool !== 'function') return;

  // Tool 1: wiki_read
  pi.registerTool({
    name: 'wiki_read',
    label: 'Wiki Read',
    description: 'Read a concept page, INDEX.md, or LOG.md from the LLM-Wiki knowledge base.',
    parameters: {
      type: 'object',
      required: ['name'],
      properties: {
        name: {
          type: 'string',
          description: 'Concept title/slug, "INDEX", or "LOG".',
          minLength: 1,
        },
      },
    },
    execute: async (_id, params) => {
      const input = (params && typeof params === 'object' ? params : {}) as { name?: string };
      const name = input.name?.trim() || 'INDEX';
      const wikiDir = resolveWikiDir();

      if (name.toUpperCase() === 'INDEX') {
        const text = await readWikiIndex(wikiDir);
        return { content: [{ type: 'text', text }] };
      }
      if (name.toUpperCase() === 'LOG') {
        await ensureWikiInitialized(wikiDir);
        const text = await readFile(join(wikiDir, 'LOG.md'), 'utf-8');
        return { content: [{ type: 'text', text }] };
      }

      const concept = await readConceptFile(wikiDir, name);
      if (!concept) {
        return {
          content: [{ type: 'text', text: `Concept not found: "${name}". Check INDEX.md for available concepts.` }],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: `# ${concept.title}\n\n${concept.content}\n\n---\n**Outlinks**: ${concept.links.map((l) => `[[${l}]]`).join(', ') || 'none'}`,
          },
        ],
        details: concept,
      };
    },
  });

  // Tool 2: wiki_write
  pi.registerTool({
    name: 'wiki_write',
    label: 'Wiki Write',
    description: 'Create or update a concept page in the LLM-Wiki, automatically updating INDEX.md and LOG.md.',
    parameters: {
      type: 'object',
      required: ['title', 'content'],
      properties: {
        title: {
          type: 'string',
          description: 'Concept title (e.g. "Transformer Architecture").',
          minLength: 1,
        },
        content: {
          type: 'string',
          description: 'Markdown content with cross-references formatted as [[Concept Name]].',
          minLength: 1,
        },
        summary: {
          type: 'string',
          description: 'One-line summary for the INDEX.md catalog.',
        },
        tags: {
          type: 'array',
          description: 'List of domain tags (e.g. ["deep-learning", "nlp"]).',
          items: { type: 'string' },
        },
        aliases: {
          type: 'array',
          description: 'Alternative names/acronyms for this concept.',
          items: { type: 'string' },
        },
        logMessage: {
          type: 'string',
          description: 'Audit log description for LOG.md explaining what was updated.',
        },
      },
    },
    execute: async (_id, params) => {
      const input = (params && typeof params === 'object' ? params : {}) as {
        title?: string;
        content?: string;
        summary?: string;
        tags?: string[];
        aliases?: string[];
        logMessage?: string;
      };
      if (!input.title || !input.content) {
        return { content: [{ type: 'text', text: 'Error: title and content are required' }] };
      }

      const wikiDir = resolveWikiDir();
      const result = await writeConceptFile(wikiDir, {
        title: input.title,
        content: input.content,
        summary: input.summary,
        tags: input.tags,
        aliases: input.aliases,
        logMessage: input.logMessage,
      });

      return {
        content: [
          {
            type: 'text',
            text: `✅ Saved concept [[${input.title}]] to ${result.path}\n- Discovered wikilinks: ${result.links.map((l) => `[[${l}]]`).join(', ') || 'none'}\n- INDEX.md and LOG.md updated.`,
          },
        ],
        details: result,
      };
    },
  });

  // Tool 3: wiki_lint
  pi.registerTool({
    name: 'wiki_lint',
    label: 'Wiki Lint',
    description: 'Inspect the LLM-Wiki for broken links, orphan concepts, and structural inconsistencies.',
    parameters: {
      type: 'object',
      properties: {},
    },
    execute: async () => {
      const wikiDir = resolveWikiDir();
      const report = await runWikiLint(wikiDir);

      const lines = [
        `📊 **Wiki Health Report**: ${report.healthy ? '✅ Healthy' : '⚠️ Issues Found'}`,
        `- Total concepts: ${report.totalConcepts}`,
      ];

      if (report.brokenLinks.length > 0) {
        lines.push(`\n**Broken Links (${report.brokenLinks.length})**:`);
        for (const b of report.brokenLinks) {
          lines.push(`  - From [[${b.fromConcept}]] -> missing target [[${b.target}]]`);
        }
      } else {
        lines.push('- No broken links detected.');
      }

      if (report.orphanConcepts.length > 0) {
        lines.push(`\n**Orphan Concepts (${report.orphanConcepts.length})**: (no incoming links and missing from INDEX.md)`);
        for (const o of report.orphanConcepts) {
          lines.push(`  - [[${o}]]`);
        }
      } else {
        lines.push('- No orphan concepts detected.');
      }

      return {
        content: [{ type: 'text', text: lines.join('\n') }],
        details: report,
      };
    },
  });

  // Command: /wiki
  if (typeof pi.registerCommand === 'function') {
    pi.registerCommand({
      name: 'wiki',
      description: 'Interact with the Andrej Karpathy LLM-Wiki (/wiki lint, /wiki index, /wiki log)',
      callback: async (args: string) => {
        const sub = args.trim().toLowerCase();
        const wikiDir = resolveWikiDir();
        if (sub === 'lint') {
          const report = await runWikiLint(wikiDir);
          console.log(`[Wiki Lint] Healthy: ${report.healthy}, Total: ${report.totalConcepts}, Broken: ${report.brokenLinks.length}`);
        } else if (sub === 'log') {
          const text = await readFile(join(wikiDir, 'LOG.md'), 'utf-8');
          console.log(text.slice(-500));
        } else {
          console.log(`Knowledge Wiki root: ${wikiDir}`);
        }
      },
    });
  }
}
