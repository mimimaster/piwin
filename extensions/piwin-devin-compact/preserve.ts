import { DEVIN_EDITED_FILES_HEADER, DEVIN_EDITED_FILE_LINE_PREFIX } from './prompt.js';
import { asArray, asLoose, asString } from './values.js';

/**
 * Devin appends edited paths to the replacement message with this exact
 * wording (verified against a real `history_*.md` run). It is advisory: the
 * model is told some edits may have gone through a shell script.
 */
export function renderEditedFilesBlock(paths: readonly string[]): string {
  if (paths.length === 0) return '';
  const lines = paths.map((path) => `${DEVIN_EDITED_FILE_LINE_PREFIX}${path}\n`);
  return `${DEVIN_EDITED_FILES_HEADER}${lines.join('')}`;
}

const TODO_MARKER = 'Current todo list:';

/**
 * Devin keeps the todo node verbatim (`compact/todo_list` extension key) instead
 * of summarizing it. Pi compaction only accepts one summary string, so the todo
 * block is inlined ahead of the replacement message.
 */
export function findTodoBlock(messages: readonly unknown[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const text = messageText(messages[index]);
    if (text && text.includes(TODO_MARKER)) return text.trim();
  }
  return undefined;
}

const SKILL_OPEN = '<skill name="';

/** Devin preserves `agent-ext/skills-loaded` messages verbatim for the same reason. */
export function findSkillBlocks(messages: readonly unknown[]): string[] {
  const latest = new Map<string, string>();
  for (const message of messages) {
    const text = messageText(message);
    if (!text) continue;
    const at = text.indexOf(SKILL_OPEN);
    if (at < 0) continue;
    const nameEnd = text.indexOf('"', at + SKILL_OPEN.length);
    const name = nameEnd > 0 ? text.slice(at + SKILL_OPEN.length, nameEnd) : text.slice(at, at + 40);
    latest.set(name, text.trim());
  }
  return [...latest.values()];
}

function messageText(message: unknown): string | undefined {
  const loose = asLoose(message);
  const content = loose?.content;
  if (typeof content === 'string') return content;
  const parts: string[] = [];
  for (const block of asArray(content)) {
    const inner = asLoose(block);
    if (asString(inner?.type) !== 'text') continue;
    const text = asString(inner?.text);
    if (text !== undefined) parts.push(text);
  }
  const joined = parts.join('\n');
  return joined.length > 0 ? joined : undefined;
}
