import { randomUUID } from 'node:crypto';
import { Type } from 'typebox';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { cards, evidence, id, keys, object, revision, text, type Course, type Preferences } from './model.js';
import { Store, checkAbort } from './store.js';
import type { Active } from './native.js';

const string = Type.String({ minLength: 1, maxLength: 20000 });
const expectedRevision = Type.Integer({ minimum: -1 });
const strict = <T extends Parameters<typeof Type.Object>[0]>(properties: T) => Type.Object(properties, { additionalProperties: false });
const action = (name: string) => Type.Literal(name);
const cardSchema = Type.Union([
  Type.Object({ model: Type.Literal('basic'), front: string, back: string }, { additionalProperties: false }),
  Type.Object({ model: Type.Literal('cloze'), text: string }, { additionalProperties: false }),
]);
export const PARAMETERS = Type.Union([
  strict({ action: action('status') }), strict({ action: action('list') }), strict({ action: action('get') }),
  strict({ action: action('preference'), expectedRevision, cards: Type.Union([Type.Literal('never'), Type.Literal('ask')]) }),
  strict({ action: action('rename'), expectedRevision, topic: string }),
  strict({ action: action('profile'), expectedRevision, profile: string, path: Type.Array(string, { maxItems: 100 }) }),
  strict({ action: action('evidence'), expectedRevision, prompt: string, userAnswer: string, assessment: string, nextPractice: string, gap: Type.Union([string, Type.Null()]) }),
  strict({ action: action('intention'), expectedRevision, evidenceId: string, cards: Type.Array(cardSchema, { minItems: 1, maxItems: 40 }) }),
]);

/** Local course facts cannot activate a role, authorize a native action, select a deck or supply a path. */
export async function localAction(store: Store, activation: Active, raw: unknown, ctx: ExtensionContext, signal?: AbortSignal): Promise<unknown> {
  const p = object(raw);
  const fields: Record<string, string[]> = {
    status: [], list: [], get: [], preference: ['expectedRevision', 'cards'], rename: ['expectedRevision', 'topic'],
    profile: ['expectedRevision', 'profile', 'path'],
    evidence: ['expectedRevision', 'prompt', 'userAnswer', 'assessment', 'nextPractice', 'gap'],
    intention: ['expectedRevision', 'evidenceId', 'cards'],
  };
  if (typeof p.action !== 'string' || !Object.hasOwn(fields, p.action)) throw new Error('Unknown local action');
  const actionFields = fields[p.action];
  if (!actionFields) throw new Error('Unknown local action');
  keys(p, ['action', ...actionFields]); checkAbort(signal);
  if (p.action === 'status') return { role: activation.role, course: activation.course?.courseId ?? null, preferences: await store.preferences(),
    preferenceStorageRevision: (await store.read('preferences'))?.revision ?? -1,
    nativeRouting: 'Direct if exposed; otherwise piwin_toolbox search(query="flashcard"), then describe/call exact discovered targets. Only report unavailable after discovery. No native action has been executed by this extension.' };
  if (p.action === 'list') return store.list();
  if (p.action === 'get') {
    if (!activation.course) throw new Error('No active course; use explicit learn/resume');
    activation.course = await store.course(activation.course.courseId); return activation.course;
  }
  const expected = p.expectedRevision === -1 ? -1 : revision(p.expectedRevision);
  if (p.action === 'preference') {
    if (p.cards !== 'never' && p.cards !== 'ask') throw new Error('Unknown preference');
    if (p.cards === 'ask' && (!ctx.hasUI || !await ctx.ui.confirm('Study Space card preference', 'Allow asking for native card consent again? No cards will be created by this preference.'))) throw new Error('Preference re-enable requires user confirmation');
    return store.update<Preferences>('preferences', expected, () => ({ schemaVersion: 1, revision: 0, cards: p.cards as 'ask' | 'never' }), signal);
  }
  if (!activation.course) throw new Error('No active course; use explicit learn/resume');
  if (p.action === 'intention' && (await store.preferences()).cards === 'never') throw new Error('Persistent preference: do not make cards');
  const next = await store.update<Course>(activation.course.courseId, expected, current => {
    if (!current) throw new Error('Course missing');
    switch (p.action) {
      case 'rename': current.topic = text(p.topic); break;
      case 'profile':
        current.profile = text(p.profile);
        if (!Array.isArray(p.path) || p.path.length > 100) throw new Error('Invalid staged path');
        current.path = p.path.map(v => text(v)); break;
      case 'evidence':
        current.evidence.push(evidence({ schemaVersion: 1, revision: 0, id: randomUUID(), prompt: p.prompt,
          userAnswer: p.userAnswer, assessment: p.assessment, nextPractice: p.nextPractice, gap: p.gap })); break;
      case 'intention': {
        if (!current.evidence.some(e => e.id === id(p.evidenceId) && e.gap !== null)) throw new Error('Intention requires a concrete demonstrated gap');
        current.intentions.push({ id: randomUUID(), evidenceId: id(p.evidenceId), deck: current.deck, cards: cards(p.cards), attempts: [] }); break;
      }
      default: throw new Error('Unknown local action');
    }
    return current;
  }, signal);
  activation.course = next;
  return next;
}
