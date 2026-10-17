import { describe, expect, it } from 'vitest';
import type { ChatMessageUi } from './chat-ui-types';
import { USER_PROMPT_PIN_MAX_CHARS, userPromptPinText } from './pinned-user-prompt';

function user(text: string): ChatMessageUi {
  return { id: text, role: 'user', text, thinking: '', tools: [], attachments: [], status: 'done' };
}

describe('userPromptPinText', () => {
  it('collapses the first non-empty prompt to one line', () => {
    expect(userPromptPinText([user('  '), user('一起\n\n修吧  ')])).toBe('一起 修吧');
  });

  it('caps long prompts and leaves image-only prompts empty', () => {
    expect(userPromptPinText([user('x'.repeat(1000))])).toHaveLength(USER_PROMPT_PIN_MAX_CHARS);
    expect(userPromptPinText([user('')])).toBe('');
  });
});
