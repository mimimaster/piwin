import { randomUUID } from 'node:crypto';
import type { ExtensionContext, ToolCallEvent, ToolResultEvent } from '@earendil-works/pi-coding-agent';
import { cards, cardKey, keys, object, parseCard, type Course, type Card, type Attempt } from './model.js';
import { Store } from './store.js';

export type Active = { role: 'learn' | 'ta' | 'review'; course: Course | undefined; generation: number; signal: AbortSignal };
export function nativeCall(event: { toolName: string; input: unknown }): { name: string; args: Record<string, unknown> } | undefined {
  if (event.toolName === 'piwin_toolbox') {
    const wrapper = object(event.input);
    if (wrapper.action !== 'call' || !['flashcard_create', 'flashcard_batch_create', 'flashcard_study_write', 'flashcard_list'].includes(wrapper.target as string)) return;
    return { name: wrapper.target as string, args: object(wrapper.arguments ?? {}) };
  }
  if (['flashcard_create', 'flashcard_batch_create', 'flashcard_study_write', 'flashcard_list'].includes(event.toolName)) {
    return { name: event.toolName, args: object(event.input) };
  }
}
function proposed(name: string, args: Record<string, unknown>, deck: string): Card[] {
  const rows = name === 'flashcard_create' ? [args] : (() => { keys(args, ['cards']); return args.cards; })();
  if (!Array.isArray(rows)) throw new Error('Invalid batch');
  return cards(rows.map(row => {
    const value = object(row);
    if (value.deck !== deck) throw new Error('Only the active course deck is permitted');
    const { deck: _deck, ...content } = value;
    return parseCard(content);
  }));
}
function jsonResults(content: ToolResultEvent['content']): unknown[] {
  const results: unknown[] = [];
  function visit(value: unknown, depth: number): void {
    if (depth > 5) return;
    if (typeof value === 'string') { try { visit(JSON.parse(value), depth + 1); } catch { /* display text, not authoritative JSON */ } return; }
    if (Array.isArray(value)) { results.push(value); return; }
    if (!value || typeof value !== 'object') return;
    const obj = value as Record<string, unknown>;
    results.push(obj);
    for (const key of ['output', 'result', 'content']) {
      const nested = obj[key];
      if (key === 'content' && Array.isArray(nested)) {
        for (const part of nested) if (part?.type === 'text') visit(part.text, depth + 1);
      } else visit(nested, depth + 1);
    }
  }
  for (const part of content) if (part.type === 'text') visit(part.text, 0);
  return results;
}
function knownCard(value: unknown, deck: string): { id: string; card: Card } | undefined {
  try {
    const obj = object(value);
    if (obj.deck !== deck || typeof obj.id !== 'string' || !obj.id.trim() || obj.id.length > 20000) return;
    const card = obj.model === 'basic' ? parseCard({ model: obj.model, front: obj.front, back: obj.back })
      : parseCard({ model: obj.model, text: obj.text });
    return { id: obj.id, card };
  } catch { return; }
}

/** Observes current-Run native tools; never invokes Host, reads native storage, or changes the active toolset. */
export class NativeGate {
  private readonly accepted = new Map<string, { courseId: string; intentionId: string; attemptId: string }>();
  constructor(private readonly store: Store, private readonly active: () => Active | undefined) {}
  reset(): void { this.accepted.clear(); }
  async call(event: ToolCallEvent, ctx: ExtensionContext): Promise<{ block: true; reason: string } | undefined> {
    const activation = this.active();
    if (!activation) return;
    try {
      const native = nativeCall(event); if (!native) return;
      const { name, args } = native;
      if (name === 'flashcard_list') return;
      if (!activation.course) throw new Error('No active course; use /teacher learn <topic> or /teacher resume <courseId> before native teaching actions');
      if (name === 'flashcard_study_write') {
        if (!['start', 'claim', 'checkpoint', 'rate', 'undo', 'pause', 'resume', 'end'].includes(args.action as string)) throw new Error('Only discovered scheduled review actions are allowed');
        if (args.action !== 'claim' && args.action !== 'rate') return;
        const course = await this.store.course(activation.course.courseId);
        const assessment = course.evidence.at(-1);
        if (args.action === 'rate' && !assessment) throw new Error('Record the user attempt and current assessment before rating');
        if (!ctx.hasUI) throw new Error('No dialog UI: native claim/rating blocked');
        const ok = await ctx.ui.confirm(`Study Space: ${args.action}`, `Confirm actual native ${args.action} fields (including round, rating and CAS):\n${JSON.stringify(args, null, 2)}\nCurrent assessment evidence:\n${JSON.stringify(assessment ?? 'No assessment yet; claim only', null, 2)}\nClaim can transfer control: never accept unless you intend this.`, { signal: activation.signal });
        if (!ok || this.active() !== activation || activation.signal.aborted) throw new Error('User declined or teaching mode changed');
        if ((await this.store.course(course.courseId)).revision !== course.revision) throw new Error('Assessment changed; refetch before confirmation');
        if (this.active() !== activation || activation.signal.aborted) throw new Error('Teaching mode changed');
        return;
      }
      if (!ctx.hasUI) throw new Error('No dialog UI: card creation blocked');
      const course = await this.store.course(activation.course.courseId);
      if ((await this.store.preferences()).cards === 'never') throw new Error('Persistent preference: do not make cards');
      const proposals = proposed(name, args, course.deck);
      const fingerprints = proposals.map(cardKey);
      const intention = course.intentions.find(i => !i.attempts.length && JSON.stringify(i.cards.map(cardKey)) === JSON.stringify(fingerprints));
      if (!intention) throw new Error('No matching unattempted durable intention; reconcile uncertain attempts, never replay');
      if (course.intentions.some(i => i.attempts.length && i.cards.some(c => fingerprints.includes(cardKey(c))))) throw new Error('Already attempted content; reconcile rather than replay');
      const gap = course.evidence.find(e => e.id === intention.evidenceId && e.gap !== null);
      if (!gap) throw new Error('No demonstrated learning gap');
      const consent = await ctx.ui.confirm('Study Space: create native cards?', `Learning gap and actual user evidence:\n${JSON.stringify(gap, null, 2)}\nDeck: ${course.deck}\nActual proposed content:\n${JSON.stringify(proposals, null, 2)}`, { signal: activation.signal });
      if (!consent || this.active() !== activation) throw new Error('User declined or teaching mode changed');
      const attempt: Attempt = { id: randomUUID(), toolCallId: event.toolCallId, state: 'pending', cardIds: [], skipped: [] };
      const next = await this.store.update<Course>(course.courseId, course.revision, async current => {
        if (this.active() !== activation || !current) throw new Error('Teaching mode changed');
        if ((await this.store.preferences()).cards === 'never') throw new Error('Persistent preference: do not make cards');
        const savedIntention = current.intentions.find(i => i.id === intention.id);
        if (!savedIntention) throw new Error('Intention missing; refetch before retry');
        savedIntention.attempts.push(attempt);
        return current;
      }, AbortSignal.any([activation.signal, ...(ctx.signal ? [ctx.signal] : [])]));
      if (this.active() !== activation || activation.signal.aborted) throw new Error('Teaching mode changed; pending attempt must be reconciled');
      activation.course = next;
      this.accepted.set(event.toolCallId, { courseId: course.courseId, intentionId: intention.id, attemptId: attempt.id });
      // Returning nothing lets Host admission/permissions decide; this is not a grant or execution.
      return;
    } catch (error) { return { block: true, reason: `Study Space: ${(error as Error).message}` }; }
  }
  async result(event: ToolResultEvent, ctx: ExtensionContext): Promise<void> {
    const accepted = this.accepted.get(event.toolCallId);
    if (accepted) {
      this.accepted.delete(event.toolCallId);
      try {
        const course = await this.store.course(accepted.courseId);
        const next = await this.store.update<Course>(course.courseId, course.revision, current => {
          if (!current) throw new Error('Course missing');
          const intention = current.intentions.find(i => i.id === accepted.intentionId);
          if (!intention) throw new Error('Intention missing');
          const attempt = intention.attempts.find(a => a.id === accepted.attemptId);
          if (!attempt) throw new Error('Attempt missing');
          const outcomes = new Set<string>();
          for (const value of jsonResults(event.content)) {
            if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
            const obj = value as Record<string, unknown>;
            const entries = obj.card ? [obj.card] : Array.isArray(obj.created) ? obj.created : [];
            for (const item of entries) {
              const known = knownCard(item, course.deck);
              if (known && intention.cards.some(c => cardKey(c) === cardKey(known.card))) {
                attempt.cardIds.push(known.id); outcomes.add(cardKey(known.card));
              }
            }
            if (Array.isArray(obj.skipped)) for (const value of obj.skipped) {
              const skip = value as Record<string, unknown>;
              if (!skip || !['duplicate', 'validation'].includes(skip.reason as string) || typeof skip.front !== 'string') continue;
              attempt.skipped.push(JSON.stringify({ front: skip.front, reason: skip.reason }));
              const known = knownCard(skip.existing, course.deck);
              if (known && intention.cards.some(c => cardKey(c) === cardKey(known.card))) {
                attempt.cardIds.push(known.id); outcomes.add(cardKey(known.card));
              }
            }
          }
          attempt.cardIds = [...new Set(attempt.cardIds)]; attempt.skipped = [...new Set(attempt.skipped)];
          attempt.state = outcomes.size === intention.cards.length ? 'resolved' : attempt.cardIds.length ? 'partial' : 'unknown';
          return current;
        });
        const active = this.active(); if (active?.course?.courseId === next.courseId) active.course = next;
      } catch (error) { ctx.ui.notify(`Native result not saved; attempt remains uncertain. Reconcile deck first: ${(error as Error).message}`, 'warning'); }
      return;
    }
    // List previews supply candidate IDs, not proof of the full card answer. Preserve uncertain state.
    const active = this.active(); if (!active?.course || event.isError) return;
    let native;
    try { native = nativeCall(event); } catch { return; }
    if (native?.name !== 'flashcard_list' || native.args.deck !== active.course.deck) return;
    const course = await this.store.course(active.course.courseId);
    const rows = jsonResults(event.content).filter(Array.isArray).flat();
    if (!rows.length || !course.intentions.some(i => i.attempts.some(a => a.state !== 'resolved'))) return;
    try {
      active.course = await this.store.update<Course>(course.courseId, course.revision, current => {
        if (!current) throw new Error('Course missing');
        for (const intention of current.intentions) for (const attempt of intention.attempts) {
          if (attempt.state === 'resolved') continue;
          for (const raw of rows) {
            if (!raw || typeof raw !== 'object') continue;
            const row = raw as Record<string, unknown>;
            const matches = intention.cards.filter(c => row.model === c.model && row.front === (c.model === 'basic' ? c.front : c.text.replace(/\{\{c\d+::(.*?)(?:::[^{}]*)?\}\}/g, '$1')));
            if (row.deck === current.deck && typeof row.id === 'string' && row.id.trim() && matches.length === 1) attempt.cardIds.push(row.id);
          }
          attempt.cardIds = [...new Set(attempt.cardIds)];
          attempt.state = attempt.cardIds.length ? 'partial' : 'unknown';
        }
        return current;
      });
    } catch (error) { ctx.ui.notify(`Reconciliation conflict: ${(error as Error).message}`, 'warning'); }
  }
}
