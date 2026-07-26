import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { NoteRecord, NoteUpdateInput, NoteWriteInput } from '@piwin/contracts';
import { decodeNoteMarkdown, encodeNoteMarkdown } from './markdown-codec.js';
import {
  DEFAULT_COLLECTION,
  assertInsideNotesRoot,
  getNotesRoot,
  noteFileName,
  sanitizePathSegment,
} from './paths.js';

export type NoteStoreOptions = {
  piwinRoot: string;
};

export type ScannedNote = {
  record: NoteRecord;
  /** File mtime in ms, for index reconcile. */
  mtimeMs: number;
};

export type NoteStore = {
  list: (filter?: { collection?: string; tags?: string[] }) => Promise<NoteRecord[]>;
  read: (noteId: string) => Promise<NoteRecord>;
  write: (input: NoteWriteInput) => Promise<NoteRecord>;
  update: (input: NoteUpdateInput) => Promise<NoteRecord>;
  delete: (noteId: string) => Promise<{ deleted: true; id: string }>;
  /** Full scan with mtimes; the index layer reconciles against this. */
  scan: () => Promise<ScannedNote[]>;
  getNotesRoot: () => string;
};

export function createNoteStore(options: NoteStoreOptions): NoteStore {
  const notesRoot = getNotesRoot(options.piwinRoot);

  async function ensureRoot(): Promise<void> {
    await mkdir(notesRoot, { recursive: true });
  }

  async function scan(): Promise<ScannedNote[]> {
    await ensureRoot();
    const files = await listMarkdownFiles(notesRoot);
    const notes: ScannedNote[] = [];
    for (const absolutePath of files) {
      const scanned = await loadNote(absolutePath);
      if (scanned) {
        notes.push(scanned);
      }
    }
    return notes;
  }

  async function loadNote(absolutePath: string): Promise<ScannedNote | null> {
    const relativePath = relative(notesRoot, absolutePath).split('\\').join('/');
    let raw: string;
    let mtimeMs: number;
    try {
      raw = await readFile(absolutePath, 'utf8');
      mtimeMs = (await stat(absolutePath)).mtimeMs;
    } catch {
      // File vanished between listing and read (external edit); skip.
      return null;
    }
    const contentHash = sha256(raw);
    const collection = relativePath.includes('/')
      ? (relativePath.split('/')[0] ?? DEFAULT_COLLECTION)
      : DEFAULT_COLLECTION;

    const decoded = decodeNoteMarkdown(raw);
    if (decoded) {
      const record: NoteRecord = {
        id: decoded.id,
        collection,
        title: decoded.title,
        content: decoded.content,
        createdAt: decoded.createdAt,
        updatedAt: decoded.updatedAt,
        relativePath,
        contentHash,
      };
      if (decoded.tags) record.tags = decoded.tags;
      return { record, mtimeMs };
    }

    // External file without frontmatter: synthesize metadata so it is still
    // searchable. Identity derives from path (stable across scans).
    const fileName = relativePath.split('/').at(-1) ?? relativePath;
    const title = fileName.replace(/\.md$/i, '');
    const stamp = new Date(mtimeMs).toISOString();
    return {
      record: {
        id: `ext-${sha256(relativePath).slice(0, 16)}`,
        collection,
        title,
        content: raw,
        createdAt: stamp,
        updatedAt: stamp,
        relativePath,
        contentHash,
      },
      mtimeMs,
    };
  }

  async function findById(noteId: string): Promise<ScannedNote | null> {
    const notes = await scan();
    return notes.find((entry) => entry.record.id === noteId) ?? null;
  }

  return {
    getNotesRoot: () => notesRoot,

    async list(filter) {
      const notes = await scan();
      return notes
        .map((entry) => entry.record)
        .filter((record) => {
          if (filter?.collection && record.collection !== filter.collection) return false;
          if (filter?.tags && filter.tags.length > 0) {
            const tags = record.tags ?? [];
            if (!filter.tags.every((tag) => tags.includes(tag))) return false;
          }
          return true;
        })
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    },

    async read(noteId) {
      const found = await findById(noteId);
      if (!found) {
        throw new Error(`note not found: ${noteId}`);
      }
      return found.record;
    },

    async write(input) {
      await ensureRoot();
      const collection = input.collection ?? DEFAULT_COLLECTION;
      sanitizePathSegment(collection, 'collection');
      const id = `note-${randomUUID().slice(0, 8)}-${Date.now().toString(36)}`;
      const now = new Date().toISOString();
      const relativePath = `${collection}/${noteFileName(id)}`;
      const absolutePath = assertInsideNotesRoot(notesRoot, join(notesRoot, relativePath));

      const record: NoteRecord = {
        id,
        collection,
        title: input.title,
        content: input.content,
        createdAt: now,
        updatedAt: now,
        relativePath,
        contentHash: '',
      };
      if (input.tags && input.tags.length > 0) record.tags = input.tags;

      const raw = encodeNoteMarkdown(record);
      record.contentHash = sha256(raw);
      await mkdir(join(notesRoot, collection), { recursive: true });
      await writeFile(absolutePath, raw, 'utf8');
      return record;
    },

    async update(input) {
      const found = await findById(input.id);
      if (!found) {
        throw new Error(`note not found: ${input.id}`);
      }
      const record = { ...found.record };
      if (input.title !== undefined) record.title = input.title;
      if (input.content !== undefined) record.content = input.content;
      if (input.tags !== undefined) {
        if (input.tags.length > 0) {
          record.tags = input.tags;
        } else {
          delete record.tags;
        }
      }
      record.updatedAt = new Date().toISOString();

      const absolutePath = assertInsideNotesRoot(notesRoot, join(notesRoot, record.relativePath));
      const raw = encodeNoteMarkdown(record);
      record.contentHash = sha256(raw);
      await writeFile(absolutePath, raw, 'utf8');
      return record;
    },

    async delete(noteId) {
      const found = await findById(noteId);
      if (!found) {
        throw new Error(`note not found: ${noteId}`);
      }
      const absolutePath = assertInsideNotesRoot(
        notesRoot,
        join(notesRoot, found.record.relativePath),
      );
      await rm(absolutePath);
      return { deleted: true, id: noteId };
    },

    scan,
  };
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

async function listMarkdownFiles(root: string): Promise<string[]> {
  const results: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const absolutePath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        results.push(absolutePath);
      }
    }
  }
  await walk(root);
  return results.sort();
}
