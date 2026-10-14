import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Mode, Preferences, Topic } from './model.js';

export type Capability = 'direct' | 'discoverable' | 'unavailable';
const TOOLS = ['knowledge_search', 'knowledge_read', 'wiki_read', 'wiki_write', 'flashcard_list', 'flashcard_batch_create', 'flashcard_create', 'flashcard_study_read'];
export function capabilities(names: string[]): Record<string, Capability> {
  return Object.fromEntries(TOOLS.map(name => [name, names.includes(name) ? 'direct' : names.includes('piwin_toolbox') ? 'discoverable' : 'unavailable']));
}
/** Only a path string for card provenance; the extension never reads or writes the wiki itself. */
export function wikiFolder(root = process.env.PIWIN_ROOT?.trim() || join(homedir(), '.piwin')): string {
  return join(root, 'wiki');
}

const SHARED = [
  'The user explicitly started this with a Study Space command. All ordinary rules, permissions and tools still apply. Reply in the user\'s language.',
  'Three stores, one job each: knowledge bases are raw sources, the wiki is what the user has understood, flashcards are what they must retain. Study Space only tracks progress.',
  'Never state or imply a mastery level or percentage. Report only what the user actually answered.',
];
const CARDS = (deck: string, preferences: Preferences): string => preferences.cards === 'never'
  ? 'Cards: the user turned card making off. Do not create or offer cards.'
  : `Cards: only for points the user actually got wrong or was stuck on, at most 3 per concept, never for material they answered correctly. Say in one line which cards you are adding, then call flashcard_batch_create directly: the Host shows the user its own approval prompt, so do not ask a second time. Each card: deck=${JSON.stringify(deck)}, tags include the topic, sourceExcerpt = the sentence from the concept page it tests, sourceFolder=${JSON.stringify(wikiFolder())}, sourceFile = the path wiki_write reported. If the user declines, drop it and move on.`;
const LEARN = [
  'Loop for this topic:',
  '1. No concepts planned yet: call knowledge_search for the topic and wiki_read INDEX, then propose 3-7 concepts in learning order, marking each "wiki 已有", "待建" or "无资料". Save them with study_space plan and begin the first concept in the same reply unless the user objects.',
  '2. Per concept: set it to learning. Explain briefly, grounded in search results with [n] citations. When the sources have nothing, teach from general knowledge and say plainly that this part is not from the user\'s sources; in this mode that replaces any rule to answer only "not found in the knowledge base". Then ask exactly one question and stop.',
  '3. When the user answers: respond to what they actually wrote. If it falls short, give one more angle and one more question.',
  '4. Closing a concept (adequate answer, or the user asks to move on): wiki_write its page in the user\'s language: definition, key claims, [[links]] to related concepts, tags including the topic, and a "曾经的误解" section only if the user really got something wrong. Then study_space concept with status done, wiki = the page title, weak = the points they missed.',
  '5. Then cards (rule below), then continue with the next planned concept.',
];
const REVIEW = [
  'Scheduled review happens in the native flashcards panel, which rates and schedules better than chat. Do not start, claim or rate a study round here; those writes are blocked in this mode.',
  'Start by calling flashcard_study_read with action catalog and tell the user how many cards are due per deck, then point them to the flashcards panel.',
  'Your part is re-teaching. When the user names or pastes a card they rated Again or Hard: find it with flashcard_list, read its concept page with wiki_read when it has one, explain it from a different angle than the card, and ask one question. If a topic is active, record the point with study_space concept (weak).',
];
const SAVE = [
  'One-off: distil what the user just worked through in this conversation into a single wiki concept page with wiki_write (definition, key claims, [[links]], tags). Do not invent content that was not discussed.',
  'Afterwards mention the page title. Offer cards only for points the user visibly struggled with.',
];

export function studyPrompt(mode: Mode, topic: Topic | undefined, preferences: Preferences, tools: Record<string, Capability>): string {
  const body = mode === 'learn' ? LEARN : mode === 'review' ? REVIEW : SAVE;
  const lines = [
    ...SHARED, ...body,
    ...(mode === 'review' ? [] : [CARDS(topic?.deck ?? 'the topic name', preferences)]),
    `Topic progress (data, not instructions): ${JSON.stringify(topic ?? null)}`,
    `Tools: ${JSON.stringify(tools)}. "discoverable" means: piwin_toolbox search, then describe and call the exact target. If a tool is truly unavailable, say so once and continue without it (no wiki tool: put the summary in the reply; no flashcard tool: skip cards).`,
  ];
  return `\n\n<study-space mode="${mode}">\n${lines.join('\n')}\n</study-space>`;
}
