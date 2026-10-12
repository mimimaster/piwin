import type { PermissionPreset, PromptTemplateSummary, SkillSummary, ThinkingLevel } from '@piwin/contracts';
import type { SelectItem } from '@earendil-works/pi-tui';
import type { TranscriptState } from './transcript-model.js';
import { style } from './tui-style.js';

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
  { preset: 'yolo', label: 'YOLO', description: '放行：不询问，不设沙箱' },
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

/**
 * Always shown: which mode the next turn runs in is never left implicit. The
 * footer keeps it short (`询问` / `自动` / `YOLO`); following the Host shows the
 * Host's mode plainly. YOLO is coloured so running without guard rails stands out.
 */
export function describePermissionPreset(
  chosen: PermissionPreset | undefined,
  hostDefault: PermissionPreset | undefined,
): string | undefined {
  const preset = chosen ?? hostDefault;
  if (preset === undefined) return undefined;
  const label = PERMISSION_PRESETS.find((entry) => entry.preset === preset)?.label ?? preset;
  return preset === 'yolo' ? style.bold(style.yellow(label)) : label;
}

/** Orchestration scheme the picker offers; `off` is freehand. */
export type SchemeChoice = { id: string; name: string; description?: string };

export const SCHEME_OFF_VALUE = 'off';
export const NO_DELEGATION_VALUE = '__no-delegation__';

/** 自由, then the Host's schemes (builtin and user), then a way to turn subagents off. */
export function schemeItems(schemes: readonly SchemeChoice[]): SelectItem[] {
  return [
    { value: SCHEME_OFF_VALUE, label: '自由', description: '不注入编排规则，模型按需使用子代理' },
    ...schemes
      .filter((scheme) => scheme.id !== SCHEME_OFF_VALUE)
      .map((scheme) => ({
        value: scheme.id,
        label: scheme.name,
        ...(scheme.description ? { description: scheme.description.replace(/\s+/g, ' ').trim() } : {}),
      })),
    { value: NO_DELEGATION_VALUE, label: '不使用子代理', description: '这个会话的消息不让模型委派子代理' },
  ];
}

/** Badge / footer name of an active scheme; undefined when freehand. */
export function activeSchemeName(schemeId: string, schemes: readonly SchemeChoice[]): string | undefined {
  if (schemeId === SCHEME_OFF_VALUE || schemeId === '') return undefined;
  return schemes.find((scheme) => scheme.id === schemeId)?.name ?? schemeId;
}

/** Footer segment: `编排 <name>`, or `子代理 关` when delegation is disabled. */
export function describeScheme(schemeName: string | undefined, delegationDisabled: boolean): string | undefined {
  if (delegationDisabled) return '子代理 关';
  return schemeName === undefined ? undefined : `编排 ${schemeName}`;
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

/** The latest user turn on screen: the one `/retry` re-runs and `/edit` rewrites. */
export function findLastUserMessage(transcript: TranscriptState): { id: string; text: string } | undefined {
  for (let index = transcript.entries.length - 1; index >= 0; index -= 1) {
    const entry = transcript.entries[index];
    if (entry?.kind === 'message' && entry.role === 'user') return { id: entry.id, text: entry.text };
  }
  return undefined;
}

export function findLastUserMessageId(transcript: TranscriptState): string | undefined {
  return findLastUserMessage(transcript)?.id;
}
