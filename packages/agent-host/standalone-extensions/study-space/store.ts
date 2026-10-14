import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, rename, rmdir, unlink, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { id, validate, LegacyDocumentError, type Document, type Topic, type Preferences } from './model.js';

function missing(error: unknown): boolean { return (error as NodeJS.ErrnoException).code === 'ENOENT'; }
export function checkAbort(signal?: AbortSignal): void { signal?.throwIfAborted(); }

/** Own documents only. The chosen PIWIN_ROOT is trusted; nothing below study-space may be a symlink. */
export class Store {
  private readonly chosen: string;
  constructor(root = process.env.PIWIN_ROOT?.trim() || join(homedir(), '.piwin')) { this.chosen = resolve(root); }
  private async root(): Promise<string> {
    await mkdir(this.chosen, { recursive: true });
    const parent = await realpath(this.chosen);
    const root = join(parent, 'study-space');
    try { await mkdir(root, { mode: 0o700 }); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
    const stat = await lstat(root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe study-space root');
    return root;
  }
  private filename(key: string): string { return `${key === 'preferences' ? key : id(key)}.json`; }
  private async readAt(root: string, key: string): Promise<Document | null> {
    const file = join(root, this.filename(key));
    let handle;
    try { handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW); }
    catch (e) { if (missing(e)) return null; throw e; }
    try {
      if (!(await handle.stat()).isFile()) throw new Error('Unsafe document');
      return validate(JSON.parse(await handle.readFile('utf8')), key);
    } finally { await handle.close(); }
  }
  async read(key: string): Promise<Document | null> { this.filename(key); return this.readAt(await this.root(), key); }
  async topic(key: string): Promise<Topic> {
    id(key); const topic = await this.read(key);
    if (!topic) throw new Error('Unknown topic');
    return topic as Topic;
  }
  async preferences(): Promise<Preferences> {
    try { return (await this.read('preferences') as Preferences | null) ?? { schemaVersion: 2, revision: 0, cards: 'ask' }; }
    catch (e) { if (e instanceof LegacyDocumentError) return { schemaVersion: 2, revision: 0, cards: 'ask' }; throw e; }
  }
  /** Most recently touched first. 0.1 course files stay on disk but are not topics. */
  async list(): Promise<Topic[]> {
    const root = await this.root();
    const names = await readdir(root);
    const result: Topic[] = [];
    for (const name of names) {
      if ((await lstat(join(root, name))).isSymbolicLink()) throw new Error('Unsafe entry in data root');
      if (name === 'preferences.json' || name === '.write-lock' || /^\.tmp-[0-9a-f-]+$/.test(name)) continue;
      if (!name.endsWith('.json')) throw new Error('Unexpected entry in data root');
      const key = name.slice(0, -5); id(key);
      try {
        const topic = await this.readAt(root, key);
        if (topic) result.push(topic as Topic);
      } catch (e) { if (!(e instanceof LegacyDocumentError)) throw e; }
    }
    return result.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }
  /** Read-modify-write for a single local user; a concurrent writer still fails on the lock/CAS rather than losing data. */
  async mutate<T extends Document>(key: string, change: (current: T | null) => T | Promise<T>, signal?: AbortSignal): Promise<T> {
    let current: Document | null;
    try { current = await this.read(key); }
    catch (e) { if (!(e instanceof LegacyDocumentError) || key !== 'preferences') throw e; current = null; }
    return this.update<T>(key, current?.revision ?? -1, change, signal);
  }
  /** Exclusive cross-process lock + revision CAS; no waiting or stale-lock takeover. */
  async update<T extends Document>(key: string, expected: number, change: (current: T | null) => T | Promise<T>, signal?: AbortSignal): Promise<T> {
    this.filename(key); checkAbort(signal);
    if (!Number.isSafeInteger(expected) || expected < -1) throw new Error('Invalid expected revision');
    const root = await this.root();
    const lock = join(root, '.write-lock');
    try { await mkdir(lock, { mode: 0o700 }); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Study Space locked; no automatic takeover'); throw e; }
    let temp: string | undefined;
    try {
      checkAbort(signal);
      let current: T | null;
      try { current = await this.readAt(root, key) as T | null; }
      // A 0.1 preference file carries one enum; replacing it loses nothing, unlike a 0.1 course.
      catch (e) { if (!(e instanceof LegacyDocumentError) || key !== 'preferences') throw e; current = null; }
      if ((current?.revision ?? -1) !== expected) throw new Error('Revision conflict; refetch before retry');
      const next = await change(current === null ? null : structuredClone(current));
      next.revision = expected + 1;
      validate(next, key); checkAbort(signal);
      temp = join(root, `.tmp-${randomUUID()}`);
      const handle = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { await handle.writeFile(JSON.stringify(next, null, 2) + '\n'); await handle.sync(); }
      finally { await handle.close(); }
      checkAbort(signal);
      // Revalidate descendant root and destination just before committing, including symlink destinations.
      if (await this.root() !== root) throw new Error('Root changed');
      try { if ((await lstat(join(root, this.filename(key)))).isSymbolicLink()) throw new Error('Unsafe destination'); }
      catch (e) { if (!missing(e)) throw e; }
      await rename(temp, join(root, this.filename(key))); temp = undefined;
      const directory = await open(root, constants.O_RDONLY);
      try { await directory.sync(); } finally { await directory.close(); }
      return next;
    } finally {
      try { if (temp) await unlink(temp); } finally { await rmdir(lock); }
    }
  }
}
