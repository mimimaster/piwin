import type { PermissionPreset, PromptTemplateSummary, SkillSummary, ThinkingLevel } from '@piwin/contracts';
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

/** Run Mode (ADR 0024) in the order Shift+Tab walks it: most cautious first. */
const PERMISSION_PRESETS: ReadonlyArray<{ preset: PermissionPreset; label: string; description: string }> = [
  { preset: 'ask', label: '询问', description: '几乎每个操作都先问' },
  { preset: 'auto', label: '自动', description: '沙箱内直接做，越界才问' },
  { preset: 'yolo', label: '放行', description: '不询问，不设沙箱' },
];

export const HOST_PERMISSION_VALUE = 'host';

/** "Follow Host" sends no preset, so the Host's own configuration applies. */
export function permissionPresetItems(hostDefault: PermissionPreset | undefined): SelectItem[] {
  const hostLabel = PERMISSION_PRESETS.find((entry) => entry.preset === hostDefault)?.label;
  return [
    {
      value: HOST_PERMISSION_VALUE,
      label: '跟随 Host 设置',
      ...(hostLabel === undefined ? {} : { description: `当前为「${hostLabel}」` }),
    },
    ...PERMISSION_PRESETS.map(({ preset, label, description }) => ({ value: preset, label, description })),
  ];
}

export function parsePermissionPreset(value: string): PermissionPreset | undefined {
  return PERMISSION_PRESETS.find(({ preset }) => preset === value)?.preset;
}

/** Shift+Tab: Host default → ask → auto → yolo → Host default. */
export function nextPermissionPreset(current: PermissionPreset | undefined): PermissionPreset | undefined {
  if (current === undefined) return PERMISSION_PRESETS[0]?.preset;
  const index = PERMISSION_PRESETS.findIndex(({ preset }) => preset === current);
  return PERMISSION_PRESETS[index + 1]?.preset;
}

/** Always shown: which mode the next turn runs in is never left implicit. */
export function describePermissionPreset(
  chosen: PermissionPreset | undefined,
  hostDefault: PermissionPreset | undefined,
): string | undefined {
  const label = (preset: PermissionPreset | undefined): string | undefined =>
    PERMISSION_PRESETS.find((entry) => entry.preset === preset)?.label;
  if (chosen !== undefined) return `权限 ${label(chosen) ?? chosen}`;
  const hostLabel = label(hostDefault);
  return hostLabel === undefined ? undefined : `权限 ${hostLabel}（Host）`;
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

/**
 * Prompt templates as slash commands. The Host's agent expands `/name args`
 * itself, so the TUI only has to offer the names; one that collides with a
 * TUI command is left out, because the TUI would intercept it.
 */
export function promptTemplateCommands(
  templates: readonly PromptTemplateSummary[],
  reservedNames: ReadonlySet<string>,
): Array<{ name: string; description: string }> {
  return templates
    .filter((template) => template.enabled && /^[\w.-]+$/.test(template.name) && !reservedNames.has(template.name))
    .map((template) => ({
      name: template.name,
      description: `模板 · ${template.description.replace(/\s+/g, ' ').trim()}`,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

/** The latest user turn on screen: the one `/retry` re-runs. */
export function findLastUserMessageId(transcript: TranscriptState): string | undefined {
  for (let index = transcript.entries.length - 1; index >= 0; index -= 1) {
    const entry = transcript.entries[index];
    if (entry?.kind === 'message' && entry.role === 'user') return entry.id;
  }
  return undefined;
}
