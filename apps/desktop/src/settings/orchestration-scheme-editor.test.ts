import { describe, expect, it } from 'vitest';
import { BUILTIN_ULTRA_CODE_SCHEME } from '@piwin/contracts';
import {
  cleanSchemeDraft,
  createEmptyUserScheme,
  healSchemeDefaultRole,
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

  it('rejects a renamed default role that no longer exists', () => {
    const draft = createEmptyUserScheme(new Set());
    const member = draft.members?.[0];
    expect(member).toBeDefined();
    expect(draft.defaultRole).toBe(member!.role);
    member!.role = 'w';
    expect(validateSchemeDraft(draft)).toBe('bad-default-role');
    expect(validateSchemeDraft(healSchemeDefaultRole(draft))).toBeUndefined();
    expect(healSchemeDefaultRole(draft).defaultRole).toBe('w');
  });

  it('treats empty scheme fields as incomplete, not missing members', () => {
    const draft = createEmptyUserScheme(new Set());
    draft.name = '   ';
    expect(validateSchemeDraft(draft)).toBe('incomplete');
  });

  it('trims and lowercases ids and roles only at save-time clean', () => {
    const draft = createEmptyUserScheme(new Set());
    const member = draft.members?.[0];
    expect(member).toBeDefined();
    draft.id = 'My-Scheme-9';
    member!.role = 'Scout ';
    member!.description = 'Look around ';
    draft.defaultRole = 'Scout ';
    expect(validateSchemeDraft(draft)).toBeDefined();
    const cleaned = cleanSchemeDraft(draft);
    expect(cleaned.id).toBe('my-scheme-9');
    expect(cleaned.members?.[0]?.role).toBe('scout');
    expect(cleaned.members?.[0]?.description).toBe('Look around');
    expect(cleaned.defaultRole).toBe('scout');
    expect(validateSchemeDraft(cleaned)).toBeUndefined();
  });
});
