import type { SkillSummary } from '@piwin/contracts';
import { describe, expect, it } from 'vitest';
import { EMPTY_TRANSCRIPT, appendLocalUserMessage, applyAgentEvent } from './transcript-model.js';
import {
  DEFAULT_THINKING_VALUE,
  NO_SKILL_VALUE,
  describeThinkingLevel,
  findLastUserMessageId,
  parseThinkingLevel,
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

describe('findLastUserMessageId', () => {
  it('returns the latest user turn, ignoring assistant rows after it', () => {
    let state = appendLocalUserMessage(EMPTY_TRANSCRIPT, 'u1', 'first');
    state = appendLocalUserMessage(state, 'u2', 'second');
    state = applyAgentEvent(state, { type: 'message/start', messageId: 'a1', role: 'assistant' });
    expect(findLastUserMessageId(state)).toBe('u2');
    expect(findLastUserMessageId(EMPTY_TRANSCRIPT)).toBeUndefined();
  });
});
