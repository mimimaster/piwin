import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { Store } from '../store.js';
import { capabilities } from '../prompt.js';
import { harness, call, BASIC, EVIDENCE } from './harness.js';

let root: string;
const originalRoot = process.env.PIWIN_ROOT;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'study-space-ext-')); process.env.PIWIN_ROOT = root; });
afterEach(async () => { if (originalRoot === undefined) delete process.env.PIWIN_ROOT; else process.env.PIWIN_ROOT = originalRoot; await rm(root, { recursive: true, force: true }); });
async function course() { return (await new Store(root).list())[0]!; }

describe('explicit ephemeral lifecycle', () => {
  it.each([true, false])('topicless TA opts in without a course or dialog (UI=%s)', async hasUI => {
    const h = harness(hasUI);
    await h.command('ta');
    expect((await h.prompt()).systemPrompt).toContain('role="ta"');
    expect(h.ctx.ui.input).not.toHaveBeenCalled();
    await expect(access(join(root, 'study-space'))).rejects.toThrow();
    expect((await h.execute({ action: 'get' })).details).toEqual({ rejected: true });
    const blocked = await h.event('tool_call', call('flashcard_create', BASIC));
    expect(blocked).toMatchObject({ block: true, reason: expect.stringContaining('No active course') });
    await h.command('off');
    expect(await h.prompt()).toBeUndefined();
    await expect(access(join(root, 'study-space'))).rejects.toThrow();
  });
  it('waits for idle before changing a live teaching role', async () => {
    const h = harness();
    await h.command('ta');
    vi.mocked(h.ctx.isIdle).mockReturnValue(false);
    let finish: (() => void) | undefined;
    vi.mocked(h.ctx.waitForIdle).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = h.command('off');
    expect((await h.prompt()).systemPrompt).toContain('role="ta"');
    if (!finish) throw new Error('Idle wait was not reached');
    finish();
    await pending;
    expect(await h.prompt()).toBeUndefined();
  });
  it('off default has no prompt/disk/toolset/coding effects and local actions reject', async () => {
    const h = harness();
    expect(await h.prompt()).toBeUndefined();
    await h.event('session_start', { reason: 'resume', transcript: { teacher: 'learn' } });
    expect(await h.prompt()).toBeUndefined();
    expect(await h.event('tool_call', call('bash', { command: 'test' }))).toBeUndefined();
    expect(await h.event('tool_call', call('flashcard_create', BASIC))).toBeUndefined();
    const res = await h.execute({ action: 'list' });
    expect(res.details).toEqual({ rejected: true });
    await expect(access(join(root, 'study-space'))).rejects.toThrow();
    expect(h.pi.setActiveTools).not.toHaveBeenCalled(); expect(h.pi.exec).not.toHaveBeenCalled(); expect(h.pi.appendEntry).not.toHaveBeenCalled();
  });
  it.each(['learn', 'ta', 'review'])('%s adds to—not replaces—coding rules', async role => {
    const h = harness(); await h.command('learn files');
    if (role !== 'learn') await h.command(role === 'review' ? `review ${(await course()).courseId}` : 'ta files');
    const prompt = (await h.prompt()).systemPrompt;
    expect(prompt.startsWith('Original coding rules.')).toBe(true);
    expect(prompt).toContain(`role="${role}"`); expect(prompt).not.toContain('ADHD');
    expect(prompt).toContain('No default lesson cards');
    expect(h.pi.setActiveTools).not.toHaveBeenCalled();
    if (role === 'ta') expect(prompt).toContain('Do not impose an entire curriculum');
  });
  it.each(['session_start', 'session_before_switch', 'session_shutdown'])('%s clears role and own status', async event => {
    const h = harness(); await h.command('learn files'); await h.event(event);
    expect(await h.prompt()).toBeUndefined(); expect(h.ctx.ui.setStatus).toHaveBeenLastCalledWith('study-space', undefined);
  });
  it('replacement needs explicit resume; disk evidence is not activation truth', async () => {
    const h = harness(); await h.command('learn files');
    await h.execute({ action: 'evidence', expectedRevision: 0, ...EVIDENCE });
    const saved = await course();
    const replacement = harness(); expect(await replacement.prompt()).toBeUndefined();
    await replacement.command(`resume ${saved.courseId}`);
    const prompt = (await replacement.prompt()).systemPrompt;
    expect(prompt).toContain(EVIDENCE.userAnswer); expect(prompt).toContain(saved.courseId);
    await replacement.command('off'); expect(await replacement.prompt()).toBeUndefined(); expect((await course()).evidence).toHaveLength(1);
  });
  it('noUI accepts text commands and reports honest text; no implicit topic/course', async () => {
    const h = harness(false); await h.command('learn'); expect(await h.prompt()).toBeUndefined();
    await h.command('learn files'); expect(await h.prompt()).toBeDefined();
    await h.command('status'); expect(h.pi.sendMessage).toHaveBeenCalled();
    await h.command('off'); await h.command('resume'); expect(await h.prompt()).toBeUndefined();
    expect(h.ctx.ui.input).not.toHaveBeenCalled(); expect(h.ctx.ui.select).not.toHaveBeenCalled();
  });
  it('status stays off and rejects invalid command args', async () => {
    const h = harness(); await h.command('status'); expect(await h.prompt()).toBeUndefined();
    await h.command('status unexpected'); await h.command('resume ../x'); expect(await h.prompt()).toBeUndefined();
    expect(h.ctx.ui.notify).toHaveBeenLastCalledWith(expect.stringContaining('Invalid UUID'), 'info');
  });
  it('off during a dialog cancels pending activation', async () => {
    const h = harness(); let finish!: (value: string) => void;
    vi.mocked(h.ctx.ui.input).mockImplementation(() => new Promise(resolve => { finish = resolve as (s: string) => void; }));
    const command = h.command('learn'); await h.command('off'); finish('late topic'); await command;
    expect(await h.prompt()).toBeUndefined();
  });
});

describe('capabilities and own data tool', () => {
  it('toolbox-only is discoverable, not falsely degraded', async () => {
    expect(capabilities(['piwin_toolbox']).flashcard_study_write).toBe('discoverable');
    expect(capabilities(['flashcard_study_write']).flashcard_study_write).toBe('direct');
    expect(capabilities([]).flashcard_study_write).toBe('unavailable');
    const h = harness(); await h.command('learn files');
    expect((await h.prompt()).systemPrompt).toContain('search(query="flashcard")');
    expect((await h.prompt()).systemPrompt).toContain('If discovery shows no suitable tools');
    expect(h.pi.exec).not.toHaveBeenCalled();
  });
  it('stable UUID/deck survive rename and profile/evidence persist', async () => {
    const h = harness(); await h.command('learn files'); const first = await course();
    await h.execute({ action: 'rename', expectedRevision: 0, topic: 'New title' });
    await h.execute({ action: 'profile', expectedRevision: 1, profile: 'Knows JS basics', path: ['diagnose', 'practice'] });
    await h.execute({ action: 'evidence', expectedRevision: 2, ...EVIDENCE });
    const saved = await course(); expect(saved.courseId).toBe(first.courseId); expect(saved.deck).toBe(first.deck);
    expect(saved.topic).toBe('New title'); expect(saved.path).toEqual(['diagnose', 'practice']);
    expect(saved.evidence[0]).toMatchObject({ schemaVersion: 1, revision: 0, ...EVIDENCE });
  });
  it.each([
    { action: 'activate', role: 'learn' }, { action: 'get', courseId: '../bad' },
    { action: 'rename', expectedRevision: 0, topic: 'ok', root: '/tmp' },
    { action: 'intention', expectedRevision: 0, evidenceId: '../bad', cards: [BASIC], deck: 'foreign' },
    { action: 'evidence', expectedRevision: 0, ...EVIDENCE, mastered: true },
    { action: 'evidence', expectedRevision: 0, ...EVIDENCE, userAnswer: '' },
    { action: 'preference', expectedRevision: -1, cards: 'automatic' },
  ])('rejects forged/unknown local parameters %j', async params => {
    const h = harness(); await h.command('learn files'); expect((await h.execute(params)).details).toEqual({ rejected: true });
    expect((await course()).revision).toBe(0);
  });
  it('strict schema uses additionalProperties:false for each local action', () => {
    const h = harness(); const schema = h.local.parameters as any;
    expect(schema.anyOf.every((s: any) => s.additionalProperties === false)).toBe(true);
  });
  it('competing local revisions conflict and aborted operations leave data unchanged', async () => {
    const h = harness(); await h.command('learn files');
    await h.execute({ action: 'rename', expectedRevision: 0, topic: 'first' });
    expect((await h.execute({ action: 'rename', expectedRevision: 0, topic: 'lost update' })).details).toEqual({ rejected: true });
    const controller = new AbortController(); controller.abort();
    expect((await h.execute({ action: 'rename', expectedRevision: 1, topic: 'aborted' }, controller.signal)).details).toEqual({ rejected: true });
    expect((await course()).topic).toBe('first');
  });
  it('never-card preference survives off/replacement and re-enable fails closed without UI', async () => {
    const h = harness(false); await h.command('learn files'); const saved = await course();
    await h.execute({ action: 'preference', expectedRevision: -1, cards: 'never' }); await h.command('off');
    const replacement = harness(false); await replacement.command(`resume ${saved.courseId}`);
    expect((await replacement.execute({ action: 'status' })).content[0]).toMatchObject({ text: expect.stringContaining('never') });
    expect((await replacement.execute({ action: 'preference', expectedRevision: 0, cards: 'ask' })).details).toEqual({ rejected: true });
  });
});
