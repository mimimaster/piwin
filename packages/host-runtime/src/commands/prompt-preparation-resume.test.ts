import { describe, expect, it } from 'vitest';
import {
  RESUME_CONTINUATION_PROMPT,
  TURN_CONTINUATION_PROMPT,
  resolveResumePromptText,
  shouldPreserveSessionPermissionOverride,
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

describe('resolveResumePromptText with interrupted subagents', () => {
  it('points the model at the retained child runs before the user instruction', () => {
    const resolved = resolveResumePromptText('继续', ['batch-a', 'batch-b']);
    expect(resolved.startsWith(RESUME_CONTINUATION_PROMPT)).toBe(true);
    expect(resolved).toContain('batch-a, batch-b');
    expect(resolved).toContain('piwin_subagent_wait');
    expect(resolveResumePromptText('只做 A', ['batch-a']).endsWith('只做 A')).toBe(true);
  });
});

describe('TURN_CONTINUATION_PROMPT', () => {
  it('tells the model not to regenerate landed media', () => {
    expect(TURN_CONTINUATION_PROMPT).toContain('mediaIds');
    expect(TURN_CONTINUATION_PROMPT).toContain('Do not embed image bytes');
  });
});

describe('shouldPreserveSessionPermissionOverride', () => {
  it('keeps the session floor for Host-authored continuation', () => {
    expect(shouldPreserveSessionPermissionOverride({ source: 'continuation' })).toBe(true);
    expect(shouldPreserveSessionPermissionOverride({ source: 'resume' })).toBe(true);
    expect(shouldPreserveSessionPermissionOverride({ source: 'user' })).toBe(false);
  });
});
