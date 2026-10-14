import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { call, harness } from './harness.js';

let root: string; let previous: string | undefined;
beforeEach(async () => { previous = process.env.PIWIN_ROOT; root = await mkdtemp(join(tmpdir(), 'study-space-native-')); process.env.PIWIN_ROOT = root; });
afterEach(async () => { if (previous === undefined) delete process.env.PIWIN_ROOT; else process.env.PIWIN_ROOT = previous; await rm(root, { recursive: true, force: true }); });

const CARD = { model: 'basic', front: 'Why close the file?', back: 'Release descriptors.', deck: 'files', tags: ['files'],
  sourceExcerpt: 'Closing releases the descriptor.', sourceFolder: '/wiki', sourceFile: 'concepts/file-descriptors.md' };

describe('native gate', () => {
  it('touches nothing while study mode is off', async () => {
    const h = harness();
    expect(await h.event('tool_call', call('flashcard_study_write', { action: 'rate' }))).toBeUndefined();
    expect(await h.event('tool_call', call('flashcard_create', CARD))).toBeUndefined();
  });
  it.each([false, true])('lets card creation with source fields and a readable deck through to Host approval without its own dialog (toolbox=%s)', async toolbox => {
    const h = harness(); await h.command('learn', 'files');
    expect(await h.event('tool_call', call('flashcard_create', CARD, toolbox))).toBeUndefined();
    expect(await h.event('tool_call', call('flashcard_batch_create', { cards: [CARD] }, toolbox))).toBeUndefined();
    expect(h.ui.confirm).not.toHaveBeenCalled();
  });
  it.each([false, true])('blocks card creation after the user turned cards off (toolbox=%s)', async toolbox => {
    const h = harness(); await h.command('learn', 'files');
    expect((await h.execute({ action: 'preference', cards: 'never' })).rejected).toBe(false);
    for (const name of ['flashcard_create', 'flashcard_batch_create']) {
      expect(await h.event('tool_call', call(name, CARD, toolbox))).toMatchObject({ block: true, reason: expect.stringContaining('card making off') });
    }
    expect(await h.prompt()).toContain('Do not create or offer cards');
  });
  it.each([false, true])('keeps scheduled review in the native panel: study writes are blocked in every mode (toolbox=%s)', async toolbox => {
    const h = harness();
    for (const command of ['learn', 'review'] as const) {
      await h.command(command, command === 'learn' ? 'files' : '');
      for (const action of ['start', 'claim', 'rate', 'undo']) {
        expect(await h.event('tool_call', call('flashcard_study_write', { action }, toolbox))).toMatchObject({ block: true, reason: expect.stringContaining('闪卡面板') });
      }
    }
  });
  it('leaves reads, wiki, knowledge and unrelated tools alone', async () => {
    const h = harness(); await h.command('learn', 'files');
    for (const name of ['flashcard_list', 'flashcard_study_read', 'wiki_write', 'knowledge_search', 'bash']) {
      expect(await h.event('tool_call', call(name, {}))).toBeUndefined();
      expect(await h.event('tool_call', call(name, {}, true))).toBeUndefined();
    }
    expect(await h.event('tool_call', { type: 'tool_call', toolCallId: 'x', toolName: 'piwin_toolbox', input: { action: 'search', query: 'flashcard' } })).toBeUndefined();
  });
});
