import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getFlashcardsRoot, getReviewDir } from './paths.js';
import { createReviewStateStore } from './review-state-store.js';
import { createInitialReviewState } from './scheduler.js';

let piwinRoot: string;
let reviewDir: string;
let ensureDirs: () => Promise<void>;

beforeEach(async () => {
  piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-review-'));
  const flashcardsRoot = getFlashcardsRoot(piwinRoot);
  reviewDir = getReviewDir(flashcardsRoot);
  ensureDirs = async () => {
    await mkdir(reviewDir, { recursive: true });
  };
});

afterEach(async () => {
  await rm(piwinRoot, { recursive: true, force: true });
});

describe('review-state-store', () => {
  it('returns null for a missing review file', async () => {
    const store = createReviewStateStore({
      flashcardsRoot: getFlashcardsRoot(piwinRoot),
      reviewDir,
      ensureDirs,
    });
    await expect(store.read('card-missing')).resolves.toBeNull();
  });

  it('writes and reads review state atomically', async () => {
    const store = createReviewStateStore({
      flashcardsRoot: getFlashcardsRoot(piwinRoot),
      reviewDir,
      ensureDirs,
    });
    const state = createInitialReviewState('card-1');
    await store.write(state);
    const raw = await readFile(join(reviewDir, 'card-1.json'), 'utf8');
    expect(JSON.parse(raw)).toEqual(state);
    await expect(store.read('card-1')).resolves.toEqual(state);
  });

  it('preserves a corrupt review file as .bak and returns null', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const store = createReviewStateStore({
      flashcardsRoot: getFlashcardsRoot(piwinRoot),
      reviewDir,
      ensureDirs,
    });
    await ensureDirs();
    const path = join(reviewDir, 'card-bad.json');
    await writeFile(path, '{not-json', 'utf8');
    await expect(store.read('card-bad')).resolves.toBeNull();
    await expect(readFile(`${path}.bak`, 'utf8')).resolves.toBe('{not-json');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('corrupt review state for card-bad'));
    warn.mockRestore();
  });

  it('treats JSON missing due as corrupt user data', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const store = createReviewStateStore({
      flashcardsRoot: getFlashcardsRoot(piwinRoot),
      reviewDir,
      ensureDirs,
    });
    await ensureDirs();
    await writeFile(
      join(reviewDir, 'card-nodue.json'),
      JSON.stringify({ cardId: 'card-nodue' }),
      'utf8',
    );
    await expect(store.read('card-nodue')).resolves.toBeNull();
    await expect(readFile(join(reviewDir, 'card-nodue.json.bak'), 'utf8')).resolves.toContain(
      'card-nodue',
    );
    warn.mockRestore();
  });

  it('defaults a missing revision to 0', async () => {
    const store = createReviewStateStore({
      flashcardsRoot: getFlashcardsRoot(piwinRoot),
      reviewDir,
      ensureDirs,
    });
    await ensureDirs();
    await writeFile(
      join(reviewDir, 'card-legacy.json'),
      JSON.stringify({
        cardId: 'card-legacy',
        due: '2026-08-30T00:00:00.000Z',
        stability: 0,
        difficulty: 0,
        reps: 0,
        lapses: 0,
      }),
      'utf8',
    );
    await expect(store.read('card-legacy')).resolves.toMatchObject({
      cardId: 'card-legacy',
      revision: 0,
    });
  });

  it('deletes basic and cloze review files for an item', async () => {
    const store = createReviewStateStore({
      flashcardsRoot: getFlashcardsRoot(piwinRoot),
      reviewDir,
      ensureDirs,
    });
    await store.write(createInitialReviewState('item-1'));
    await store.write(createInitialReviewState('item-1:c1'));
    await store.write(createInitialReviewState('item-1:c2'));
    await store.write(createInitialReviewState('item-2:c1'));
    await store.deleteForItem('item-1');
    await expect(store.read('item-1')).resolves.toBeNull();
    await expect(store.read('item-1:c1')).resolves.toBeNull();
    await expect(store.read('item-1:c2')).resolves.toBeNull();
    await expect(store.read('item-2:c1')).resolves.toMatchObject({ cardId: 'item-2:c1' });
  });

  it('ensureForItem creates missing cloze ordinal states only', async () => {
    const store = createReviewStateStore({
      flashcardsRoot: getFlashcardsRoot(piwinRoot),
      reviewDir,
      ensureDirs,
    });
    const item = {
      id: 'item-cloze',
      model: 'cloze' as const,
      deck: 'd',
      text: '{{c1::A}} then {{c2::B}}',
      createdAt: new Date().toISOString(),
    };
    await store.write({ ...createInitialReviewState('item-cloze:c1'), reps: 3 });
    await store.ensureForItem(item);
    const kept = await store.read('item-cloze:c1');
    const created = await store.read('item-cloze:c2');
    expect(kept?.reps).toBe(3);
    expect(created?.reps).toBe(0);
  });

  it('rejects path traversal in card ids', async () => {
    const store = createReviewStateStore({
      flashcardsRoot: getFlashcardsRoot(piwinRoot),
      reviewDir,
      ensureDirs,
    });
    await expect(store.read('../../etc/passwd')).rejects.toThrow('path traversal');
  });
});
