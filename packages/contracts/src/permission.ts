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
 * Agent collaboration mode for Desktop / host prompt preparation.
 *
 * Composer currently exposes `agent` and `goal`. `plan` and `ask` remain in
 * this union for Host / transcript compatibility; they are not Desktop
 * entries (no + menu item, no slash catalog row).
 *
 * Used by {@link resolvePreset} (legacy Plan/Ask floor) and
 * {@link mergeAgentModeIntoPrompt}.
 */
export type AgentModeId = 'agent' | 'plan' | 'ask' | 'goal';

const DEFAULT_AGENT_MODE_RULES = [
  "Success: satisfy the user's stated goal with the smallest correct change; leave clear evidence of what was verified.",
  'If success criteria, technical choices, or constraints are ambiguous in a way that changes the outcome, state the real options and ask — especially for stack/architecture decisions.',
  'Stop: do not expand scope, invent requirements, or keep working past a blocker; surface conflicts instead of thrashing.',
  'Verify: do not claim done, fixed, or passing without checks run in this environment when the claim depends on them.',
  'Safety and permissions are enforced by the host; follow tool results and denials rather than restating policy.',
  'Prefer outcomes and evidence over process narration.',
] as const;

/**
 * Generation-scoped default Agent contract. A compact per-turn marker selects
 * this contract without copying the same rules into every user message.
 */
export const DEFAULT_AGENT_MODE_SYSTEM_PROMPT = [
  '[piwin-prompt-meta kind="mode:agent-default" version="3" applies="generation"]',
  '## Default Agent operating contract',
  'Apply this contract when the latest user message has `[piwin-mode:agent]` or no mode marker.',
  'A turn-scoped Plan, Ask, or Goal contract in the latest user message overrides this default for that turn.',
  ...DEFAULT_AGENT_MODE_RULES,
].join('\n');

/**
 * Operating contracts injected ahead of model-facing user text for each
 * agent collaboration mode. Host-only: transcript / session naming must keep
 * the raw user body, never this preamble.
 */
export const AGENT_MODE_SYSTEM_PREAMBLES: Readonly<Record<AgentModeId, string>> = {
  agent: [
    '[piwin-prompt-meta kind="mode:agent" version="2" applies="every-turn"]',
    'Operating contract for this turn:',
    ...DEFAULT_AGENT_MODE_RULES,
  ].join('\n'),
  plan: [
    '[piwin-prompt-meta kind="mode:plan" version="3" applies="plan-mode"]',
    'You are in Plan Mode until the user explicitly ends it.',
    'Success: call piwin_plan_create and persist a decision-complete SessionPlan — goal, non-goals, steps, affected files, risks, acceptance criteria, and verification — grounded in the repo.',
    'Do not implement or mutate project files; explore (read/search) only. The Host-owned SessionPlan artifact is the required narrow write exception.',
    'Discover repo facts yourself first; ask only questions that would change the plan (especially technical choices).',
    'Stop only after piwin_plan_create succeeds, or report the blocking decision; never substitute a prose-only plan for the durable artifact.',
  ].join('\n'),
  ask: [
    '[piwin-prompt-meta kind="mode:ask" version="2" applies="ask-mode"]',
    'You are in Ask Mode.',
    'Success: accurate answers about the codebase and design, with paths cited when helpful.',
    'Do not edit files, run mutating commands, or implement features unless the user exits Ask mode.',
    'Stop at explanation; if implementation is required, say so and wait for Agent/Plan mode.',
  ].join('\n'),
  goal: [
    '[piwin-prompt-meta kind="mode:goal" version="1" applies="goal-mode"]',
    'You are in Goal Mode (Autonomous Goal Execution Loop with @narumitw/pi-goal).',
    'Success: satisfy the stated objective and all acceptance criteria autonomously through iterative execution.',
    'Explore, edit files, and run tests/checks until the goal is fully accomplished and verified.',
    'When the goal is fully achieved and verified by test/build evidence, call the `goal_complete` tool or report the final delivery summary with evidence.',
    'If you encounter an insurmountable blocker or need an essential user decision, call `goal_blocked` or report the blocker immediately.',
    'Do not falsely claim completion without empirical verification in this environment.',
  ].join('\n'),
};

/** Normalize optional mode id; unknown / empty → agent. */
export function normalizeAgentModeId(modeId: string | undefined | null): AgentModeId {
  if (modeId === 'plan' || modeId === 'ask' || modeId === 'goal' || modeId === 'agent') {
    return modeId;
  }
  return 'agent';
}

/**
 * Inject agent-mode operating contract ahead of model-facing user text.
 * Mirrors orchestration-scheme injection: transcript keeps the original body.
 */
export function mergeAgentModeIntoPrompt(
  modeId: AgentModeId | undefined,
  userFacingText: string,
): string {
  const mode = normalizeAgentModeId(modeId);
  const body = userFacingText.trim();
  if (mode === 'agent') {
    return body ? `[piwin-mode:agent]\nUser:\n${body}` : '[piwin-mode:agent]';
  }
  const preamble = AGENT_MODE_SYSTEM_PREAMBLES[mode];
  if (!preamble) {
    return body;
  }
  if (!body) {
    return `[piwin-mode:${mode}]\n${preamble}\n\n---\n`;
  }
  return `[piwin-mode:${mode}]\n${preamble}\n\n---\nUser:\n${body}`;
}


/** Pattern side of a rule. */
export type PermissionRuleTarget =
  | { kind: 'bash'; pattern: string }
  | { kind: 'file-write'; pathGlob: string }
  | { kind: 'web-fetch'; hostGlob: string }
  | { kind: 'web-search' }
  | { kind: 'git'; pattern: string }
  | { kind: 'process' }
  | { kind: 'notes-mutate' };

/** Runtime value being evaluated (never reuse pathGlob for a concrete path). */
export type PermissionSubject =
  | { kind: 'bash'; command: string }
  | { kind: 'file-write'; path: string }
  | { kind: 'web-fetch'; host: string }
  | { kind: 'web-search' }
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

/** Same fallback Host uses when `permissions.preset` is omitted. */
export function resolvePermissionPreset(
  permissions: PermissionConfig | null | undefined,
): PermissionPreset {
  const preset = permissions?.preset;
  if (preset === 'ask' || preset === 'auto' || preset === 'yolo') {
    return preset;
  }
  const mode = permissions?.mode;
  if (mode === 'auto' || mode === 'ask-all' || mode === 'bypass') {
    return modeToPreset(mode);
  }
  return DEFAULT_PERMISSION_PRESET;
}

/**
 * Session-scoped approval mode for one prompt (ADR 0024 composer pill).
 *
 * Composer Run Mode is session-level and must reach Host even when
 * `config.permissions` is still YOLO. Plan/Ask agent modes still raise the
 * floor through {@link resolvePreset}. `undefined` means: clear the session
 * override and fall back to CLI / config.
 */
export function resolvePromptPermissionMode(input: {
  permissionPreset?: PermissionPreset;
  agentMode?: AgentModeId;
  configPreset: PermissionPreset;
}): PermissionMode | undefined {
  const agentMode = normalizeAgentModeId(input.agentMode);
  if (
    input.permissionPreset === undefined &&
    agentMode !== 'plan' &&
    agentMode !== 'ask'
  ) {
    return undefined;
  }
  const preset = input.permissionPreset ?? input.configPreset;
  return resolvePreset(preset, agentMode).mode;
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
