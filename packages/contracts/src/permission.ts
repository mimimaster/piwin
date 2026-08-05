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

/**
 * User-facing Run Mode (ADR 0024). The primary permission knob in the composer.
 * Maps to an internal {@link PermissionMode} + sandbox profile via
 * {@link resolvePreset}.
 *
 * - `ask`  — ask almost everything (sandboxed)
 * - `auto` — low friction inside sandbox; ask to leave
 * - `yolo` — no sandbox, no prompts except circuit breakers
 */
export type PermissionPreset = 'ask' | 'auto' | 'yolo';

/** Default Run Mode for newly created sessions. Pi's native default is YOLO. */
export const DEFAULT_PERMISSION_PRESET: PermissionPreset = 'yolo';

/**
 * Approval scope for a permission prompt (ADR 0024 §4).
 *
 * - `once`    — this action only
 * - `session` — in-memory for this session only (new)
 * - `project` — persisted to `~/.piwin/projects.json`
 */
export type ApprovalScope = 'once' | 'session' | 'project';

/**
 * Sandbox profile name (ADR 0024 §5). Phase 1 defines the names; Phase 2
 * implements OS enforcement. `none` = full host (yolo).
 */
export type SandboxProfileName = 'read-only' | 'workspace' | 'none';

/**
 * Agent collaboration mode (mirrors `apps/desktop/src/agent-mode.ts`).
 * Used by {@link resolvePreset} to raise a read-only floor under Plan/Ask.
 */
export type AgentModeId = 'agent' | 'plan' | 'ask';

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
  | { kind: 'notes-mutate' }
  /** Host-local fallback subject for side-effect tools without a rule target. */
  | { kind: 'tool'; action: string };

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
  /**
   * User-facing Run Mode preset (ADR 0024). Preferred over `mode` for new
   * config. When set, `mode` is derived via {@link resolvePreset}. When
   * absent, `mode` is used directly (backward compat with ADR 0019).
   */
  preset?: PermissionPreset;
};

export function createDefaultPermissionConfig(): PermissionConfig {
  return { mode: 'bypass', preset: DEFAULT_PERMISSION_PRESET };
}

/**
 * Conservative fallback for a present but malformed permissions block.
 * Missing configuration uses Pi-compatible YOLO; invalid configuration must
 * not silently increase privileges.
 */
export function createSafeFallbackPermissionConfig(): PermissionConfig {
  return { mode: 'auto', preset: 'auto' };
}

/**
 * Result of resolving a Run Mode preset into the internal approval axis
 * (PermissionMode) and capability axis (SandboxProfileName).
 */
export type ResolvedPreset = {
  mode: PermissionMode;
  sandbox: SandboxProfileName;
  /**
   * True when the preset was narrowed by Agent mode (Plan/Ask read-only floor)
   * or by project trust (yolo refused for untrusted). UI uses this to warn.
   */
  downgraded?: boolean;
  reason?: string;
};

/**
 * Map a user-facing Run Mode preset + Agent mode into the internal approval
 * mode + sandbox profile (ADR 0024 §3, §6).
 *
 * Pure function — no IO. The bypass guard (untrusted project refuses yolo) is
 * applied separately by the host because it requires project trust state.
 */
export function resolvePreset(
  preset: PermissionPreset,
  agentMode: AgentModeId = 'agent',
): ResolvedPreset {
  // Soft floor: Plan/Ask agent modes raise read-only even under Auto.
  // YOLO under Plan/Ask is allowed (locked decision) — UI warns, host does not hard-block.
  if (agentMode === 'plan' || agentMode === 'ask') {
    if (preset === 'yolo') {
      return { mode: 'bypass', sandbox: 'none' };
    }
    return { mode: 'ask-all', sandbox: 'read-only' };
  }
  switch (preset) {
    case 'ask':
      return { mode: 'ask-all', sandbox: 'workspace' };
    case 'auto':
      return { mode: 'auto', sandbox: 'workspace' };
    case 'yolo':
      return { mode: 'bypass', sandbox: 'none' };
  }
}

/**
 * Convert a legacy {@link PermissionMode} to a {@link PermissionPreset} for
 * backward compatibility (ADR 0019 config files, CLI flags).
 */
export function modeToPreset(mode: PermissionMode): PermissionPreset {
  switch (mode) {
    case 'auto':
      return 'auto';
    case 'ask-all':
      return 'ask';
    case 'bypass':
      return 'yolo';
  }
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
