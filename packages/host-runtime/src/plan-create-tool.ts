/**
 * Host custom tool: piwin_plan_create — model-facing structured draft plan
 * creation. SDK registers it directly; the piwin RPC worker receives the
 * same descriptor and proxies execution back to Host.
 *
 * The model calls this when a skill (e.g. /writing-plans) asks it to produce
 * a reviewable plan artifact. The tool validates all model-provided fields,
 * derives complexity, persists a draft plan, and emits plan/updated. It never
 * accepts arbitrary execution commands, paths, or tool definitions.
 */
import type {
  HostToolRegistration,
  PlanComplexity,
  PlanStep,
  SessionPlan,
  ToolResult,
} from '@piwin/contracts';
import { MAX_PLAN_INDEPENDENT_STEPS, MAX_PLAN_STEPS } from '@piwin/contracts';
import { passThroughPrepareArgs } from './tools/pass-through-prepare-args.js';
import {
  classifyPlanComplexity,
  isWithinPlanSizeLimits,
  loadSessionPlan,
  saveSessionPlan,
  validateSessionPlan,
} from '@piwin/session';

export type PlanCreateToolOptions = {
  sessionId: string;
  projectPath: string;
  planPath: string;
  /** Optional skill id to stamp on the plan when source is 'skill'. */
  skillId?: string;
  onUpdated?: (plan: SessionPlan) => void;
};

const ALLOWED_SOURCES: ReadonlySet<string> = new Set(['user', 'assistant', 'skill']);

function invalidPlanInput(message: string): ToolResult {
  return { ok: false, code: 'invalid-input', message };
}

export function createPlanCreateTool(options: PlanCreateToolOptions): HostToolRegistration {
  return {
    descriptor: {
      name: 'piwin_plan_create',
      description:
        'Create a draft SessionPlan for user approval before implementation. ' +
        'Success: title, goal, ordered steps with stable ids, titles, and detail (acceptance criteria + verification). ' +
        'No shell/scripts as step fields. Remains draft until the user approves.',
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
                profileId: {
                  type: 'string',
                  description: 'Optional subagent profile id for this step',
                },
                dependsOn: {
                  type: 'array',
                  description: 'Step ids that must complete before this step',
                  items: { type: 'string' },
                },
                parallelGroup: {
                  type: 'string',
                  description: 'Optional scheduler grouping key',
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
    },
    family: 'planning',
    permissionSpec: {
      action: 'planning:create',
      risk: 'unknown',
      rememberable: false,
      subjectBuilder: () => ({ kind: 'tool', action: 'planning:create' }),
    },
    prepareArgs: passThroughPrepareArgs,
    async execute(args) {
      const title = String(args.title ?? '').trim();
      const goal = String(args.goal ?? '').trim();
      if (!title) return invalidPlanInput('title is required');
      if (!goal) return invalidPlanInput('goal is required');

      const rawSteps = args.steps;
      if (!Array.isArray(rawSteps) || rawSteps.length === 0) {
        return invalidPlanInput('at least one step is required');
      }
      if (rawSteps.length > MAX_PLAN_STEPS) {
        return invalidPlanInput(`plan exceeds ${MAX_PLAN_STEPS} steps`);
      }

      const steps: PlanStep[] = [];
      const seenIds = new Set<string>();
      for (let index = 0; index < rawSteps.length; index += 1) {
        const rawStep = rawSteps[index];
        if (!rawStep || typeof rawStep !== 'object' || Array.isArray(rawStep)) {
          return invalidPlanInput(`steps[${index}] must be an object`);
        }
        const stepRecord = rawStep as Record<string, unknown>;
        const stepId = String(stepRecord.id ?? '').trim();
        const stepTitle = String(stepRecord.title ?? '').trim();
        if (!stepId || !stepTitle) {
          return invalidPlanInput(`steps[${index}] requires id and title`);
        }
        if (seenIds.has(stepId)) {
          return invalidPlanInput(`duplicate step id ${stepId}`);
        }
        seenIds.add(stepId);
        const step: PlanStep = { id: stepId, title: stepTitle, status: 'pending' };
        const detail = String(stepRecord.detail ?? '').trim();
        if (detail) step.detail = detail;
        if (stepRecord.profileId !== undefined) {
          if (typeof stepRecord.profileId !== 'string' || !stepRecord.profileId.trim()) {
            return invalidPlanInput(`steps[${index}].profileId must be a non-empty string`);
          }
          step.profileId = stepRecord.profileId.trim();
        }
        if (stepRecord.parallelGroup !== undefined) {
          if (typeof stepRecord.parallelGroup !== 'string' || !stepRecord.parallelGroup.trim()) {
            return invalidPlanInput(`steps[${index}].parallelGroup must be a non-empty string`);
          }
          step.parallelGroup = stepRecord.parallelGroup.trim();
        }
        if (stepRecord.dependsOn !== undefined) {
          if (!Array.isArray(stepRecord.dependsOn)) {
            return invalidPlanInput(`steps[${index}].dependsOn must be an array`);
          }
          const dependencies: string[] = [];
          const seenDependencies = new Set<string>();
          for (const dependency of stepRecord.dependsOn) {
            if (typeof dependency !== 'string' || !dependency.trim()) {
              return invalidPlanInput(
                `steps[${index}].dependsOn entries must be non-empty strings`,
              );
            }
            const dependencyId = dependency.trim();
            if (seenDependencies.has(dependencyId)) {
              return invalidPlanInput(
                `steps[${index}].dependsOn contains duplicate ${dependencyId}`,
              );
            }
            seenDependencies.add(dependencyId);
            dependencies.push(dependencyId);
          }
          if (dependencies.length > 0) step.dependsOn = dependencies;
        }
        steps.push(step);
      }

      const rawIndependent = args.independentSteps;
      let independentSteps: string[] | undefined;
      if (rawIndependent !== undefined) {
        if (!Array.isArray(rawIndependent)) {
          return invalidPlanInput('independentSteps must be an array');
        }
        if (rawIndependent.length > MAX_PLAN_INDEPENDENT_STEPS) {
          return invalidPlanInput(`independentSteps exceeds ${MAX_PLAN_INDEPENDENT_STEPS}`);
        }
        const ids: string[] = [];
        const seenIndependent = new Set<string>();
        for (const entry of rawIndependent) {
          const entryId = String(entry ?? '').trim();
          if (!entryId) {
            return invalidPlanInput('independentSteps entries must be non-empty strings');
          }
          if (!seenIds.has(entryId)) {
            return invalidPlanInput(`independentSteps references unknown step id ${entryId}`);
          }
          if (seenIndependent.has(entryId)) {
            return invalidPlanInput(`duplicate independent step id ${entryId}`);
          }
          seenIndependent.add(entryId);
          ids.push(entryId);
        }
        if (ids.length > 0) independentSteps = ids;
      }

      const sourceRaw = String(args.source ?? 'assistant').trim();
      if (!ALLOWED_SOURCES.has(sourceRaw)) {
        return invalidPlanInput(`invalid source ${sourceRaw}`);
      }
      const source = sourceRaw as SessionPlan['source'];
      const skillIdRaw = String(args.skillId ?? '').trim();
      const skillId = skillIdRaw || undefined;

      // Refuse to clobber an executing plan.
      const existing = await loadSessionPlan(options.planPath);
      if (existing && (existing.status === 'executing' || existing.status === 'approved')) {
        return invalidPlanInput(
          `a plan is already ${existing.status}; clear or complete it before creating a new one`,
        );
      }

      const complexityInput = { steps, ...(independentSteps ? { independentSteps } : {}) };
      if (!isWithinPlanSizeLimits(complexityInput)) {
        return invalidPlanInput('plan exceeds size limits');
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
        revision: existing ? existing.revision + 1 : 0,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        source,
        complexity,
        ...(independentSteps ? { independentSteps } : {}),
        ...(source === 'skill' && skillId ? { skillId } : {}),
      };

      const validated = validateSessionPlan(plan);
      if (!validated.ok) {
        return invalidPlanInput(
          validated.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '),
        );
      }

      await saveSessionPlan(options.planPath, validated.plan);
      options.onUpdated?.(validated.plan);
      return {
        ok: true,
        output: `draft plan created with ${steps.length} steps (complexity=${complexity}); awaiting user approval`,
        details: {
          planId: validated.plan.id,
          revision: validated.plan.revision,
          status: validated.plan.status,
        },
      };
    },
  };
}
