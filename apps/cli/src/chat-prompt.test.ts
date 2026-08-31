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

  it('maps optimize-prompt and its aliases to structured optimize-prompt skill intent', () => {
    expect(resolveCliChatPrompt('/optimize-prompt refine my tool')).toMatchObject({
      skillId: 'optimize-prompt',
      text: expect.stringContaining('[piwin-skill:optimize-prompt]'),
    });
    expect(resolveCliChatPrompt('/prompt-optimize refine my tool')).toMatchObject({
      skillId: 'optimize-prompt',
      text: expect.stringContaining('refine my tool'),
    });
  });

  it('keeps ordinary messages unchanged', () => {
    expect(resolveCliChatPrompt('explain this code')).toEqual({ text: 'explain this code' });
  });
});
