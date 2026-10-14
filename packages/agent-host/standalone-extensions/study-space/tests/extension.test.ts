import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { harness } from './harness.js';
import { Store } from '../store.js';

let root: string; let previous: string | undefined;
beforeEach(async () => { previous = process.env.PIWIN_ROOT; root = await mkdtemp(join(tmpdir(), 'study-space-ext-')); process.env.PIWIN_ROOT = root; });
afterEach(async () => { if (previous === undefined) delete process.env.PIWIN_ROOT; else process.env.PIWIN_ROOT = previous; await rm(root, { recursive: true, force: true }); });
const topics = () => new Store(root).list();
const lastWidget = (h: ReturnType<typeof harness>): string[] | undefined => h.ui.setWidget.mock.calls.at(-1)?.[1];

describe('entry points', () => {
  it('registers three described commands and one tool whose schema is a plain top-level object', () => {
    const h = harness();
    expect([...h.commands.keys()]).toEqual(['study', 'learn', 'review']);
    for (const command of h.commands.values()) expect(command.description).toMatch(/[一-鿿].* · [A-Za-z]/);
    const schema = h.local.parameters as Record<string, any>;
    expect(h.local.name).toBe('study_space');
    expect(schema.type).toBe('object'); expect(schema.anyOf).toBeUndefined(); expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(['action']);
    expect(schema.properties.action).toMatchObject({ type: 'string', enum: ['get', 'plan', 'concept', 'preference'] });
  });
  it('loading never turns study mode on', async () => {
    const h = harness(); await h.event('session_start');
    expect(await h.prompt()).toBeUndefined();
    expect((await h.execute({ action: 'get' })).text).toContain('Study mode is off');
    expect(await readdir(root)).not.toContain('nothing-else');
  });
  it('/learn <topic> creates one readable topic, shows what to send next, and reuses it by name', async () => {
    const h = harness(); await h.command('learn', ' Rust 所有权 ');
    const [topic] = await topics();
    expect(topic).toMatchObject({ topic: 'Rust 所有权', deck: 'Rust 所有权', concepts: [], revision: 0 });
    expect(h.ui.setStatus).toHaveBeenLastCalledWith('study-space', '学习 · Rust 所有权');
    expect(lastWidget(h)?.join('\n')).toContain('发送“开始”');
    const prompt = await h.prompt();
    expect(prompt).toContain('Original coding rules.'); expect(prompt).toContain('<study-space mode="learn">');
    expect(prompt).toContain('knowledge_search'); expect(prompt).toContain('wiki_write'); expect(prompt).toContain('"deck":"Rust 所有权"');
    expect(prompt).toContain(join(root, 'wiki'));
    expect(lastWidget(h)).toBeUndefined();
    await h.command('learn', 'rust 所有权');
    expect(await topics()).toHaveLength(1);
  });
  it('/learn without a topic asks for one, or offers saved topics first', async () => {
    const h = harness(); h.ui.input.mockResolvedValueOnce('HTTP 缓存');
    await h.command('learn');
    expect(h.ui.select).not.toHaveBeenCalled();
    expect((await topics()).map(t => t.topic)).toEqual(['HTTP 缓存']);
    h.ui.select.mockImplementationOnce(async (_title: string, options: string[]) => { expect(options).toEqual(['HTTP 缓存', '新主题…']); return '新主题…'; });
    h.ui.input.mockResolvedValueOnce('TLS 握手');
    await h.command('learn');
    expect((await topics()).map(t => t.topic).sort()).toEqual(['HTTP 缓存', 'TLS 握手']);
    h.ui.select.mockResolvedValueOnce('HTTP 缓存');
    await h.command('learn');
    expect(await h.prompt()).toContain('"topic":"HTTP 缓存"');
    h.ui.select.mockResolvedValueOnce(undefined);
    await h.command('learn');
    expect(await h.prompt()).toContain('"topic":"HTTP 缓存"');
    expect(await topics()).toHaveLength(2);
  });
  it('without dialog UI, a missing topic yields usage text instead of a silent no-op', async () => {
    const h = harness(false); await h.command('learn');
    expect(h.pi.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('/learn <主题>') }), { triggerTurn: false });
    expect(await h.prompt()).toBeUndefined();
    await h.command('learn', 'files');
    expect(await h.prompt()).toContain('mode="learn"');
  });
  it('waits for the running turn before changing mode and never starts a turn behind the Host', async () => {
    const h = harness(); (h.ctx.isIdle as any).mockReturnValue(false);
    await h.command('learn', 'files');
    expect(h.ctx.waitForIdle).toHaveBeenCalled();
    expect(h.pi.sendUserMessage).not.toHaveBeenCalled(); expect(h.pi.setActiveTools).not.toHaveBeenCalled();
  });
});

describe('progress tool', () => {
  it('plans a path, tracks a concept to done with its wiki page and weak points, and keeps learned concepts on re-plan', async () => {
    const h = harness(); await h.command('learn', 'files');
    let result = await h.execute({ action: 'plan', concepts: [{ name: 'descriptors' }, { name: 'buffers', wiki: 'Buffered IO' }, { name: 'fsync' }] });
    expect(result.json().topic.concepts).toEqual([
      { name: 'descriptors', status: 'planned', wiki: null, weak: [] },
      { name: 'buffers', status: 'planned', wiki: 'Buffered IO', weak: [] },
      { name: 'fsync', status: 'planned', wiki: null, weak: [] },
    ]);
    expect((await h.execute({ action: 'concept', name: 'Descriptors', status: 'learning' })).json().topic.concepts[0].status).toBe('learning');
    result = await h.execute({ action: 'concept', name: 'descriptors', status: 'done' });
    expect(result.rejected).toBe(true); expect(result.text).toContain('wiki_write first');
    result = await h.execute({ action: 'concept', name: 'descriptors', status: 'done', wiki: 'File descriptors', weak: ['thought close was optional'] });
    expect(result.json().topic.concepts[0]).toEqual({ name: 'descriptors', status: 'done', wiki: 'File descriptors', weak: ['thought close was optional'] });
    result = await h.execute({ action: 'plan', concepts: [{ name: 'fsync' }, { name: 'rename atomicity' }] });
    expect(result.json().topic.concepts.map((c: any) => [c.name, c.status])).toEqual([['descriptors', 'done'], ['fsync', 'planned'], ['rename atomicity', 'planned']]);
    expect((await h.execute({ action: 'get' })).json()).toMatchObject({ mode: 'learn', cards: 'ask', topic: { revision: 4 } });
    expect(await h.prompt()).toContain('thought close was optional');
    await h.command('study');
    expect(lastWidget(h)?.join('\n')).toContain('files：1/3 个概念已写入 wiki · 1 个薄弱点 · 下一个：fsync');
  });
  it.each([
    { action: 'plan' }, { action: 'plan', concepts: [{ name: 'a', deck: 'x' }] }, { action: 'concept', status: 'done' },
    { action: 'concept', name: 'a', status: 'mastered' }, { action: 'concept', name: 'a', topicId: 'x' },
    { action: 'get', path: '/etc' }, { action: 'activate' }, { action: 'preference', cards: 'always' },
  ])('rejects malformed or out-of-scope input %j', async params => {
    const h = harness(); await h.command('learn', 'files');
    expect((await h.execute(params)).rejected).toBe(true);
    expect((await topics())[0]?.revision).toBe(0);
  });
  it('turning cards off is immediate; turning them back on needs the user to confirm', async () => {
    const h = harness(); await h.command('learn', 'files');
    expect((await h.execute({ action: 'preference', cards: 'never' })).json().cards).toBe('never');
    h.ui.confirm.mockResolvedValueOnce(false);
    expect((await h.execute({ action: 'preference', cards: 'ask' })).rejected).toBe(true);
    expect((await new Store(root).preferences()).cards).toBe('never');
    expect((await h.execute({ action: 'preference', cards: 'ask' })).json().cards).toBe('ask');
    const noUi = harness(false); await noUi.command('learn', 'files');
    await noUi.execute({ action: 'preference', cards: 'never' });
    expect((await noUi.execute({ action: 'preference', cards: 'ask' })).rejected).toBe(true);
  });
  it('progress actions need a topic; review without one still reads', async () => {
    const h = harness(); await h.command('review');
    expect((await h.execute({ action: 'plan', concepts: [{ name: 'a' }] })).text).toContain('/learn');
    expect((await h.execute({ action: 'get' })).json()).toEqual({ mode: 'review', topic: null, cards: 'ask' });
  });
});

describe('modes and lifecycle', () => {
  it('/review keeps the current topic and tells the model to leave rating to the native panel', async () => {
    const h = harness(); await h.command('learn', 'files'); await h.command('review');
    const prompt = await h.prompt();
    expect(prompt).toContain('<study-space mode="review">'); expect(prompt).toContain('native flashcards panel');
    expect(prompt).toContain('"topic":"files"'); expect(prompt).not.toContain('flashcard_batch_create directly');
    await h.command('review', 'extra');
    expect(h.ui.notify).toHaveBeenLastCalledWith(expect.stringContaining('/review'), 'info');
  });
  it('/study shows the dashboard without changing mode; unknown arguments show usage', async () => {
    const h = harness(); await h.command('study');
    expect(lastWidget(h)?.join('\n')).toContain('还没有学习主题');
    expect(await h.prompt()).toBeUndefined();
    await h.command('study', 'nonsense');
    expect(h.ui.notify).toHaveBeenLastCalledWith(expect.stringContaining('/study save'), 'info');
    const text = harness(false); await text.command('learn', 'files'); await text.command('study');
    expect(text.pi.sendMessage).toHaveBeenLastCalledWith(expect.objectContaining({ content: expect.stringContaining('files：尚未规划概念') }), { triggerTurn: false });
  });
  it('/study save applies to exactly one turn and is not remembered', async () => {
    const h = harness(); await h.command('study', 'save');
    expect(await h.prompt()).toContain('<study-space mode="save">');
    await h.event('agent_end');
    expect(await h.prompt()).toBeUndefined();
  });
  it('/study off leaves study mode and keeps every saved topic', async () => {
    const h = harness(); await h.command('learn', 'files'); await h.command('study', 'off');
    expect(await h.prompt()).toBeUndefined();
    expect(h.ui.setStatus).toHaveBeenLastCalledWith('study-space', undefined);
    expect(await topics()).toHaveLength(1);
  });
  it('a rebuilt runtime starts off and the saved topic is one pick away', async () => {
    const first = harness(); await first.command('learn', 'files');
    await first.execute({ action: 'plan', concepts: [{ name: 'descriptors' }] });
    await first.event('session_shutdown');
    const rebuilt = harness(); await rebuilt.event('session_start');
    expect(await rebuilt.prompt()).toBeUndefined();
    await rebuilt.command('learn');
    const prompt = await rebuilt.prompt();
    expect(prompt).toContain('mode="learn"'); expect(prompt).toContain('descriptors');
    expect(lastWidget(rebuilt)).toBeUndefined();
  });
  it('switching sessions clears the in-memory mode and a stale command cannot re-activate it', async () => {
    const h = harness(); await h.command('learn', 'files');
    await h.event('session_before_switch');
    expect(await h.prompt()).toBeUndefined();
    (h.ctx.isIdle as any).mockReturnValue(false);
    (h.ctx.waitForIdle as any).mockImplementationOnce(async () => { await h.event('session_before_switch'); });
    await h.command('learn', 'files');
    expect(await h.prompt()).toBeUndefined();
  });
});
