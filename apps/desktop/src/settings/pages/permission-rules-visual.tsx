/**
 * Structured permission-rule rows. JSON remains the on-disk / Host shape;
 * this view is a thin editor over deny / ask / allow arrays.
 */
import type { PermissionRule, PermissionRuleTarget, PermissionRulesFile } from '@piwin/contracts';

export type PermissionRuleTier = 'deny' | 'ask' | 'allow';

export type VisualRuleRow = {
  id: string;
  tier: PermissionRuleTier;
  kind: PermissionRuleTarget['kind'];
  pattern: string;
  reason: string;
};

export const RULE_KINDS: readonly PermissionRuleTarget['kind'][] = [
  'bash',
  'file-write',
  'web-fetch',
  'web-search',
  'git',
  'process',
  'notes-mutate',
];

export const RULE_TIERS: readonly PermissionRuleTier[] = ['deny', 'ask', 'allow'];

export function emptyRulesFile(): PermissionRulesFile {
  return { version: 1 };
}

export function ruleNeedsPattern(kind: PermissionRuleTarget['kind']): boolean {
  return kind === 'bash' || kind === 'file-write' || kind === 'web-fetch' || kind === 'git';
}

export function rulePattern(target: PermissionRuleTarget): string {
  switch (target.kind) {
    case 'bash':
    case 'git':
      return target.pattern;
    case 'file-write':
      return target.pathGlob;
    case 'web-fetch':
      return target.hostGlob;
    default:
      return '';
  }
}

export function targetFromRow(row: VisualRuleRow): PermissionRuleTarget {
  switch (row.kind) {
    case 'bash':
      return { kind: 'bash', pattern: row.pattern };
    case 'file-write':
      return { kind: 'file-write', pathGlob: row.pattern };
    case 'web-fetch':
      return { kind: 'web-fetch', hostGlob: row.pattern };
    case 'web-search':
      return { kind: 'web-search' };
    case 'git':
      return { kind: 'git', pattern: row.pattern };
    case 'process':
      return { kind: 'process' };
    case 'notes-mutate':
      return { kind: 'notes-mutate' };
  }
}

export function fileToRows(file: PermissionRulesFile): VisualRuleRow[] {
  const rows: VisualRuleRow[] = [];
  let sequence = 0;
  for (const tier of RULE_TIERS) {
    for (const rule of file[tier] ?? []) {
      rows.push({
        id: `${tier}-${sequence}`,
        tier,
        kind: rule.target.kind,
        pattern: rulePattern(rule.target),
        reason: rule.reason,
      });
      sequence += 1;
    }
  }
  return rows;
}

export function rowsToFile(rows: VisualRuleRow[]): PermissionRulesFile {
  const file: PermissionRulesFile = { version: 1 };
  for (const tier of RULE_TIERS) {
    const rules: PermissionRule[] = rows
      .filter((row) => row.tier === tier)
      .map((row) => ({
        target: targetFromRow(row),
        decision: tier,
        reason: row.reason,
      }));
    if (rules.length > 0) {
      file[tier] = rules;
    }
  }
  return file;
}

export function createEmptyRow(tier: PermissionRuleTier, sequence: number): VisualRuleRow {
  return {
    id: `new-${tier}-${sequence}`,
    tier,
    kind: 'bash',
    pattern: '',
    reason: '',
  };
}
