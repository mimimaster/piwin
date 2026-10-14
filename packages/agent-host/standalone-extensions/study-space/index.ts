import type { ExtensionAPI, ExtensionContext, ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import { newTopic, sameName, type Mode, type Topic } from './model.js';
import { Store } from './store.js';
import { capabilities, studyPrompt } from './prompt.js';
import { NativeGate, type Active } from './native.js';
import { localAction, PARAMETERS } from './local.js';
import { dashboard, hint, modeLabel } from './status.js';

const USAGE = 'Study Space：/learn <主题> 学习 · /review 到期复习与回炉 · /study 看板 · /study save 沉淀刚才的对话 · /study off 退出';
const NEW_TOPIC = '新主题…';
const STATUS_KEY = 'study-space';
const WIDGET_KEY = 'study-space-progress';

/** Optional Pi extension. Loading it never puts a session into study mode; only the user's commands do. */
export default function studySpace(pi: ExtensionAPI): void {
  const store = new Store();
  let active: Active | undefined;
  let generation = 0;
  let cancellation = new AbortController();
  const gate = new NativeGate(store, () => active);

  function clear(ctx: ExtensionContext): void {
    generation++; cancellation.abort(); cancellation = new AbortController();
    active = undefined;
    ctx.ui.setStatus(STATUS_KEY, undefined); ctx.ui.setWidget(WIDGET_KEY, undefined);
  }
  function activate(ctx: ExtensionContext, mode: Mode, topic: Topic | undefined): Active {
    generation++; cancellation.abort(); cancellation = new AbortController();
    active = { mode, topic, generation, signal: cancellation.signal };
    ctx.ui.setStatus(STATUS_KEY, modeLabel(active));
    return active;
  }
  function report(ctx: ExtensionContext, message: string): void {
    ctx.ui.notify(message, 'info');
    if (!ctx.hasUI) pi.sendMessage({ customType: 'study-space-status', content: message, display: true }, { triggerTurn: false });
  }

  pi.on('session_start', (_event, ctx) => clear(ctx));
  pi.on('session_before_switch', (_event, ctx) => clear(ctx));
  pi.on('session_shutdown', (_event, ctx) => clear(ctx));
  pi.on('before_agent_start', async (event, ctx) => {
    const activation = active;
    if (!activation) return;
    ctx.ui.setWidget(WIDGET_KEY, undefined);
    const preferences = await store.preferences();
    return { systemPrompt: event.systemPrompt + studyPrompt(activation.mode, activation.topic, preferences, capabilities(pi.getAllTools().map(t => t.name))) };
  });
  pi.on('agent_end', (_event, ctx) => { if (active?.mode === 'save') clear(ctx); });

  async function chooseTopic(argument: string, ctx: ExtensionCommandContext): Promise<Topic | undefined> {
    const topics = await store.list();
    let wanted = argument;
    if (!wanted) {
      if (!ctx.hasUI) { report(ctx, `${USAGE}\n已有主题：${topics.map(t => t.topic).join('、') || '无'}`); return; }
      const picked = topics.length ? await ctx.ui.select('Study Space · 学习哪个主题？', [...topics.map(t => t.topic), NEW_TOPIC]) : NEW_TOPIC;
      if (!picked) return;
      wanted = picked === NEW_TOPIC ? (await ctx.ui.input('Study Space · 想学什么？'))?.trim() ?? '' : picked;
      if (!wanted) return;
    }
    const existing = topics.find(t => sameName(t.topic, wanted));
    if (existing) return existing;
    const created = newTopic(wanted);
    return store.update<Topic>(created.topicId, -1, () => created, cancellation.signal);
  }
  async function enter(ctx: ExtensionCommandContext, started: number, mode: Mode, topic: Topic | undefined): Promise<void> {
    if (generation !== started) { report(ctx, 'Study Space：会话已切换，本次操作已取消。'); return; }
    const activation = activate(ctx, mode, topic);
    const lines = hint(activation);
    if (ctx.hasUI) ctx.ui.setWidget(WIDGET_KEY, lines, { placement: 'aboveEditor' });
    report(ctx, lines.join('：'));
  }
  async function run(command: 'study' | 'learn' | 'review', args: string, ctx: ExtensionCommandContext): Promise<void> {
    const argument = args.trim();
    try {
      if (command === 'study' && !argument) {
        const lines = dashboard(active, await store.list(), await store.preferences());
        if (ctx.hasUI) ctx.ui.setWidget(WIDGET_KEY, lines, { placement: 'aboveEditor' });
        else report(ctx, lines.join('\n'));
        return;
      }
      if (command === 'study' && !['off', 'save'].includes(argument)) { report(ctx, USAGE); return; }
      if (command === 'review' && argument) { report(ctx, USAGE); return; }
      // A mode change mid-turn would rewrite the rules under a running answer.
      const started = generation;
      if (!ctx.isIdle()) await ctx.waitForIdle();
      if (command === 'study' && argument === 'off') {
        if (generation !== started) return;
        clear(ctx);
        report(ctx, 'Study Space 已退出。学习进度、wiki 和卡片都保留。');
        return;
      }
      if (command === 'study') { await enter(ctx, started, 'save', active?.topic); return; }
      if (command === 'review') { await enter(ctx, started, 'review', active?.topic); return; }
      const topic = await chooseTopic(argument, ctx);
      if (topic) await enter(ctx, started, 'learn', topic);
    } catch (error) { report(ctx, `Study Space：${(error as Error).message}`); }
  }

  pi.registerCommand('study', {
    description: '学习看板 · Study dashboard [save 沉淀 | off 退出]', handler: (args, ctx) => run('study', args, ctx),
  });
  pi.registerCommand('learn', {
    description: '学习主题 · Learn a topic with your wiki and cards [主题 / topic]', handler: (args, ctx) => run('learn', args, ctx),
  });
  pi.registerCommand('review', {
    description: '到期复习与回炉 · Due cards and re-teaching', handler: (args, ctx) => run('review', args, ctx),
  });
  pi.registerTool({
    name: 'study_space', label: 'Study Space',
    description: 'Study Space progress for the topic the user started with /learn: the concept path, each concept\'s status, its wiki page and the points the user got wrong. Only works while study mode is on. It never writes the wiki or creates cards; use wiki_write and flashcard_batch_create for those.',
    parameters: PARAMETERS,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      try {
        const activation = active;
        if (!activation) throw new Error('Study mode is off; the user starts it with /learn, /review or /study save');
        const combined = AbortSignal.any([activation.signal, ...(signal ? [signal] : [])]);
        const result = await localAction(store, activation, params, ctx, combined);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }], details: {} };
      } catch (error) { return { content: [{ type: 'text' as const, text: `Study Space rejected: ${(error as Error).message}` }], details: { rejected: true } }; }
    },
  });
  pi.on('tool_call', (event, ctx) => gate.call(event, ctx));
}
