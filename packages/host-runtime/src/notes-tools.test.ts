import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNoteStore, openNoteIndex, type NoteIndex } from '@piwin/notes';
import { buildNotesTools } from './notes-tools.js';
import { evaluateNotesPermission } from './permission-policy.js';

let cleanupDirs: string[] = [];
let openIndexes: NoteIndex[] = [];

afterEach(async () => {
  for (const index of openIndexes) index.close();
  openIndexes = [];
  for (const dir of cleanupDirs) await rm(dir, { recursive: true, force: true });
  cleanupDirs = [];
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'piwin-notes-tools-'));
  cleanupDirs.push(root);
  const store = createNoteStore({ piwinRoot: root });
  const index = await openNoteIndex(store);
  openIndexes.push(index);
  return { store, index };
}

describe('buildNotesTools', () => {
  it('returns empty when disabled', async () => {
    const { store, index } = await setup();
    expect(buildNotesTools({ store, index, enabled: false })).toEqual([]);
  });

  it('registers note_* tools; write asks, search allows', async () => {
    const { store, index } = await setup();
    const requestPermission = vi.fn(async () => 'allow' as const);
    const tools = buildNotesTools({ store, index, enabled: true, requestPermission });
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'note_delete',
      'note_list',
      'note_read',
      'note_search',
      'note_update',
      'note_write',
    ]);

    const writeTool = tools.find((tool) => tool.name === 'note_write');
    if (!writeTool) throw new Error('note_write missing');
    const writtenRaw = await writeTool.execute({
      title: '闪卡设计',
      content: '闪卡复习使用 FSRS 调度算法。',
      tags: ['srs'],
    });
    const written = JSON.parse(writtenRaw) as { id: string };
    expect(requestPermission).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'notes:note_write' }),
    );

    const searchTool = tools.find((tool) => tool.name === 'note_search');
    if (!searchTool) throw new Error('note_search missing');
    requestPermission.mockClear();
    const hitsRaw = await searchTool.execute({ query: '复习 调度' });
    const hits = JSON.parse(hitsRaw) as Array<{ id: string; snippet: string }>;
    expect(hits.some((hit) => hit.id === written.id)).toBe(true);
    // read path must not prompt
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('denies mutating tools without a permission gate (non-interactive)', async () => {
    const { store, index } = await setup();
    const tools = buildNotesTools({ store, index, enabled: true });
    const deleteTool = tools.find((tool) => tool.name === 'note_delete');
    if (!deleteTool) throw new Error('note_delete missing');
    await expect(deleteTool.execute({ noteId: 'whatever' })).rejects.toThrow('Permission deny');
  });

  it('readOnly mode returns only note_search, note_list, note_read', async () => {
    const { store, index } = await setup();
    const tools = buildNotesTools({ store, index, enabled: true, readOnly: true });
    expect(tools.map((t) => t.name).sort()).toEqual([
      'note_list',
      'note_read',
      'note_search',
    ]);
  });
});

describe('evaluateNotesPermission', () => {
  it('allows reads, asks for mutations, denies empty ids', () => {
    expect(evaluateNotesPermission('note_search', 'query').decision).toBe('allow');
    expect(evaluateNotesPermission('note_list', '').decision).toBe('allow');
    expect(evaluateNotesPermission('note_write', 'content').decision).toBe('ask');
    expect(evaluateNotesPermission('note_delete', 'id-1').decision).toBe('ask');
    expect(evaluateNotesPermission('note_delete', '').decision).toBe('deny');
    expect(evaluateNotesPermission('note_search', 'x'.repeat(501)).decision).toBe('deny');
  });
});
