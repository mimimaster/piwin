import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { newCourse, unresolved, type Course, type Role } from './model.js';
import { Store } from './store.js';
import { capabilities, teachingPrompt } from './prompt.js';
import { NativeGate, type Active } from './native.js';
import { localAction, PARAMETERS } from './local.js';

/** Optional Pi 0.84.2 extension. Loading/registering never opts a session into teaching. */
export default function studySpace(pi: ExtensionAPI): void {
  const store = new Store();
  let active: Active | undefined;
  let generation = 0;
  let cancellation = new AbortController();
  const gate = new NativeGate(store, () => active);
  function reset(ctx: ExtensionContext): void {
    generation++; cancellation.abort(); cancellation = new AbortController();
    active = undefined; gate.reset(); ctx.ui.setStatus('study-space', undefined);
  }
  function report(ctx: ExtensionContext, message: string): void {
    ctx.ui.notify(message, 'info');
    if (!ctx.hasUI) pi.sendMessage({ customType: 'study-space-status', content: message, display: true }, { triggerTurn: false });
  }
  pi.on('session_start', (_event, ctx) => reset(ctx));
  pi.on('session_before_switch', (_event, ctx) => reset(ctx));
  pi.on('session_shutdown', (_event, ctx) => reset(ctx));
  pi.on('before_agent_start', event => {
    if (!active) return;
    return { systemPrompt: event.systemPrompt + teachingPrompt(active.role, active.course, capabilities(pi.getAllTools().map(t => t.name))) };
  });
  pi.registerCommand('teacher', {
    description: 'Explicit opt-in: learn [topic], ta [topic], review [courseId], resume [courseId], status, off',
    async handler(args, ctx) {
      const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(args.trim());
      const command = match?.[1]; const argument = match?.[2]?.trim() ?? '';
      const commandGeneration = generation;
      try {
        if (['learn', 'ta', 'review', 'resume', 'off'].includes(command ?? '') && !ctx.isIdle()) {
          await ctx.waitForIdle();
          if (generation !== commandGeneration) { report(ctx, 'Session changed while waiting; use explicit resume.'); return; }
        }
        if (command === 'off') { if (argument) throw new Error('off takes no arguments'); reset(ctx); report(ctx, 'Study Space off. Own saved courses remain; ordinary coding continues.'); return; }
        if (command === 'status') {
          if (argument) throw new Error('status takes no arguments');
          const courses = await store.list();
          const pref = await store.read('preferences');
          report(ctx, JSON.stringify({ mode: active?.role ?? 'off', courseId: active?.course?.courseId ?? null,
            capabilities: capabilities(pi.getAllTools().map(t => t.name)), preferences: pref ?? { cards: 'ask', storageRevision: -1 },
            courses: courses.map(c => ({ courseId: c.courseId, topic: c.topic, revision: c.revision, uncertainNativeAttempts: unresolved(c) })) }, null, 2));
          return;
        }
        if (!['learn', 'ta', 'review', 'resume'].includes(command ?? '')) {
          report(ctx, 'Usage: /teacher learn [topic] | ta [topic] | review [courseId] | resume [courseId] | status | off'); return;
        }
        const captured = generation;
        const signal = cancellation.signal;
        let course: Course | undefined;
        if (command === 'ta' && !argument) {
          // Answer the current doubt without requiring a topic, dialog, or saved course.
          course = undefined;
        } else if (command === 'learn' || command === 'ta') {
          const topic = argument || (ctx.hasUI ? await ctx.ui.input('Study Space topic') : undefined);
          if (!topic) { report(ctx, 'Provide a topic as text: /teacher learn <topic> or /teacher ta <topic>'); return; }
          const created = newCourse(topic);
          course = await store.update<Course>(created.courseId, -1, () => created, signal);
        } else {
          let selected = argument;
          if (!selected) {
            const courses = await store.list();
            if (ctx.hasUI) {
              const options = courses.map(c => `${c.courseId} — ${c.topic}`);
              selected = (await ctx.ui.select('Choose saved Study Space course', options))?.split(' — ')[0] ?? '';
            } else { report(ctx, `Provide a saved courseId: ${JSON.stringify(courses.map(c => ({ courseId: c.courseId, topic: c.topic })))}`); return; }
          }
          if (!selected) return;
          course = await store.course(selected);
        }
        if (generation !== captured) { report(ctx, 'Teaching activation cancelled by session change/off; use explicit resume.'); return; }
        const role: Role = command === 'resume' ? 'learn' : command as Role;
        generation++; cancellation.abort(); cancellation = new AbortController();
        active = { role, course, generation, signal: cancellation.signal };
        ctx.ui.setStatus('study-space', `${role}: ${course?.topic ?? 'current question'}`);
        report(ctx, course
          ? `Study Space ${role}: ${course.topic}; courseId=${course.courseId}; deck=${course.deck}. Saved profile/path/evidence reloaded. ${unresolved(course) ? 'Uncertain native attempts: list this deck to reconcile first. Never replay the batch.' : 'No native actions performed.'}`
          : 'Study Space ta: answer the current doubt. No course created or required; use explicit learn/resume for course-bound practice/cards.');
      } catch (error) { report(ctx, `Study Space: ${(error as Error).message}`); }
    },
  });
  pi.registerTool({
    name: 'study_space', label: 'Study Space',
    description: 'Own teaching course/profile/evidence/intention management. Off by default; only user /teacher commands activate. No native execution or role changes. Mutations require expectedRevision (preferences initially -1).',
    parameters: PARAMETERS,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      try {
        const activation = active;
        if (!activation) throw new Error('Teaching is off; only explicit user /teacher commands can activate');
        const combined = AbortSignal.any([cancellation.signal, ...(signal ? [signal] : [])]);
        const result = await localAction(store, activation, params, ctx, combined);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }], details: {} };
      } catch (error) { return { content: [{ type: 'text' as const, text: `Study Space rejected: ${(error as Error).message}` }], details: { rejected: true } }; }
    },
  });
  pi.on('tool_call', (event, ctx) => gate.call(event, ctx));
  pi.on('tool_result', (event, ctx) => gate.result(event, ctx));
}
