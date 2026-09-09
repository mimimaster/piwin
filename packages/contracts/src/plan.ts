/** Session plan artifact (application-layer; not a Pi kernel mode). */

import type { PlanExecutionState } from './plan-execution.js';

export type PlanStepStatus = 'pending' | 'active' | 'done' | 'skipped';
export type PlanStatus = 'draft' | 'approved' | 'executing' | 'done' | 'abandoned';
export type PlanSource = 'user' | 'assistant' | 'skill';
export type PlanComplexity = 'short' | 'long';

/** Identity and revision of the document a caller read before replacing it. */
export type SessionPlanVersion = {
  planId: string;
  revision: number;
};

/** `null` means the caller expects the document not to exist yet. */
export type SessionPlanWriteExpectation = SessionPlanVersion | null;

export function isSessionPlanVersion(value: unknown): value is SessionPlanVersion {
  if (typeof value !== 'object' || value === null) return false;
  if (!('planId' in value) || !('revision' in value)) return false;
  const record = value as { planId?: unknown; revision?: unknown };
  return (
    typeof record.planId === 'string' &&
    record.planId.trim().length > 0 &&
    typeof record.revision === 'number' &&
    Number.isSafeInteger(record.revision) &&
    record.revision >= 0
  );
}

export function isSessionPlanWriteExpectation(
  value: unknown,
): value is SessionPlanWriteExpectation {
  return value === null || isSessionPlanVersion(value);
}

export type PlanStep = {
  id: string;
  title: string;
  detail?: string;
  status: PlanStepStatus;
  /**
   * CE-SUB-PROF: optional subagent profile id for this step. When present,
   * plan execution passes it to spawnSubagent so the Host resolves the
   * profile's model/thinking/capabilities/isolation/skills. When absent,
   * plan execution uses its default (worktree + explicit apply).
   */
  profileId?: string;
  /**
   * CE-SUB-ORCH: task ids that must complete before this step can start.
   * The scheduler uses this to build a DAG; absent means no dependencies.
   */
  dependsOn?: string[];
  /**
   * CE-SUB-ORCH: optional grouping key; steps in the same group may be
   * scheduled together by the orchestrator.
   */
  parallelGroup?: string;
};

export type SessionPlan = {
  id: string;
  sessionId: string;
  projectPath: string;
  status: PlanStatus;
  title: string;
  goal: string;
  steps: PlanStep[];
  revision: number;
  createdAt: string;
  updatedAt: string;
  source: PlanSource;
  /** Skill id that produced this plan when source is 'skill'. */
  skillId?: string;
  /** Derived complexity used to recommend execution mode. */
  complexity?: PlanComplexity;
  /** Step ids that can be safely executed in isolated child sessions. */
  independentSteps?: string[];
  /** Live execution state, present only while/after the plan is executed. */
  execution?: PlanExecutionState;
};

export const MAX_PLAN_JSON_BYTES = 64 * 1024;
export const MAX_PLAN_STEPS = 32;
export const MAX_PLAN_INDEPENDENT_STEPS = 32;
