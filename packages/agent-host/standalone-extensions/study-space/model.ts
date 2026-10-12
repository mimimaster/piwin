import { randomUUID } from 'node:crypto';

export type Role = 'learn' | 'ta' | 'review';
export type Card = { model: 'basic'; front: string; back: string } | { model: 'cloze'; text: string };
export type Evidence = {
  schemaVersion: 1; revision: number; id: string; prompt: string; userAnswer: string;
  assessment: string; nextPractice: string; gap: string | null;
};
export type Attempt = { id: string; toolCallId: string; state: 'pending' | 'unknown' | 'partial' | 'resolved'; cardIds: string[]; skipped: string[] };
export type Intention = { id: string; evidenceId: string; deck: string; cards: Card[]; attempts: Attempt[] };
export type Course = {
  schemaVersion: 1; revision: number; courseId: string; topic: string; deck: string;
  profile: string; path: string[]; evidence: Evidence[]; intentions: Intention[];
};
export type Preferences = { schemaVersion: 1; revision: number; cards: 'ask' | 'never' };
export type Document = Course | Preferences;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function id(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new Error('Invalid UUID');
  return value;
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected object');
  return value as Record<string, unknown>;
}
export function keys(value: Record<string, unknown>, allowed: string[], required = allowed): void {
  if (Object.keys(value).some(k => !allowed.includes(k)) || required.some(k => !(k in value))) {
    throw new Error('Unknown or missing fields');
  }
}
export function text(value: unknown, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim()) || value.length > 20000 || value.includes('\0')) {
    throw new Error('Invalid text');
  }
  return value;
}
export function revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error('Invalid revision');
  return value as number;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > 10000) throw new Error('Invalid array');
  return value;
}
export function parseCard(value: unknown): Card {
  const c = object(value);
  if (c.model === 'basic') { keys(c, ['model', 'front', 'back']); return { model: 'basic', front: text(c.front), back: text(c.back) }; }
  if (c.model === 'cloze') {
    keys(c, ['model', 'text']);
    const passage = text(c.text);
    if (!/\{\{c[1-9]\d*::[^{}]+\}\}/.test(passage)) throw new Error('Missing cloze marker');
    return { model: 'cloze', text: passage };
  }
  throw new Error('Unknown card model');
}
export function cards(value: unknown): Card[] {
  const result = array(value).map(parseCard);
  if (!result.length || result.length > 40 || new Set(result.map(cardKey)).size !== result.length) throw new Error('Invalid card batch');
  return result;
}
export function cardKey(c: Card): string { return JSON.stringify(c); }
export function evidence(value: unknown): Evidence {
  const e = object(value);
  keys(e, ['schemaVersion', 'revision', 'id', 'prompt', 'userAnswer', 'assessment', 'nextPractice', 'gap']);
  if (e.schemaVersion !== 1) throw new Error('Unknown evidence schemaVersion');
  return { schemaVersion: 1, revision: revision(e.revision), id: id(e.id), prompt: text(e.prompt),
    userAnswer: text(e.userAnswer), assessment: text(e.assessment), nextPractice: text(e.nextPractice),
    gap: e.gap === null ? null : text(e.gap) };
}
export function validate(value: unknown, key: string): Document {
  const d = object(value);
  if (d.schemaVersion !== 1) throw new Error('Unknown schemaVersion');
  revision(d.revision);
  if (key === 'preferences') {
    keys(d, ['schemaVersion', 'revision', 'cards']);
    if (d.cards !== 'ask' && d.cards !== 'never') throw new Error('Unknown preference');
    return d as Preferences;
  }
  id(key);
  keys(d, ['schemaVersion', 'revision', 'courseId', 'topic', 'deck', 'profile', 'path', 'evidence', 'intentions']);
  if (id(d.courseId) !== key || d.deck !== `study-space:${key}`) throw new Error('Course/deck mismatch');
  text(d.topic); text(d.profile, true); array(d.path).forEach(v => text(v));
  const ev = array(d.evidence).map(evidence);
  if (new Set(ev.map(e => e.id)).size !== ev.length) throw new Error('Duplicate evidence');
  const intentions = array(d.intentions).map(v => {
    const i = object(v);
    keys(i, ['id', 'evidenceId', 'deck', 'cards', 'attempts']);
    id(i.id); id(i.evidenceId);
    if (i.deck !== d.deck || !ev.some(e => e.id === i.evidenceId && e.gap !== null)) throw new Error('Intention needs recorded gap');
    cards(i.cards);
    array(i.attempts).forEach(v => {
      const a = object(v); keys(a, ['id', 'toolCallId', 'state', 'cardIds', 'skipped']);
      id(a.id); text(a.toolCallId);
      if (!['pending', 'unknown', 'partial', 'resolved'].includes(a.state as string)) throw new Error('Unknown outcome');
      array(a.cardIds).forEach(v => text(v)); array(a.skipped).forEach(v => text(v));
    });
    return i;
  });
  if (new Set(intentions.map(i => i.id)).size !== intentions.length) throw new Error('Duplicate intention');
  return d as Course;
}
export function newCourse(topic: string): Course {
  const courseId = randomUUID();
  return { schemaVersion: 1, revision: 0, courseId, topic: text(topic), deck: `study-space:${courseId}`,
    profile: '', path: [], evidence: [], intentions: [] };
}
export function unresolved(course: Course): boolean {
  return course.intentions.some(i => i.attempts.some(a => a.state !== 'resolved'));
}
