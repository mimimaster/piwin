import type { SkillSummary, ThinkingLevel } from '@piwin/contracts';
import type { SelectItem } from '@earendil-works/pi-tui';
import type { TranscriptState } from './transcript-model.js';

/**
 * Composer choices the TUI offers beyond the model: thinking level, the skill
 * for the next turn, and which turn `/retry` re-runs. Pure — the app sends the
 * Host commands.
 */

const THINKING_LEVELS: ReadonlyArray<{ level: ThinkingLevel; label: string }> = [
  { level: 'off', label: '关闭' },
  { level: 'minimal', label: '最低' },
  { level: 'low', label: '低' },
  { level: 'medium', label: '中' },
  { level: 'high', label: '高' },
  { level: 'xhigh', label: '很高' },
  { level: 'max', label: '最高' },
  { level: 'ultra', label: 'Ultra' },
];

export const DEFAULT_THINKING_VALUE = 'default';

/** "Default" leaves the level to the model's configured profile. */
export function thinkingLevelItems(): SelectItem[] {
  return [
    { value: DEFAULT_THINKING_VALUE, label: '跟随模型默认' },
    ...THINKING_LEVELS.map(({ level, label }) => ({ value: level, label, description: level })),
  ];
}

export function parseThinkingLevel(value: string): ThinkingLevel | undefined {
  return THINKING_LEVELS.find(({ level }) => level === value)?.level;
}

export function describeThinkingLevel(level: ThinkingLevel | undefined): string | undefined {
  if (level === undefined) return undefined;
  return `思考 ${THINKING_LEVELS.find((entry) => entry.level === level)?.label ?? level}`;
}

export const NO_SKILL_VALUE = '';

/** Enabled, visible skills, plus a way to clear the selection. */
export function skillItems(skills: readonly SkillSummary[]): SelectItem[] {
  const usable = skills
    .filter((skill) => skill.enabled && skill.hidden !== true)
    .map((skill) => ({
      value: skill.id,
      label: skill.name,
      description: skill.description.replace(/\s+/g, ' ').trim(),
    }));
  return usable.length === 0 ? [] : [{ value: NO_SKILL_VALUE, label: '不使用技能' }, ...usable];
}

/** The latest user turn on screen: the one `/retry` re-runs. */
export function findLastUserMessageId(transcript: TranscriptState): string | undefined {
  for (let index = transcript.entries.length - 1; index >= 0; index -= 1) {
    const entry = transcript.entries[index];
    if (entry?.kind === 'message' && entry.role === 'user') return entry.id;
  }
  return undefined;
}
