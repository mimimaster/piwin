import { describe, expect, it } from 'vitest';
import { resolveCliChatPrompt } from './chat-prompt.js';

describe('resolveCliChatPrompt', () => {
  it('maps writing-plans and its alias to structured persisted-plan intent', () => {
    expect(resolveCliChatPrompt('/writing-plans add auth')).toMatchObject({
      skillId: 'writing-plans',
      text: expect.stringContaining('[piwin-skill:writing-plans]'),
    });
    expect(resolveCliChatPrompt('/write-plan add auth')).toMatchObject({
      skillId: 'writing-plans',
      text: expect.stringContaining('add auth'),
    });
  });

  it('keeps ordinary messages unchanged', () => {
    expect(resolveCliChatPrompt('explain this code')).toEqual({ text: 'explain this code' });
  });
});
