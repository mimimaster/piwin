import { randomUUID } from 'node:crypto';

export type Mode = 'learn' | 'review' | 'save';
export type ConceptStatus = 'planned' | 'learning' | 'done';
/** One wiki concept on a topic's path. `wiki` is the concept page title once written; `weak` are points the user actually got wrong. */
export type Concept = { name: string; status: ConceptStatus; wiki: string | null; weak: string[] };
/** Thin progress only: what was understood lives in the wiki, what must be retained lives in native cards. */
export type Topic = {
  schemaVersion: 2; revision: number; topicId: string; topic: string; deck: string;
  concepts: Concept[]; updatedAt: string;
};
export type Preferences = { schemaVersion: 2; revision: number; cards: 'ask' | 'never' };
export type Document = Topic | Preferences;

export const STATUSES: ConceptStatus[] = ['planned', 'learning', 'done'];
export const MAX_CONCEPTS = 30;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** A 0.1.x course file: left untouched on disk and skipped, never migrated or reset. */
export class LegacyDocumentError extends Error { override readonly name = 'LegacyDocumentError'; }

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
export function text(value: unknown, max = 2000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0')) throw new Error('Invalid text');
  return value.trim();
}
function list(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error('Invalid array');
  return value;
}
export function status(value: unknown): ConceptStatus {
  if (!STATUSES.includes(value as ConceptStatus)) throw new Error('Unknown concept status');
  return value as ConceptStatus;
}
export function weak(value: unknown): string[] {
  return list(value, 20).map(point => text(point, 500));
}
export function concept(value: unknown): Concept {
  const c = object(value);
  keys(c, ['name', 'status', 'wiki', 'weak']);
  return { name: text(c.name, 200), status: status(c.status), wiki: c.wiki === null ? null : text(c.wiki, 200), weak: weak(c.weak) };
}
export function sameName(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}
export function validate(value: unknown, key: string): Document {
  const d = object(value);
  if (d.schemaVersion === 1) throw new LegacyDocumentError('Study Space 0.1 document');
  if (d.schemaVersion !== 2) throw new Error('Unknown schemaVersion');
  if (!Number.isSafeInteger(d.revision) || (d.revision as number) < 0) throw new Error('Invalid revision');
  if (key === 'preferences') {
    keys(d, ['schemaVersion', 'revision', 'cards']);
    if (d.cards !== 'ask' && d.cards !== 'never') throw new Error('Unknown preference');
    return d as Preferences;
  }
  keys(d, ['schemaVersion', 'revision', 'topicId', 'topic', 'deck', 'concepts', 'updatedAt']);
  if (id(d.topicId) !== key) throw new Error('Topic id mismatch');
  text(d.topic, 200); text(d.deck, 200); text(d.updatedAt, 40);
  const concepts = list(d.concepts, MAX_CONCEPTS).map(concept);
  if (concepts.some((c, index) => concepts.findIndex(other => sameName(other.name, c.name)) !== index)) throw new Error('Duplicate concept');
  return d as Topic;
}
/** The deck is the topic name: readable in the native card library, not an internal id. */
export function newTopic(name: string): Topic {
  const topic = text(name, 200);
  return { schemaVersion: 2, revision: 0, topicId: randomUUID(), topic, deck: topic, concepts: [], updatedAt: new Date().toISOString() };
}
