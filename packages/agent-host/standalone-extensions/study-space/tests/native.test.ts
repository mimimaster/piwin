import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { Store } from '../store.js';
import { harness, call, result, BASIC, SECOND, EVIDENCE } from './harness.js';

let root: string;
const originalRoot = process.env.PIWIN_ROOT;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'study-space-native-')); process.env.PIWIN_ROOT = root; });
afterEach(async () => { if (originalRoot === undefined) delete process.env.PIWIN_ROOT; else process.env.PIWIN_ROOT = originalRoot; await rm(root, { recursive: true, force: true }); });
const saved = async () => (await new Store(root).list())[0]!;
async function prepared(hasUI = true, batch = false) {
  const h = harness(hasUI); await h.command('learn files');
  await h.execute({ action: 'evidence', expectedRevision: 0, ...EVIDENCE });
  let course = await saved();
  await h.execute({ action: 'intention', expectedRevision: 1, evidenceId: course.evidence[0]!.id, cards: batch ? [BASIC, SECOND] : [BASIC] });
  course = await saved();
  const args = batch ? { cards: [BASIC, SECOND].map(c => ({ ...c, deck: course.deck })) } : { ...BASIC, deck: course.deck };
  return { h, course, args, name: batch ? 'flashcard_batch_create' : 'flashcard_create' };
}
const outcome = async () => (await saved()).intentions[0]!.attempts[0]!;

describe('narrow direct and toolbox native confirmation gates', () => {
  it.each([false, true])('blocks missing intention and no-gap diagnostics; toolbox=%s', async toolbox => {
    const h = harness(); await h.command('learn files');
    const course = await saved();
    expect(await h.event('tool_call', call('flashcard_create', { ...BASIC, deck: course.deck }, 'x', toolbox))).toMatchObject({ block: true });
    await h.execute({ action: 'evidence', expectedRevision: 0, ...EVIDENCE, gap: null });
    const updated = await saved();
    expect((await h.execute({ action: 'intention', expectedRevision: 1, evidenceId: updated.evidence[0]!.id, cards: [BASIC] })).details).toEqual({ rejected: true });
    expect(h.ctx.ui.confirm).not.toHaveBeenCalled();
  });
  it.each([false, true])('acceptance persists attempt before Host execution; toolbox=%s', async toolbox => {
    const { h, course, args, name } = await prepared();
    expect(await h.event('tool_call', call(name, args, 'x', toolbox))).toBeUndefined();
    expect(await outcome()).toMatchObject({ state: 'pending', toolCallId: 'x', cardIds: [] });
    expect(h.ctx.ui.confirm).toHaveBeenCalledWith('Study Space: create native cards?', expect.stringContaining(BASIC.back), expect.anything());
    expect(h.ctx.ui.confirm).toHaveBeenCalledWith(expect.anything(), expect.stringContaining(EVIDENCE.gap), expect.anything());
    expect((await saved()).deck).toBe(course.deck); expect(h.pi.exec).not.toHaveBeenCalled();
    expect(h.pi.setActiveTools).not.toHaveBeenCalled();
  });
  it.each([false, true])('noUI fails closed for creations even with intention; toolbox=%s', async toolbox => {
    const { h, args, name } = await prepared(false);
    expect(await h.event('tool_call', call(name, args, 'x', toolbox))).toMatchObject({ block: true, reason: expect.stringContaining('No dialog UI') });
    expect((await saved()).intentions[0]!.attempts).toHaveLength(0); expect(h.ctx.ui.confirm).not.toHaveBeenCalled();
  });
  it('persistent never-cards rejects prepared intentions/native creation', async () => {
    const { h, args, name, course } = await prepared();
    await h.execute({ action: 'preference', expectedRevision: -1, cards: 'never' });
    expect(await h.event('tool_call', call(name, args))).toMatchObject({ block: true, reason: expect.stringContaining('do not make cards') });
    expect((await h.execute({ action: 'intention', expectedRevision: course.revision, evidenceId: course.evidence[0]!.id, cards: [SECOND] })).details).toEqual({ rejected: true });
    expect(h.ctx.ui.confirm).not.toHaveBeenCalled();
  });
  it.each([{ deck: 'foreign' }, { sourceFolder: '/private' }, { authority: 'user-consent' }])('rejects native deck/authority injection %j', async injection => {
    const { h, args, name } = await prepared();
    expect(await h.event('tool_call', call(name, { ...args, ...injection }))).toMatchObject({ block: true });
    expect(h.ctx.ui.confirm).not.toHaveBeenCalled();
  });
  it('decline or off during confirmation prevents execution/attempt', async () => {
    const { h, args, name } = await prepared();
    vi.mocked(h.ctx.ui.confirm).mockResolvedValueOnce(false);
    expect(await h.event('tool_call', call(name, args))).toMatchObject({ block: true });
    vi.mocked(h.ctx.ui.confirm).mockImplementationOnce(async () => { await h.command('off'); return true; });
    expect(await h.event('tool_call', call(name, args))).toMatchObject({ block: true });
    expect((await saved()).intentions[0]!.attempts).toHaveLength(0);
  });
  it('preference changed during confirmation blocks the native call', async () => {
    const { h, args, name } = await prepared();
    vi.mocked(h.ctx.ui.confirm).mockImplementationOnce(async () => { await h.execute({ action: 'preference', expectedRevision: -1, cards: 'never' }); return true; });
    expect(await h.event('tool_call', call(name, args))).toMatchObject({ block: true });
    expect((await saved()).intentions[0]!.attempts).toHaveLength(0);
  });
  it('unrelated tools and toolbox discovery are never globally sandboxed', async () => {
    const { h } = await prepared();
    for (const event of [call('bash', { command: 'anything' }), call('custom', { action: 'claim' }),
      { toolName: 'piwin_toolbox', input: { action: 'search', query: 'flashcard' } },
      { toolName: 'piwin_toolbox', input: { action: 'call', target: 'other', arguments: { action: 'claim' } } }]) {
      expect(await h.event('tool_call', event)).toBeUndefined();
    }
  });
  it.each(['claim', 'rate'])('off has no effect on existing native %s', async action => {
    const h = harness(false); expect(await h.event('tool_call', call('flashcard_study_write', { action }))).toBeUndefined();
  });
  it.each([false, true])('rating and claim confirm actual fields+assessment; toolbox=%s', async toolbox => {
    const { h } = await prepared();
    for (const action of ['rate', 'claim']) {
      const args = { action, roundId: 'actual-round-7', rating: 'hard', operationKey: 'original', controlEpoch: 4 };
      vi.mocked(h.ctx.ui.confirm).mockResolvedValueOnce(false);
      expect(await h.event('tool_call', call('flashcard_study_write', args, action, toolbox))).toMatchObject({ block: true });
      vi.mocked(h.ctx.ui.confirm).mockResolvedValueOnce(true);
      expect(await h.event('tool_call', call('flashcard_study_write', args, action, toolbox))).toBeUndefined();
      const message = vi.mocked(h.ctx.ui.confirm).mock.calls.at(-1)![1];
      expect(message).toContain('actual-round-7'); expect(message).toContain('hard'); expect(message).toContain(EVIDENCE.assessment);
    }
  });
  it.each(['claim', 'rate'])('noUI rejects native %s, not just Host admission', async action => {
    const { h } = await prepared(false);
    expect(await h.event('tool_call', call('flashcard_study_write', { action }))).toMatchObject({ block: true });
    expect(h.ctx.ui.confirm).not.toHaveBeenCalled();
  });
  it('rating without concrete attempt/assessment fails closed', async () => {
    const h = harness(); await h.command('review');
    await h.command('learn files');
    expect(await h.event('tool_call', call('flashcard_study_write', { action: 'rate', rating: 3 }))).toMatchObject({ block: true });
    expect(h.ctx.ui.confirm).not.toHaveBeenCalled();
  });
  it.each(['goto', 'next', 'sequence', 'forged'])('rejects unsupported scheduled action %s', async action => {
    const { h } = await prepared();
    expect(await h.event('tool_call', call('flashcard_study_write', { action }))).toMatchObject({ block: true });
  });
  it.each(['start', 'checkpoint', 'undo', 'pause', 'resume', 'end'])('leaves Host scheduled %s admission intact', async action => {
    const { h } = await prepared(); expect(await h.event('tool_call', call('flashcard_study_write', { action }))).toBeUndefined();
    expect(h.ctx.ui.confirm).not.toHaveBeenCalled();
  });
});

describe('durable native outcomes, not counters or imagined completion', () => {
  it('records real single result JSON IDs, including duplicate, not details.created', async () => {
    const { h, course, args, name } = await prepared();
    await h.event('tool_call', call(name, args));
    await h.event('tool_result', result(name, args, { card: { ...BASIC, deck: course.deck, id: 'host-card-1' }, duplicate: true, display: {} }));
    expect(await outcome()).toMatchObject({ state: 'resolved', cardIds: ['host-card-1'] });
    expect(await h.event('tool_call', call(name, args, 'retry'))).toMatchObject({ block: true });
  });
  it('partial batch stores known successes+skips and never retries whole uncertain batch', async () => {
    const { h, course, args, name } = await prepared(true, true);
    await h.event('tool_call', call(name, args, 'batch', true));
    await h.event('tool_result', result(name, args, { created: [{ ...BASIC, deck: course.deck, id: 'host-card-1' }], skipped: [{ front: SECOND.front, reason: 'validation' }], display: {} }, 'batch', true));
    expect(await outcome()).toMatchObject({ state: 'partial', cardIds: ['host-card-1'] }); expect((await outcome()).skipped).toHaveLength(1);
    expect(await h.event('tool_call', call(name, args, 'retry', true))).toMatchObject({ block: true });
    await h.command('off'); await h.command(`resume ${course.courseId}`);
    expect(h.ctx.ui.notify).toHaveBeenLastCalledWith(expect.stringContaining('reconcile first'), 'info');
    await h.event('tool_result', result('flashcard_list', { deck: course.deck }, [
      { id: 'host-card-1', deck: course.deck, model: 'basic', front: BASIC.front },
      { id: 'candidate-2', deck: course.deck, model: 'basic', front: SECOND.front },
      { id: 'wrong-deck', deck: 'other', model: 'basic', front: SECOND.front },
    ]));
    expect(await outcome()).toMatchObject({ state: 'partial', cardIds: ['host-card-1', 'candidate-2'] });
    expect(h.pi.exec).not.toHaveBeenCalled();
  });
  it('lost result on replacement stays pending and deck listing reconciles candidates without replay', async () => {
    const { h, course, args, name } = await prepared(); await h.event('tool_call', call(name, args));
    const replacement = harness(); expect(await replacement.prompt()).toBeUndefined(); await replacement.command(`resume ${course.courseId}`);
    expect(await outcome()).toMatchObject({ state: 'pending', cardIds: [] });
    expect(await replacement.event('tool_call', call(name, args, 'replay'))).toMatchObject({ block: true });
    await replacement.event('tool_result', result('flashcard_list', { deck: course.deck }, [{ id: 'observed', deck: course.deck, model: 'basic', front: BASIC.front }]));
    expect(await outcome()).toMatchObject({ state: 'partial', cardIds: ['observed'] });
    expect(replacement.ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining('Never replay'), 'info');
  });
  it('batch duplicate existing card and all-created results store only exact Host IDs', async () => {
    const { h, course, args, name } = await prepared(true, true); await h.event('tool_call', call(name, args));
    await h.event('tool_result', result(name, args, { created: [{ ...BASIC, deck: course.deck, id: 'new-1' }], skipped: [{ front: SECOND.front, reason: 'duplicate', existing: { ...SECOND, deck: course.deck, id: 'existing-2' } }], display: {} }));
    expect(await outcome()).toMatchObject({ state: 'resolved', cardIds: ['new-1', 'existing-2'] });
  });
  it.each([{ created: 5 }, { card: { ...BASIC, id: 'wrong', deck: 'wrong' } }, { created: [], display: { cards: [{ id: 'fake' }] } }])('does not infer IDs from invalid/summary payload %j', async payload => {
    const { h, args, name } = await prepared(); await h.event('tool_call', call(name, args));
    await h.event('tool_result', result(name, args, payload)); expect(await outcome()).toMatchObject({ state: 'unknown', cardIds: [] });
  });
  it('parses full native JSON nested in Toolbox envelope', async () => {
    const { h, args, name, course } = await prepared(); await h.event('tool_call', call(name, args, 'nested', true));
    await h.event('tool_result', result(name, args, { result: { output: JSON.stringify({ card: { ...BASIC, deck: course.deck, id: 'nested-id' }, duplicate: false, display: {} }) } }, 'nested', true));
    expect(await outcome()).toMatchObject({ state: 'resolved', cardIds: ['nested-id'] });
  });
});
