/** Session plan artifact (application-layer; not a Pi kernel mode). */

export type PlanStepStatus = 'pending' | 'active' | 'done' | 'skipped';
export type PlanStatus = 'draft' | 'approved' | 'executing' | 'done' | 'abandoned';
export type PlanSource = 'user' | 'assistant' | 'skill';

export type PlanStep = {
  id: string;
  title: string;
  detail?: string;
  status: PlanStepStatus;
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
};

export const MAX_PLAN_JSON_BYTES = 64 * 1024;
