/**
 * ORCH: Orchestration Scheme type surface (per-send opt-in subagent orchestration).
 *
 * Spec: docs/specs/orchestration-scheme.md (v1 shell)
 * Enhancement: docs/specs/orchestration-scheme-v2-enhancement.md (members / role)
 *
 * Schemes package main-agent spawn discipline + role roster + concurrency
 * ceilings. They never define providers. Off / omit on a send means zero
 * scheme work. The Desktop default scheme only preselects the composer for a
 * new conversation; it does not inject discipline by itself.
 */

import type { ModelRef, ThinkingLevel } from './host.js';
import type { SubagentIsolationMode } from './subagent.js';

/** Wait policy for orchestration schemes. */
export type OrchestrationWaitPolicy = 'await-all' | 'fire-and-continue';

/** Spawn-before unavailability handling for a scheme member. */
export type OrchestrationMemberFallback = 'main' | 'none';

/** Size bound under which the Lead may approve a candidate without a reviewer. */
export type OrchestrationLeadReviewLimit = {
  maxFiles: number;
  maxChangedLines: number;
};

/**
 * Host-owned delivery behavior of a builtin member. Taken only from builtin
 * recipes (by scheme id + role) at resolve; Settings and models cannot set it.
 */
export type OrchestrationMemberBehavior = {
  /**
   * Persistent writer lane (Fusion sidekick semantics): brief envelope, no
   * nested delegate, candidate + explicit apply, Lead review authority, and
   * continuation of the same retained child.
   */
  lane?: 'persistent';
  /** Candidate + explicit apply without the lane (Reviewed Delivery worker). */
  deliveryLock?: 'candidate-explicit';
  /**
   * Lane candidates larger than this need an independent reviewer; the Lead
   * review is refused. Omit = the Lead may always review (Fusion).
   */
  leadReviewLimit?: OrchestrationLeadReviewLimit;
  /**
   * Survives the parent run: not joined at settlement, not cancelled when a
   * new user message replaces the run. Result is delivered later.
   */
  detached?: boolean;
};

/** Points a member at another scheme's member for model / profile / contract. */
export type OrchestrationMemberRef = {
  schemeId: string;
  role: string;
};

/**
 * One callable role inside a scheme (main agent points at `role`).
 * description is required so the main agent knows when to delegate (Claude-style).
 */
export type OrchestrationSchemeMember = {
  /** Main-agent call name, unique within the scheme (e.g. scout). */
  role: string;
  /** When to use this role — injected into the scheme roster. */
  description: string;
  /** Optional global SubagentProfile template id. */
  profileId?: string;
  /** Pinned model; omit inherits profile then parent session model. */
  model?: ModelRef;
  thinkingLevel?: ThinkingLevel;
  isolation?: SubagentIsolationMode;
  /** Default `main`: tell parent to do the work itself when spawn is impossible. */
  fallback?: OrchestrationMemberFallback;
  /**
   * Scout return format injected into the child's first user message.
   * Empty/omit = no contract block. Ultra Code scout has a builtin default.
   */
  reportContract?: string;
  /**
   * Take profile / model / thinking / isolation / reportContract from another
   * scheme's member (after its Settings overlay). Fields set here win. One
   * level only: the target member may not inherit itself.
   */
  inheritFrom?: OrchestrationMemberRef;
  /** Builtin recipes only; ignored when it comes from Settings. */
  behavior?: OrchestrationMemberBehavior;
};

/**
 * Settings-backed orchestration scheme recipe.
 * v2: members[] is the roster; defaultProfileId remains for v1 migration.
 */
export type OrchestrationSchemeSettings = {
  id: string;
  name: string;
  description: string;
  /**
   * Main-agent discipline (AGENTS.md analogue). Injected only when selected.
   */
  systemPreamble: string;
  /**
   * Scheme roster. Empty/missing is migrated from defaultProfileId at resolve.
   */
  members?: OrchestrationSchemeMember[];
  /**
   * Default role when spawn omits role (or soft-generic). Must exist in members
   * after migration.
   */
  defaultRole?: string;
  /**
   * v1 compatibility: default profile when members are absent.
   * Prefer defaultRole + members in new UI.
   */
  defaultProfileId?: string;
  /**
   * Optional allowlist of profile ids (v1). Prefer members for allow-set.
   */
  allowedProfileIds?: string[];
  /**
   * When false, hide model/thinking from free-form spawn; Host uses role/member.
   * Role remains the product call name.
   */
  exposeSpawnMetadata: boolean;
  maxConcurrency?: number;
  maxTasksPerRun?: number;
  waitPolicy: OrchestrationWaitPolicy;
  maxSubagentThinkingLevel?: ThinkingLevel;
};

export type OrchestrationScheme = OrchestrationSchemeSettings & {
  source: 'builtin' | 'settings';
};

/**
 * Minimal config slice for scheme resolve (avoids contracts circular import
 * with full PiwinConfig).
 */
export type OrchestrationSchemeConfigSlice = {
  schemes?: OrchestrationSchemeSettings[] | undefined;
  maxConcurrency?: number | undefined;
  maxTasksPerRun?: number | undefined;
  /**
   * Settings override of the Lead review size bound (Auto sidekick). Behavior
   * itself stays builtin-only; this only tunes the number, and is validated
   * with {@link normalizeLeadReviewLimit} at resolve.
   */
  leadReviewLimit?: Partial<OrchestrationLeadReviewLimit> | undefined;
};

export type ResolveOrchestrationSchemeOptions = {
  knownProfileIds?: ReadonlySet<string> | readonly string[] | undefined;
  globalMaxConcurrency?: number | undefined;
  globalMaxTasksPerRun?: number | undefined;
  /**
   * Optional set of "providerId::modelId" keys known to be configured.
   * When set, member.model not in the set marks the member unavailable.
   */
  knownModelKeys?: ReadonlySet<string> | readonly string[] | undefined;
};
