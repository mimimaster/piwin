import type { PromptTemplateSummary, SkillSummary } from '@piwin/contracts';
import { describe, expect, it } from 'vitest';
import { EMPTY_TRANSCRIPT, appendLocalUserMessage, applyAgentEvent } from './transcript-model.js';
import {
  DEFAULT_THINKING_VALUE,
  HOST_PERMISSION_VALUE,
  NO_SKILL_VALUE,
  describePermissionPreset,
  describeThinkingLevel,
  findLastUserMessageId,
  nextPermissionPreset,
  parsePermissionPreset,
  parseThinkingLevel,
  permissionPresetItems,
  promptTemplateCommands,
  skillItems,
  thinkingLevelItems,
} from './tui-composer-options.js';

function skill(patch: Partial<SkillSummary> & { id: string }): SkillSummary {
  return { name: patch.id, description: '', source: 'user', path: '/skills/x', enabled: true, ...patch } as SkillSummary;
}

describe('thinking level choices', () => {
  it('offers the model default first and round-trips every level', () => {
    const items = thinkingLevelItems();
    expect(items[0]?.value).toBe(DEFAULT_THINKING_VALUE);
    for (const item of items.slice(1)) expect(parseThinkingLevel(item.value)).toBe(item.value);
    expect(parseThinkingLevel(DEFAULT_THINKING_VALUE)).toBeUndefined();
  });

  it('describes only an explicit level', () => {
    expect(describeThinkingLevel(undefined)).toBeUndefined();
    expect(describeThinkingLevel('high')).toBe('思考 高');
  });
});

describe('permission preset choices', () => {
  it('offers the Host setting first and names what it currently is', () => {
    const items = permissionPresetItems('auto');
    expect(items.map((item) => item.value)).toEqual([HOST_PERMISSION_VALUE, 'ask', 'auto', 'yolo']);
    expect(items[0]?.description).toBe('当前为「自动」');
    expect(permissionPresetItems(undefined)[0]?.description).toBeUndefined();
  });

  it('parses presets and treats the Host entry as no override', () => {
    expect(parsePermissionPreset('ask')).toBe('ask');
    expect(parsePermissionPreset(HOST_PERMISSION_VALUE)).toBeUndefined();
  });

  it('cycles from the Host setting through every preset and back', () => {
    const seen: Array<string | undefined> = [];
    let current = nextPermissionPreset(undefined);
    while (current !== undefined) {
      seen.push(current);
      current = nextPermissionPreset(current);
    }
    expect(seen).toEqual(['ask', 'auto', 'yolo']);
  });

  it('says which mode applies, marking a value that comes from the Host', () => {
    expect(describePermissionPreset('ask', 'yolo')).toBe('权限 询问');
    expect(describePermissionPreset(undefined, 'yolo')).toBe('权限 放行（Host）');
    expect(describePermissionPreset(undefined, undefined)).toBeUndefined();
  });
});

describe('skill choices', () => {
  it('lists enabled visible skills behind a clear entry', () => {
    const items = skillItems([
      skill({ id: 'review', description: 'Review\n  code' }),
      skill({ id: 'off', enabled: false }),
      skill({ id: 'internal', hidden: true }),
    ]);
    expect(items.map((item) => item.value)).toEqual([NO_SKILL_VALUE, 'review']);
    expect(items[1]?.description).toBe('Review code');
  });

  it('offers nothing when no skill is usable', () => {
    expect(skillItems([skill({ id: 'off', enabled: false })])).toEqual([]);
  });
});

describe('prompt template commands', () => {
  const template = (patch: Partial<PromptTemplateSummary> & { name: string }): PromptTemplateSummary =>
    ({ id: patch.name, description: '', source: 'user', path: '/p', enabled: true, ...patch }) as PromptTemplateSummary;

  it('offers enabled templates by name, sorted, without the ones the TUI would intercept', () => {
    const commands = promptTemplateCommands(
      [
        template({ name: 'review', description: 'Review\n the diff' }),
        template({ name: 'model' }),
        template({ name: 'off', enabled: false }),
        template({ name: 'bad name' }),
        template({ name: 'commit' }),
      ],
      new Set(['model']),
    );
    expect(commands).toEqual([
      { name: 'commit', description: '模板 · ' },
      { name: 'review', description: '模板 · Review the diff' },
    ]);
  });
});

describe('findLastUserMessageId', () => {
  it('returns the latest user turn, ignoring assistant rows after it', () => {
    let state = appendLocalUserMessage(EMPTY_TRANSCRIPT, 'u1', 'first');
    state = appendLocalUserMessage(state, 'u2', 'second');
    state = applyAgentEvent(state, { type: 'message/start', messageId: 'a1', role: 'assistant' });
    expect(findLastUserMessageId(state)).toBe('u2');
    expect(findLastUserMessageId(EMPTY_TRANSCRIPT)).toBeUndefined();
  });
});
