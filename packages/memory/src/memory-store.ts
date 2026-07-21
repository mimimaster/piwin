import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import type {
  MemoryListFilter,
  MemoryQuotaSummary,
  MemoryRecord,
  MemorySearchHit,
  MemorySearchQuery,
  MemoryUpdateInput,
  MemoryWriteInput,
} from '@piwin/contracts';
import { applyConfidencePolicy } from './confidence.js';
import { DEFAULT_MAX_OVERVIEW_CHARS, MEMORY_ORDINARY_LIMIT } from './constants.js';
import { decodeMemoryMarkdown, encodeMemoryMarkdown } from './markdown-codec.js';
import { buildOverviewText } from './overview.js';
import {
  assertInsideMemoryRoot,
  getMemoryRoot,
  getOverviewCacheDir,
  memoryFileName,
  projectKeyFromPath,
  relativeDirForEntry,
  sanitizePathSegment,
} from './paths.js';
import { searchMemoryRecords } from './search.js';

export type MemoryStoreOptions = {
  piwinRoot: string;
  ordinaryLimit?: number;
  maxOverviewChars?: number;
};

export type MemoryStore = {
  list: (filter?: MemoryListFilter) => Promise<MemoryRecord[]>;
  read: (memoryId: string) => Promise<MemoryRecord>;
  search: (query: MemorySearchQuery) => Promise<MemorySearchHit[]>;
  write: (input: MemoryWriteInput) => Promise<MemoryRecord>;
  update: (input: MemoryUpdateInput) => Promise<MemoryRecord>;
  delete: (memoryId: string) => Promise<{ deleted: true; id: string }>;
  accept: (memoryId: string) => Promise<MemoryRecord>;
  quotaSummary: (input?: {
    scope?: MemoryListFilter['scope'];
    projectKey?: string;
  }) => Promise<MemoryQuotaSummary[]>;
  buildOverview: (input?: {
    projectKey?: string;
    maxChars?: number;
  }) => Promise<string>;
  /** Write overview cache file under .overview-cache/ (host may inject from this). */
  writeOverviewCache: (input?: {
    projectKey?: string;
    maxChars?: number;
  }) => Promise<{ text: string; cachePath: string }>;
  getMemoryRoot: () => string;
};

export function createMemoryStore(options: MemoryStoreOptions): MemoryStore {
  const memoryRoot = getMemoryRoot(options.piwinRoot);
  const ordinaryLimit = options.ordinaryLimit ?? MEMORY_ORDINARY_LIMIT;
  const defaultMaxOverviewChars = options.maxOverviewChars ?? DEFAULT_MAX_OVERVIEW_CHARS;

  async function ensureRoot(): Promise<void> {
    await mkdir(memoryRoot, { recursive: true });
    await mkdir(join(memoryRoot, 'global'), { recursive: true });
    await mkdir(join(memoryRoot, 'projects'), { recursive: true });
    await mkdir(join(memoryRoot, 'daily'), { recursive: true });
    await mkdir(getOverviewCacheDir(memoryRoot), { recursive: true });
  }

  async function scanAll(): Promise<MemoryRecord[]> {
    await ensureRoot();
    const files = await listMarkdownFiles(memoryRoot);
    const records: MemoryRecord[] = [];
    for (const absolutePath of files) {
      const relativePath = relative(memoryRoot, absolutePath).split('\\').join('/');
      if (relativePath.startsWith('.overview-cache/')) continue;
      try {
        const raw = await readFile(absolutePath, 'utf8');
        const decoded = decodeMemoryMarkdown(raw, relativePath);
        if (decoded) {
          records.push(decoded);
        }
      } catch {
        // skip corrupt files
      }
    }
    return records;
  }

  async function findById(memoryId: string): Promise<{
    record: MemoryRecord;
    absolutePath: string;
  }> {
    sanitizePathSegment(memoryId, 'memory id');
    const records = await scanAll();
    const match = records.find((item) => item.id === memoryId);
    if (!match || !match.relativePath) {
      throw new Error(`memory not found: ${memoryId}`);
    }
    const absolutePath = assertInsideMemoryRoot(
      memoryRoot,
      join(memoryRoot, match.relativePath),
    );
    return { record: match, absolutePath };
  }

  async function list(filter: MemoryListFilter = {}): Promise<MemoryRecord[]> {
    let records = await scanAll();
    if (filter.scope) {
      records = records.filter((item) => item.scope === filter.scope);
    }
    if (filter.projectKey) {
      records = records.filter((item) => item.projectKey === filter.projectKey);
    }
    if (filter.type) {
      records = records.filter((item) => item.type === filter.type);
    }
    records.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    const offset = filter.offset && filter.offset > 0 ? Math.floor(filter.offset) : 0;
    const limit = filter.limit && filter.limit > 0 ? Math.floor(filter.limit) : undefined;
    const sliced = records.slice(offset);
    return typeof limit === 'number' ? sliced.slice(0, limit) : sliced;
  }

  async function read(memoryId: string): Promise<MemoryRecord> {
    const found = await findById(memoryId);
    return found.record;
  }

  async function search(query: MemorySearchQuery): Promise<MemorySearchHit[]> {
    const records = await scanAll();
    return searchMemoryRecords(records, query);
  }

  async function write(input: MemoryWriteInput): Promise<MemoryRecord> {
    await ensureRoot();
    if (input.scope === 'project' && !input.projectKey) {
      throw new Error('projectKey required for project-scoped memory');
    }
    if (input.projectKey) {
      sanitizePathSegment(input.projectKey, 'projectKey');
    }

    if (input.type !== 'daily') {
      await assertQuotaAvailable(input.scope, input.projectKey);
    }

    const now = new Date().toISOString();
    const id = randomUUID();
    const confidence = applyConfidencePolicy({
      confidence: input.confidence ?? 'unknown',
      ...(input.quote !== undefined ? { quote: input.quote } : {}),
    });

    const record: MemoryRecord = {
      id,
      scope: input.scope,
      type: input.type,
      content: input.content,
      confidence,
      createdAt: now,
      updatedAt: now,
    };
    if (input.projectKey) record.projectKey = input.projectKey;
    if (input.title) record.title = input.title;
    if (input.quote) record.quote = input.quote;
    if (input.tags && input.tags.length > 0) record.tags = input.tags;

    const relativeDir = relativeDirForEntry({
      scope: input.scope,
      ...(input.projectKey ? { projectKey: input.projectKey } : {}),
      type: input.type,
    });
    const relativePath = join(relativeDir, memoryFileName(id)).split('\\').join('/');
    record.relativePath = relativePath;

    const absolutePath = assertInsideMemoryRoot(memoryRoot, join(memoryRoot, relativePath));
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, encodeMemoryMarkdown(record), 'utf8');
    return record;
  }

  async function update(input: MemoryUpdateInput): Promise<MemoryRecord> {
    const found = await findById(input.id);
    const existing = found.record;
    const next: MemoryRecord = {
      ...existing,
      updatedAt: new Date().toISOString(),
    };
    if (input.title !== undefined) {
      if (input.title) next.title = input.title;
      else delete next.title;
    }
    if (input.content !== undefined) next.content = input.content;
    if (input.quote !== undefined) {
      if (input.quote) next.quote = input.quote;
      else delete next.quote;
    }
    if (input.tags !== undefined) {
      if (input.tags.length > 0) next.tags = input.tags;
      else delete next.tags;
    }
    if (input.type !== undefined) next.type = input.type;
    const confidenceInput = input.confidence ?? existing.confidence;
    next.confidence = applyConfidencePolicy({
      confidence: confidenceInput,
      ...(next.quote !== undefined ? { quote: next.quote } : {}),
      ...(next.reviewedAt !== undefined ? { reviewedAt: next.reviewedAt } : {}),
    });

    await writeFile(found.absolutePath, encodeMemoryMarkdown(next), 'utf8');
    return next;
  }

  async function deleteMemory(memoryId: string): Promise<{ deleted: true; id: string }> {
    const found = await findById(memoryId);
    await rm(found.absolutePath, { force: true });
    return { deleted: true, id: memoryId };
  }

  async function accept(memoryId: string): Promise<MemoryRecord> {
    const found = await findById(memoryId);
    const reviewedAt = new Date().toISOString();
    const next: MemoryRecord = {
      ...found.record,
      reviewedAt,
      updatedAt: reviewedAt,
      // Explicit review promotes confidence to high (CE-MEM accept).
      confidence: 'high',
    };
    await writeFile(found.absolutePath, encodeMemoryMarkdown(next), 'utf8');
    return next;
  }

  async function assertQuotaAvailable(
    scope: MemoryWriteInput['scope'],
    projectKey?: string,
  ): Promise<void> {
    const records = await scanAll();
    const ordinary = records.filter((item) => {
      if (item.type === 'daily') return false;
      if (item.scope !== scope) return false;
      if (scope === 'project' && projectKey) {
        return item.projectKey === projectKey;
      }
      return scope === 'global';
    });
    if (ordinary.length >= ordinaryLimit) {
      throw new Error(
        `memory quota exceeded for ${scope}${projectKey ? `:${projectKey}` : ''}: ${ordinary.length}/${ordinaryLimit}`,
      );
    }
  }

  async function quotaSummary(input: {
    scope?: MemoryListFilter['scope'];
    projectKey?: string;
  } = {}): Promise<MemoryQuotaSummary[]> {
    const records = await scanAll();
    const summaries: MemoryQuotaSummary[] = [];

    const scopes: Array<{ scope: 'global' | 'project'; projectKey?: string }> = [];
    if (input.scope === 'global' || !input.scope) {
      scopes.push({ scope: 'global' });
    }
    if (input.scope === 'project' || !input.scope) {
      if (input.projectKey) {
        scopes.push({ scope: 'project', projectKey: input.projectKey });
      } else {
        const keys = new Set(
          records
            .filter((item) => item.scope === 'project' && item.projectKey)
            .map((item) => item.projectKey as string),
        );
        for (const key of keys) {
          scopes.push({ scope: 'project', projectKey: key });
        }
        if (keys.size === 0 && input.scope === 'project') {
          scopes.push({ scope: 'project' });
        }
      }
    }

    for (const entry of scopes) {
      const matching = records.filter((item) => {
        if (item.scope !== entry.scope) return false;
        if (entry.scope === 'project' && entry.projectKey) {
          return item.projectKey === entry.projectKey;
        }
        return entry.scope === 'global';
      });
      const ordinaryCount = matching.filter((item) => item.type !== 'daily').length;
      const dailyCount = matching.filter((item) => item.type === 'daily').length;
      const summary: MemoryQuotaSummary = {
        scope: entry.scope,
        ordinaryCount,
        ordinaryLimit,
        dailyCount,
      };
      if (entry.projectKey) summary.projectKey = entry.projectKey;
      summaries.push(summary);
    }
    return summaries;
  }

  async function buildOverview(input: {
    projectKey?: string;
    maxChars?: number;
  } = {}): Promise<string> {
    const records = await scanAll();
    const projectRecords = input.projectKey
      ? records.filter(
          (item) => item.scope === 'project' && item.projectKey === input.projectKey,
        )
      : [];
    const globalRecords = records.filter((item) => item.scope === 'global');
    return buildOverviewText({
      projectRecords,
      globalRecords,
      maxChars: input.maxChars ?? defaultMaxOverviewChars,
    });
  }

  async function writeOverviewCache(input: {
    projectKey?: string;
    maxChars?: number;
  } = {}): Promise<{ text: string; cachePath: string }> {
    const text = await buildOverview(input);
    const cacheDir = getOverviewCacheDir(memoryRoot);
    await mkdir(cacheDir, { recursive: true });
    const cacheName = input.projectKey
      ? `project-${sanitizePathSegment(input.projectKey, 'projectKey')}.md`
      : 'global.md';
    const cachePath = assertInsideMemoryRoot(memoryRoot, join(cacheDir, cacheName));
    const tempPath = `${cachePath}.${process.pid}.tmp`;
    await writeFile(tempPath, text, 'utf8');
    await rename(tempPath, cachePath);
    return { text, cachePath };
  }

  return {
    list,
    read,
    search,
    write,
    update,
    delete: deleteMemory,
    accept,
    quotaSummary,
    buildOverview,
    writeOverviewCache,
    getMemoryRoot: () => memoryRoot,
  };
}

export { projectKeyFromPath };

async function listMarkdownFiles(rootDir: string): Promise<string[]> {
  const results: string[] = [];
  async function walk(directory: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '.overview-cache') continue;
        await walk(absolute);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        results.push(resolve(absolute));
      }
    }
  }
  await walk(rootDir);
  return results;
}
