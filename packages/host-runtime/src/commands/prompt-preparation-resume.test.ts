import { describe, expect, it } from 'vitest';
import {
  RESUME_CONTINUATION_PROMPT,
  resolveResumePromptText,
} from './prompt-preparation.js';

describe('resolveResumePromptText', () => {
  it('uses the default continuation for empty or continue-only text', () => {
    expect(resolveResumePromptText(undefined)).toBe(RESUME_CONTINUATION_PROMPT);
    expect(resolveResumePromptText('继续')).toBe(RESUME_CONTINUATION_PROMPT);
    expect(resolveResumePromptText('continue')).toBe(RESUME_CONTINUATION_PROMPT);
  });

  it('keeps extra instruction on the continuation', () => {
    const resolved = resolveResumePromptText('先把文件树那个空状态做完');
    expect(resolved.startsWith(RESUME_CONTINUATION_PROMPT)).toBe(true);
    expect(resolved).toContain('先把文件树那个空状态做完');
  });
});
