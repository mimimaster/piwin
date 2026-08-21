import { describe, expect, it } from 'vitest';
import { BUILTIN_ULTRA_CODE_SCHEME } from '@piwin/contracts';
import {
  createEmptyUserScheme,
  schemeToEditableDraft,
  validateSchemeDraft,
} from './orchestration-scheme-editor';

describe('orchestration scheme editor helpers', () => {
  it('turns ultra builtin into an editable draft with scout', () => {
    const draft = schemeToEditableDraft(BUILTIN_ULTRA_CODE_SCHEME);
    expect(draft.id).toBe('ultra-code');
    expect(draft.members?.[0]?.role).toBe('scout');
    expect(draft.members?.[0]?.reportContract).toMatch(/complete \| partial \| blocked/);
    expect(draft.systemPreamble).toMatch(/foundational/i);
    expect(draft.systemPreamble.length).toBeGreaterThan(20);
    expect(validateSchemeDraft(draft)).toBeUndefined();
  });

  it('creates a valid empty user scheme', () => {
    const draft = createEmptyUserScheme(new Set(['ultra-code']));
    expect(draft.id).not.toBe('ultra-code');
    expect(validateSchemeDraft(draft)).toBeUndefined();
  });

  it('rejects empty members', () => {
    const draft = schemeToEditableDraft(BUILTIN_ULTRA_CODE_SCHEME);
    draft.members = [];
    expect(validateSchemeDraft(draft)).toBe('need-member');
  });
});
