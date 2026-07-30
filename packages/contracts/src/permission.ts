/**
 * Permission rule engine contracts (ADR 0019).
 *
 * Two sides of a rule are kept distinct:
 * - {@link PermissionRuleTarget} is the **pattern** side authored in
 *   `permissions.json` (globs / command patterns).
 * - {@link PermissionSubject} is the **runtime value** being evaluated
 *   (concrete command, path, host). Never reuse a target's glob field as a
 *   concrete subject value.
 */

export type PermissionMode = 'auto' | 'ask-all' | 'bypass';

/** Pattern side of a rule. */
export type PermissionRuleTarget =
  | { kind: 'bash'; pattern: string }
  | { kind: 'file-write'; pathGlob: string }
  | { kind: 'web-fetch'; hostGlob: string }
  | { kind: 'web-search' }
  | { kind: 'mcp'; selectorGlob: string }
  | { kind: 'git'; pattern: string }
  | { kind: 'process' }
  | { kind: 'notes-mutate' };

/** Runtime value being evaluated (never reuse pathGlob for a concrete path). */
export type PermissionSubject =
  | { kind: 'bash'; command: string }
  | { kind: 'file-write'; path: string }
  | { kind: 'web-fetch'; host: string }
  | { kind: 'web-search' }
  | { kind: 'mcp'; selector: string }
  | { kind: 'git'; command: string }
  | { kind: 'process' }
  | { kind: 'notes-mutate' };

export type PermissionRule = {
  target: PermissionRuleTarget;
  decision: 'allow' | 'ask' | 'deny';
  reason: string;
};

export type PermissionRuleSet = {
  deny: PermissionRule[];
  ask: PermissionRule[];
  allow: PermissionRule[];
};

/** On-disk shape for permissions.json files. */
export type PermissionRulesFile = {
  version: 1;
  deny?: PermissionRule[];
  ask?: PermissionRule[];
  allow?: PermissionRule[];
};

export type PermissionConfig = {
  mode: PermissionMode;
};

export function createDefaultPermissionConfig(): PermissionConfig {
  return { mode: 'auto' };
}

export function createEmptyRuleSet(): PermissionRuleSet {
  return { deny: [], ask: [], allow: [] };
}

export function mergeRuleSets(...sets: PermissionRuleSet[]): PermissionRuleSet {
  // Concatenate per bucket. Evaluation order (deny -> ask -> allow) is the engine.
  return {
    deny: sets.flatMap((s) => s.deny),
    ask: sets.flatMap((s) => s.ask),
    allow: sets.flatMap((s) => s.allow),
  };
}
