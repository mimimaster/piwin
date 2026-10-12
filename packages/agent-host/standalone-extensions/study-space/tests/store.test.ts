import { fork, type ChildProcess } from 'node:child_process';
import { mkdtemp, mkdir, rm, symlink, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Store } from '../store.js';
import { newCourse, type Course } from '../model.js';
import { EVIDENCE } from './harness.js';

let root: string; let store: Store; let course: Course;
const children: ChildProcess[] = [];
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'study-space-store-')); store = new Store(root); course = newCourse('resources');
  await store.update<Course>(course.courseId, -1, () => course);
});
afterEach(async () => { for (const child of children.splice(0)) { if (child.connected) child.disconnect(); if (child.exitCode === null) child.kill(); } await rm(root, { recursive: true, force: true }); });
const data = () => join(root, 'study-space');
const documentPath = () => join(data(), `${course.courseId}.json`);
async function patch(change: (value: any) => void) { const value = JSON.parse(await readFile(documentPath(), 'utf8')); change(value); await writeFile(documentPath(), JSON.stringify(value)); }
function writer(expected = 0, mode = 'normal') {
  const child = fork(fileURLToPath(new URL('./writer.ts', import.meta.url)), [root, course.courseId, String(expected), mode], {
    execArgv: ['--import', 'tsx'], stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  children.push(child);
  const queued: any[] = []; let notify: (() => void) | undefined; let failure: Error | undefined;
  child.on('message', message => { queued.push(message); notify?.(); });
  child.on('error', error => { failure = error; notify?.(); });
  let stderr = ''; child.stderr?.on('data', chunk => { stderr += String(chunk); });
  child.on('exit', code => { if (code !== 0 && code !== null) { failure = new Error(`Worker exit ${code}: ${stderr}`); notify?.(); } });
  return {
    child,
    async next(): Promise<any> {
      if (!queued.length && !failure) await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Worker timeout: ' + stderr)), 10000);
        notify = () => { clearTimeout(timeout); resolve(); };
      });
      notify = undefined; if (failure) throw failure; return queued.shift();
    },
  };
}

describe('single-document atomic store', () => {
  it('evidence, intentions, preferences survive a new store and default root stays isolated', async () => {
    const updated = await store.update<Course>(course.courseId, 0, current => {
      current!.evidence.push({ schemaVersion: 1, revision: 0, id: randomUUID(), ...EVIDENCE }); return current!;
    });
    expect((await new Store(root).course(course.courseId)).evidence).toEqual(updated.evidence);
    await store.update('preferences', -1, () => ({ schemaVersion: 1, revision: 0, cards: 'never' }));
    expect((await new Store(root).preferences()).cards).toBe('never');
    expect(await readdir(root)).toEqual(['study-space']);
  });
  it.each(['../evil', '/absolute', '.', 'a/b', '..', '00000000-0000-0000-0000-000000000000', 'preferences/../../x'])('rejects path or malformed course ID %s', async invalid => {
    await expect(store.course(invalid)).rejects.toThrow('Invalid UUID');
    await expect(store.update(invalid, -1, () => course)).rejects.toThrow('Invalid UUID');
  });
  it.each([
    (d: any) => { d.schemaVersion = 2; }, (d: any) => { d.schemaVersion = '1'; },
    (d: any) => { delete d.revision; }, (d: any) => { d.revision = -1; },
    (d: any) => { d.extra = 'authority'; }, (d: any) => { d.deck = 'foreign'; },
    (d: any) => { d.courseId = randomUUID(); }, (d: any) => { d.path = 'path'; },
    (d: any) => { d.evidence = [{ ...EVIDENCE, schemaVersion: 2, revision: 0, id: randomUUID() }]; },
    (d: any) => { d.intentions = [{ id: randomUUID(), evidenceId: randomUUID(), deck: d.deck, cards: [], attempts: [] }]; },
  ])('malformed/unknown versions and values fail; never reset or overwrite', async change => {
    await patch(change); const previous = await readFile(documentPath(), 'utf8');
    await expect(store.course(course.courseId)).rejects.toThrow();
    await expect(store.update<Course>(course.courseId, 0, () => course)).rejects.toThrow();
    expect(await readFile(documentPath(), 'utf8')).toBe(previous);
    expect(await readdir(data())).not.toContain('.write-lock');
  });
  it('invalid JSON and preference versions fail without resets', async () => {
    await writeFile(documentPath(), '{bad'); await expect(store.list()).rejects.toThrow();
    await writeFile(join(data(), 'preferences.json'), '{"schemaVersion":9,"revision":0,"cards":"ask"}');
    await expect(store.preferences()).rejects.toThrow('schemaVersion');
  });
  it('rejects document symlinks for reads and writes without touching target', async () => {
    const target = join(root, 'target.json'); await writeFile(target, '{}'); await rm(documentPath()); await symlink(target, documentPath());
    await expect(store.course(course.courseId)).rejects.toThrow();
    await expect(store.update<Course>(course.courseId, 0, () => course)).rejects.toThrow();
    expect(await readFile(target, 'utf8')).toBe('{}');
  });
  it('rejects symlink data root and lock; accepts explicitly chosen root symlink', async () => {
    const other = await mkdtemp(join(tmpdir(), 'study-space-other-'));
    try {
      const chosenLink = join(root, 'chosen-link'); await symlink(other, chosenLink);
      await new Store(chosenLink).update<Course>(course.courseId, -1, () => course);
      expect((await new Store(other).course(course.courseId)).courseId).toBe(course.courseId);
      await rm(data(), { recursive: true }); await symlink(other, data());
      await expect(store.list()).rejects.toThrow('Unsafe study-space root');
      await rm(data()); await mkdir(data()); await symlink(other, join(data(), '.write-lock'));
      await expect(store.update<Course>(course.courseId, -1, () => course)).rejects.toThrow('locked');
    } finally { await rm(other, { recursive: true, force: true }); }
  });
  it('rejects descendant symlink even when hidden temp entry', async () => {
    await symlink(root, join(data(), `.tmp-${randomUUID()}`)); await expect(store.list()).rejects.toThrow('Unsafe entry');
  });
  it('existing lock is not stolen; manual recovery only', async () => {
    await mkdir(join(data(), '.write-lock')); await expect(store.update<Course>(course.courseId, 0, current => current!)).rejects.toThrow('no automatic takeover');
    expect(await readdir(data())).toContain('.write-lock');
  });
  it('aborts before write or after change, releases lock and removes temps', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(store.update<Course>(course.courseId, 0, current => current!, controller.signal)).rejects.toThrow();
    const later = new AbortController();
    await expect(store.update<Course>(course.courseId, 0, current => { current!.topic = 'wrong'; later.abort(); return current!; }, later.signal)).rejects.toThrow();
    expect((await store.course(course.courseId)).topic).toBe('resources');
    expect(await readdir(data())).toEqual([`${course.courseId}.json`]);
  });
  it('write callback failures never leave lock or change revision', async () => {
    await expect(store.update<Course>(course.courseId, 0, () => { throw new Error('failure'); })).rejects.toThrow('failure');
    expect((await store.course(course.courseId)).revision).toBe(0); expect(await readdir(data())).not.toContain('.write-lock');
  });
});

describe('real parallel CROSS PROCESS exclusive lock and CAS', () => {
  it('process holding mkdir lock blocks another process; after release its stale revision still conflicts', async () => {
    const a = writer(0, 'hold'); const b = writer();
    expect((await a.next()).state).toBe('ready'); expect((await b.next()).state).toBe('ready');
    a.child.send('go'); expect((await a.next()).state).toBe('locked');
    b.child.send('go'); expect(await b.next()).toMatchObject({ state: 'error', message: expect.stringContaining('locked') });
    a.child.send('release'); expect(await a.next()).toEqual({ state: 'done', revision: 1 });
    const stale = writer(); expect((await stale.next()).state).toBe('ready'); stale.child.send('go');
    expect(await stale.next()).toMatchObject({ state: 'error', message: expect.stringContaining('Revision conflict') });
    expect((await store.course(course.courseId)).revision).toBe(1);
  }, 15000);
  it('simultaneous competing processes cannot lose updates or both commit same revision', async () => {
    const a = writer(); const b = writer(); await Promise.all([a.next(), b.next()]);
    a.child.send('go'); b.child.send('go'); const results = await Promise.all([a.next(), b.next()]);
    expect(results.filter(r => r.state === 'done')).toHaveLength(1); expect(results.filter(r => r.state === 'error')).toHaveLength(1);
    expect((await store.course(course.courseId)).revision).toBe(1);
  }, 15000);
});
