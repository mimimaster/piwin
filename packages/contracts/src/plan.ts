/** Session plan artifact (application-layer; not a Pi kernel mode). */

import type { PlanExecutionState } from './plan-execution.js';

export type PlanStepStatus = 'pending' | 'active' | 'done' | 'skipped';
export type PlanStatus = 'draft' | 'approved' | 'executing' | 'done' | 'abandoned';
export type PlanSource = 'user' | 'assistant' | 'skill';
export type PlanComplexity = 'short' | 'long';

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
