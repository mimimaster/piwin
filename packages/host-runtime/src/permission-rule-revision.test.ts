import { describe, expect, it } from 'vitest';
import type { PermissionRuleSet } from '@piwin/contracts';
import { computePermissionRulesRevision } from './permission-rule-revision.js';

describe('computePermissionRulesRevision', () => {
  it('is stable for the same materialized rule set', () => {
    const rules: PermissionRuleSet = { deny: [], ask: [], allow: [] };

    expect(computePermissionRulesRevision(rules)).toBe(computePermissionRulesRevision(rules));
    expect(computePermissionRulesRevision(rules)).toMatch(/^[0-9a-f]{12}$/);
  });

  it('changes when a frozen rule changes', () => {
    const base: PermissionRuleSet = { deny: [], ask: [], allow: [] };
    const changed: PermissionRuleSet = {
      ...base,
      deny: [
        {
          target: { kind: 'bash', pattern: 'rm -rf *' },
          decision: 'deny',
          reason: 'destructive command',
        },
      ],
    };

    expect(computePermissionRulesRevision(changed)).not.toBe(computePermissionRulesRevision(base));
  });
});
