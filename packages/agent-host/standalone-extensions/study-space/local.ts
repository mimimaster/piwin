import { Type } from 'typebox';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { keys, object, sameName, status, text, weak, MAX_CONCEPTS, STATUSES, type Concept, type Preferences, type Topic } from './model.js';
import { Store, checkAbort } from './store.js';
import type { Active } from './native.js';

const name = Type.String({ minLength: 1, maxLength: 200 });
/** Plain string enum: a top-level object with flat fields is accepted by every provider's tool schema rules. */
const choice = <T extends string>(values: T[], description: string) => Type.Unsafe<T>({ type: 'string', enum: values, description });
export const PARAMETERS = Type.Object({
  action: choice(['get', 'plan', 'concept', 'preference'], 'get: current topic. plan: set the concept path. concept: update one concept. preference: card making on/off.'),
  concepts: Type.Optional(Type.Array(Type.Object({ name, wiki: Type.Optional(name) }, { additionalProperties: false }),
    { minItems: 1, maxItems: MAX_CONCEPTS, description: 'plan: ordered concepts; wiki = existing page title if the wiki already has it.' })),
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 200, description: 'concept: which concept.' })),
  status: Type.Optional(choice(STATUSES, 'concept: planned, learning, or done (done only after its wiki page is written).')),
  wiki: Type.Optional(Type.String({ minLength: 1, maxLength: 200, description: 'concept: title of the written wiki page.' })),
  weak: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 500 }), { maxItems: 20, description: 'concept: points the user actually got wrong (replaces the list).' })),
  cards: Type.Optional(choice(['ask', 'never'], 'preference: never stops all card making.')),
}, { additionalProperties: false });

const FIELDS: Record<string, { allowed: string[]; required: string[] }> = {
  get: { allowed: [], required: [] },
  plan: { allowed: ['concepts'], required: ['concepts'] },
  concept: { allowed: ['name', 'status', 'wiki', 'weak'], required: ['name'] },
  preference: { allowed: ['cards'], required: ['cards'] },
};

/** Progress facts only. Cannot switch modes, pick another topic, or touch the wiki or the card library. */
export async function localAction(store: Store, activation: Active, raw: unknown, ctx: ExtensionContext, signal?: AbortSignal): Promise<unknown> {
  const p = object(raw);
  const fields = typeof p.action === 'string' ? FIELDS[p.action] : undefined;
  if (!fields) throw new Error('Unknown action');
  keys(p, ['action', ...fields.allowed], ['action', ...fields.required]); checkAbort(signal);
  if (p.action === 'preference') {
    if (p.cards !== 'never' && p.cards !== 'ask') throw new Error('Unknown preference');
    if (p.cards === 'ask' && (!ctx.hasUI || !await ctx.ui.confirm('Study Space', '重新允许为答错的点制卡？'))) throw new Error('Re-enabling cards needs the user to confirm');
    return store.mutate<Preferences>('preferences', () => ({ schemaVersion: 2, revision: 0, cards: p.cards as 'ask' | 'never' }), signal);
  }
  const preferences = await store.preferences();
  if (p.action === 'get') {
    if (activation.topic) activation.topic = await store.topic(activation.topic.topicId);
    return { mode: activation.mode, topic: activation.topic ?? null, cards: preferences.cards };
  }
  if (!activation.topic) throw new Error('No active topic: the user starts one with /learn <topic>');
  const next = await store.mutate<Topic>(activation.topic.topicId, current => {
    if (!current) throw new Error('Topic missing');
    if (p.action === 'plan') {
      // Re-planning keeps what was already learned; only the order and the not-yet-seen concepts change.
      const planned = (p.concepts as unknown[]).map(entry => {
        const c = object(entry); keys(c, ['name', 'wiki'], ['name']);
        const conceptName = text(c.name, 200);
        const known = current.concepts.find(existing => sameName(existing.name, conceptName));
        return known ?? { name: conceptName, status: 'planned', wiki: c.wiki === undefined ? null : text(c.wiki, 200), weak: [] } satisfies Concept;
      });
      const learned = current.concepts.filter(c => c.status !== 'planned' && !planned.some(other => sameName(other.name, c.name)));
      current.concepts = [...learned, ...planned];
    } else {
      const conceptName = text(p.name, 200);
      let target = current.concepts.find(c => sameName(c.name, conceptName));
      if (!target) { target = { name: conceptName, status: 'planned', wiki: null, weak: [] }; current.concepts.push(target); }
      if (p.status !== undefined) target.status = status(p.status);
      if (p.wiki !== undefined) target.wiki = text(p.wiki, 200);
      if (p.weak !== undefined) target.weak = weak(p.weak);
      if (target.status === 'done' && !target.wiki) throw new Error('Write the concept page with wiki_write first, then pass wiki = its title');
    }
    current.updatedAt = new Date().toISOString();
    return current;
  }, signal);
  activation.topic = next;
  return { topic: next, cards: preferences.cards };
}
