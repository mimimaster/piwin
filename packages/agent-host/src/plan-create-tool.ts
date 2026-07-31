/**
 * Host custom tool: piwin_plan_create — model-facing structured draft plan
 * creation (SDK only). RPC mode cannot register custom tools (ADR 0008).
 *
 * The model calls this when a skill (e.g. /writing-plans) asks it to produce
 * a reviewable plan artifact. The tool validates all model-provided fields,
 * derives complexity, persists a draft plan, and emits plan/updated. It never
 * accepts arbitrary execution commands, paths, or tool definitions.
 */
import type { PlanComplexity, PlanStep, SessionPlan } from '@piwin/contracts';
import {
  MAX_PLAN_INDEPENDENT_STEPS,
  MAX_PLAN_STEPS,
} from '@piwin/contracts';
import {
  classifyPlanComplexity,
  isWithinPlanSizeLimits,
  loadSessionPlan,
  saveSessionPlan,
} from '@piwin/session';
import type { HostToolDefinition } from '@piwin/tools-web';

export type PlanCreateToolOptions = {
  sessionId: string;
  projectPath: string;
  planPath: string;
  /** Optional skill id to stamp on the plan when source is 'skill'. */
  skillId?: string;
  onUpdated?: (plan: SessionPlan) => void;
};

const ALLOWED_SOURCES: ReadonlySet<string> = new Set(['user', 'assistant', 'skill']);

export function createPlanCreateTool(options: PlanCreateToolOptions): HostToolDefinition {
  return {
    name: 'piwin_plan_create',
    description:
      'Create a reviewable draft SessionPlan artifact. Use after researching a task and before modifying source files. ' +
      'Steps must have stable ids, a short title, and detail with acceptance criteria + verification. ' +
      'Do not include shell commands or scripts as step fields. The plan stays in draft status until the user approves it.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short plan title' },
        goal: { type: 'string', description: 'One-sentence goal' },
        steps: {
          type: 'array',
          description: 'Ordered plan steps',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Stable step id (e.g. "1", "2")' },
              title: { type: 'string', description: 'Short step title' },
              detail: {
                type: 'string',
                description: 'Affected area, acceptance criteria, and verification command',
              },
            },
            required: ['id', 'title'],
          },
        },
        independentSteps: {
          type: 'array',
          description: 'Step ids that can safely run in isolated child sessions',
          items: { type: 'string' },
        },
        source: {
          type: 'string',
          description: "Plan provenance: 'user' | 'assistant' | 'skill' (default 'assistant')",
        },
        skillId: {
          type: 'string',
          description: 'Skill id that produced this plan when source is "skill"',
        },
      },
      required: ['title', 'goal', 'steps'],
    },
    async execute(args) {
      const title = String(args.title ?? '').trim();
      const goal = String(args.goal ?? '').trim();
      if (!title) return 'error: title is required';
      if (!goal) return 'error: goal is required';

      const rawSteps = args.steps;
      if (!Array.isArray(rawSteps) || rawSteps.length === 0) {
        return 'error: at least one step is required';
      }
      if (rawSteps.length > MAX_PLAN_STEPS) {
        return `error: plan exceeds ${MAX_PLAN_STEPS} steps`;
      }

      const steps: PlanStep[] = [];
      const seenIds = new Set<string>();
      for (let index = 0; index < rawSteps.length; index += 1) {
        const rawStep = rawSteps[index];
        if (!rawStep || typeof rawStep !== 'object' || Array.isArray(rawStep)) {
          return `error: steps[${index}] must be an object`;
        }
        const stepRecord = rawStep as Record<string, unknown>;
        const stepId = String(stepRecord.id ?? '').trim();
        const stepTitle = String(stepRecord.title ?? '').trim();
        if (!stepId || !stepTitle) {
          return `error: steps[${index}] requires id and title`;
        }
        if (seenIds.has(stepId)) {
          return `error: duplicate step id ${stepId}`;
        }
        seenIds.add(stepId);
        const step: PlanStep = { id: stepId, title: stepTitle, status: 'pending' };
        const detail = String(stepRecord.detail ?? '').trim();
        if (detail) step.detail = detail;
        steps.push(step);
      }

      const rawIndependent = args.independentSteps;
      let independentSteps: string[] | undefined;
      if (rawIndependent !== undefined) {
        if (!Array.isArray(rawIndependent)) {
          return 'error: independentSteps must be an array';
        }
        if (rawIndependent.length > MAX_PLAN_INDEPENDENT_STEPS) {
          return `error: independentSteps exceeds ${MAX_PLAN_INDEPENDENT_STEPS}`;
        }
        const ids: string[] = [];
        const seenIndependent = new Set<string>();
        for (const entry of rawIndependent) {
          const entryId = String(entry ?? '').trim();
          if (!entryId) return 'error: independentSteps entries must be non-empty strings';
          if (!seenIds.has(entryId)) {
            return `error: independentSteps references unknown step id ${entryId}`;
          }
          if (seenIndependent.has(entryId)) {
            return `error: duplicate independent step id ${entryId}`;
          }
          seenIndependent.add(entryId);
          ids.push(entryId);
        }
        if (ids.length > 0) independentSteps = ids;
      }

      const sourceRaw = String(args.source ?? 'assistant').trim();
      if (!ALLOWED_SOURCES.has(sourceRaw)) {
        return `error: invalid source ${sourceRaw}`;
      }
      const source = sourceRaw as SessionPlan['source'];
      const skillIdRaw = String(args.skillId ?? '').trim();
      const skillId = skillIdRaw || undefined;

      // Refuse to clobber an executing plan.
      const existing = await loadSessionPlan(options.planPath);
      if (existing && (existing.status === 'executing' || existing.status === 'approved')) {
        return `error: a plan is already ${existing.status}; clear or complete it before creating a new one`;
      }

      const complexityInput = { steps, ...(independentSteps ? { independentSteps } : {}) };
      if (!isWithinPlanSizeLimits(complexityInput)) {
        return 'error: plan exceeds size limits';
      }
      const complexity: PlanComplexity = classifyPlanComplexity(complexityInput);

      const now = new Date().toISOString();
      const plan: SessionPlan = {
        id: existing?.id ?? `plan-${Date.now().toString(36)}`,
        sessionId: options.sessionId,
        projectPath: options.projectPath,
        status: 'draft',
        title,
        goal,
        steps,
        revision: existing?.revision ?? 0,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        source,
        complexity,
        ...(independentSteps ? { independentSteps } : {}),
        ...(source === 'skill' && skillId ? { skillId } : {}),
      };

      await saveSessionPlan(options.planPath, plan);
      options.onUpdated?.(plan);
      return `ok: draft plan created with ${steps.length} steps (complexity=${complexity}); awaiting user approval`;
    },
  };
}
