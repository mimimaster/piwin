import { describe, expect, it } from 'vitest';
import {
  createDefaultPermissionConfig,
  createEmptyRuleSet,
  mergeRuleSets,
} from './permission.js';

const denyRule = {
  target: { kind: 'bash' as const, pattern: 'rm -rf /' },
  decision: 'deny' as const,
  reason: 'dangerous',
};

const askRule = {
  target: { kind: 'file-write' as const, pathGlob: '/etc/*' },
  decision: 'ask' as const,
  reason: 'system files',
};

const allowRule = {
  target: { kind: 'web-fetch' as const, hostGlob: '*.example.com' },
  decision: 'allow' as const,
  reason: 'trusted',
};

describe('createDefaultPermissionConfig', () => {
  it('returns auto mode', () => {
    expect(createDefaultPermissionConfig()).toEqual({ mode: 'auto' });
  });
});

describe('createEmptyRuleSet', () => {
  it('returns empty buckets', () => {
    expect(createEmptyRuleSet()).toEqual({ deny: [], ask: [], allow: [] });
  });
});

describe('mergeRuleSets', () => {
  it('concatenates per bucket preserving order', () => {
    const a = { deny: [denyRule], ask: [], allow: [allowRule] };
    const b = { deny: [], ask: [askRule], allow: [] };

    expect(mergeRuleSets(a, b)).toEqual({
      deny: [denyRule],
      ask: [askRule],
      allow: [allowRule],
    });
  });

  it('returns empty buckets for no inputs', () => {
    expect(mergeRuleSets()).toEqual({ deny: [], ask: [], allow: [] });
  });

  it('merges multiple rule sets', () => {
    const a = { deny: [denyRule], ask: [], allow: [] };
    const b = { deny: [], ask: [askRule], allow: [] };
    const c = { deny: [], ask: [], allow: [allowRule] };

    const merged = mergeRuleSets(a, b, c);
    expect(merged.deny).toHaveLength(1);
    expect(merged.ask).toHaveLength(1);
    expect(merged.allow).toHaveLength(1);
  });
});
