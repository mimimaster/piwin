/**
 * CE-SUB-PROF: Settings-backed subagent profile contracts.
 *
 * Profiles are user-authored recipes stored in `PiwinConfig.subagents`. They
 * never define providers/models; they only reference `ModelRef` values that
 * already exist in `PiwinConfig.providers`. The Host merges built-in profiles
 * with Settings overrides and resolves an immutable `SubagentRuntimeSnapshot`
 * at child creation time. Settings edits affect only future children; resume
 * uses the persisted snapshot.
 */

import type { ModelRef, ThinkingLevel } from './host.js';
import type { SubagentIsolationMode } from './subagent.js';

/**
 * Product-layer capability ids that cross the Settings boundary.
 *
 * Settings stores these ids; `@piwin/agent-host` is the only place that maps
 * them to concrete Pi/native/custom tool names. Permission evaluation remains
 * a runtime deny/ask/allow gate and is never replaced by this allowlist.
 */
export type SubagentCapability =
  'read' | 'write' | 'execute' | 'network' | 'mcp' | 'browser' | 'planning' | 'delegate';

/** All valid capability ids, for validation/UI enumeration. */
export const SUBAGENT_CAPABILITIES: readonly SubagentCapability[] = [
  'read',
  'write',
  'execute',
  'network',
  'mcp',
  'browser',
  'planning',
  'delegate',
];

/** User-authored profile recipe persisted in `~/.piwin/config.json`. */
export type SubagentProfileSettings = {
  id: string;
  description: string;
  /**
   * Reference to a provider/model already configured in `PiwinConfig.providers`.
   * Omitted means inherit the parent/default configured model.
   */
  model?: ModelRef;
  thinkingLevel?: ThinkingLevel;
  /**
   * Product capability allowlist. The Host maps these to concrete tool ids;
   * the permission engine still evaluates each action at runtime.
   */
  capabilities?: SubagentCapability[];
  /**
   * Skill allowlist. Omitted means inherit globally enabled skills; present
   * means intersect with globally enabled skills.
   */
  skillIds?: string[];
  isolation: SubagentIsolationMode;
};

/** Resolved profile (builtin or settings) with origin metadata. */
export type SubagentProfile = SubagentProfileSettings & {
  source: 'builtin' | 'settings';
};

/**
 * Built-in profile metadata for UI display. The Host (`@piwin/agent-host`)
 * owns the full built-in definitions (capabilities, isolation); this list
 * only carries id + description so the UI can render a dropdown without
 * importing the host package. Settings overrides merge by id.
 */
export const BUILTIN_SUBAGENT_PROFILE_SUMMARIES: readonly {
  id: string;
  description: string;
}[] = [
  { id: 'explorer', description: 'Fast read-only codebase exploration' },
  { id: 'reviewer', description: 'Read-only code review and analysis' },
  { id: 'implementer', description: 'Isolated implementation with write and execute' },
  { id: 'tester', description: 'Isolated test execution and fixture writes' },
];

/**
 * Caller-side selection passed to spawn/run/plan surfaces. A per-call `model`
 * or `thinkingLevel` overrides the profile's value but cannot widen
 * capabilities, skills, or isolation.
 */
export type SubagentProfileSelector = {
  profileId?: string;
  model?: ModelRef;
  thinkingLevel?: ThinkingLevel;
};

/**
 * Immutable effective recipe captured at child creation time and persisted
 * with the session index. Resume reconstructs the child from this snapshot
 * rather than re-resolving current Settings.
 */
export type SubagentRuntimeSnapshot = {
  profileId?: string;
  model?: ModelRef;
  thinkingLevel?: ThinkingLevel;
  capabilities?: SubagentCapability[];
  skillIds?: string[];
  isolation: SubagentIsolationMode;
  /** Resolved cwd (project root or worktree path) at child creation time. */
  workingDirectory: string;
};
