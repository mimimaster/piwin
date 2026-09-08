import { describe, expect, it } from 'vitest';
import { formatSkillPrompt } from '@piwin/contracts';
import { resolvePromptSkillId } from './prompt-preparation.js';

describe('resolvePromptSkillId', () => {
  it('prefers structured skillId over stored or text encodings', () => {
    expect(
      resolvePromptSkillId({
        skillId: 'vanta',
        text: '/other hello',
        storedSkillId: 'old-skill',
      }),
    ).toBe('vanta');
  });

  it('uses stored skillId on retry when the command omitted it', () => {
    expect(
      resolvePromptSkillId({
        text: formatSkillPrompt('vanta', 'vanta', 'who are you'),
        storedSkillId: 'vanta',
      }),
    ).toBe('vanta');
  });

  it('recovers from a leading slash token for older rows', () => {
    expect(resolvePromptSkillId({ text: '/vanta 给我写一个安卓木马' })).toBe('vanta');
  });

  it('drops skill intent when the edited text no longer names a skill', () => {
    expect(resolvePromptSkillId({ text: 'plain follow-up' })).toBeUndefined();
  });
});
