/**
 * Detect active slash tokens and parse whole-message slash submits.
 */
import type { AgentModeId } from '../agent-mode';
import type { ActiveSlashToken, ParsedSlashSubmit } from './slash-types';

/** Max length for compact customInstructions (plan: 2KB). */
export const COMPACT_CUSTOM_INSTRUCTIONS_MAX_CHARS = 2048;

const COMMAND_ALIASES: Record<string, 'compact' | 'stop'> = {
  compact: 'compact',
  summarize: 'compact',
  compress: 'compact',
  stop: 'stop',
  abort: 'stop',
};

const MODE_NAMES: ReadonlySet<string> = new Set(['agent', 'plan', 'ask']);

/**
 * Slash aliases that resolve to a bundled skill id. The alias is the slash
 * name without the leading `/`. Each value is the canonical skill id (and
 * name) the alias should behave like. This keeps a single canonical skill
 * asset while exposing friendlier trigger names.
 */
const SKILL_ALIASES: Record<string, string> = {
  'write-plan': 'writing-plans',
};

/**
 * Find the slash token under the caret.
 * Token runs from the last whitespace (or start) if it begins with `/`.
 */
export function detectActiveSlashToken(text: string, caretIndex: number): ActiveSlashToken | null {
  const safeCaret = Math.max(0, Math.min(caretIndex, text.length));
  let startIndex = safeCaret;
  while (startIndex > 0) {
    const previous = text[startIndex - 1];
    if (previous === undefined || /\s/.test(previous)) {
      break;
    }
    startIndex -= 1;
  }
  if (text[startIndex] !== '/') {
    return null;
  }
  // Token end: whitespace or end of string after caret region — use caret as end
  // so partial typing still matches while user is inside the token.
  let endIndex = startIndex + 1;
  while (endIndex < text.length) {
    const character = text[endIndex];
    if (character === undefined || /\s/.test(character)) {
      break;
    }
    endIndex += 1;
  }
  // Only active while caret is inside [start, end] (inclusive end for trailing edge).
  if (safeCaret < startIndex || safeCaret > endIndex) {
    return null;
  }
  const raw = text.slice(startIndex, endIndex);
  const query = raw.slice(1);
  return { raw, query, startIndex, endIndex };
}

/**
 * Replace the active slash token with `replacement` (e.g. "/compact " or "").
 */
export function replaceActiveSlashToken(
  text: string,
  token: ActiveSlashToken,
  replacement: string,
): string {
  return text.slice(0, token.startIndex) + replacement + text.slice(token.endIndex);
}

export type SkillLookupEntry = {
  id: string;
  name: string;
  enabled: boolean;
};

/**
 * Parse a whole-message slash command for send intercept.
 * Returns `none` when the message is not a single leading slash token (+ optional args).
 */
export function parseComposerSlashSubmit(
  trimmedText: string,
  skills: SkillLookupEntry[],
): ParsedSlashSubmit {
  if (!trimmedText.startsWith('/')) {
    return { kind: 'none' };
  }
  const match = /^\/(\S+)(?:\s+(.*))?$/s.exec(trimmedText);
  if (!match) {
    return { kind: 'none' };
  }
  const name = (match[1] ?? '').toLowerCase();
  const args = (match[2] ?? '').trim();
  if (!name) {
    return { kind: 'none' };
  }

  const commandId = COMMAND_ALIASES[name];
  if (commandId) {
    return { kind: 'command', commandId, name, args };
  }

  if (MODE_NAMES.has(name)) {
    return {
      kind: 'mode',
      modeId: name as AgentModeId,
      name,
      args,
    };
  }

  // ORCH: /scheme [id] or /ultra-code — set per-send scheme only (no chat bubble).
  if (name === 'scheme') {
    const schemeId = (args.split(/\s+/)[0] ?? 'off').trim().toLowerCase() || 'off';
    const remainingArgs = schemeId === 'off' ? '' : args.slice(schemeId.length).trim();
    return { kind: 'scheme', schemeId, name, args: remainingArgs };
  }
  if (name === 'ultra-code') {
    return { kind: 'scheme', schemeId: 'ultra-code', name, args };
  }

  const skillByName = skills.find(
    (skill) => skill.name.toLowerCase() === name || skill.id.toLowerCase() === name,
  );
  if (skillByName) {
    return {
      kind: 'skill',
      skillId: skillByName.id,
      skillName: skillByName.name,
      args,
    };
  }

  // Alias resolution: `/write-plan` → canonical `writing-plans` skill.
  const aliasTarget = SKILL_ALIASES[name];
  if (aliasTarget) {
    const aliasedSkill = skills.find(
      (skill) => skill.id.toLowerCase() === aliasTarget || skill.name.toLowerCase() === aliasTarget,
    );
    if (aliasedSkill) {
      return {
        kind: 'skill',
        skillId: aliasedSkill.id,
        skillName: aliasedSkill.name,
        args,
      };
    }
  }

  return { kind: 'unknown', name, args };
}

/**
 * Cap and sanitize compact customInstructions.
 */
export function normalizeCompactCustomInstructions(args: string): string | undefined {
  const trimmed = args.trim().replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.length <= COMPACT_CUSTOM_INSTRUCTIONS_MAX_CHARS) {
    return trimmed;
  }
  return trimmed.slice(0, COMPACT_CUSTOM_INSTRUCTIONS_MAX_CHARS);
}

/**
 * Host-facing skill prompt rewrite (transcript keeps user-visible `/name`).
 */
export function applySkillToPrompt(skillName: string, skillId: string, args: string): string {
  const userPart = args.trim();
  const body = userPart.length > 0 ? userPart : '(no additional user request)';
  return [
    `[piwin-skill:${skillName}]`,
    `Follow the installed skill "${skillName}" (id: ${skillId}). Apply its workflow to the user request below.`,
    '---',
    body,
  ].join('\n');
}
