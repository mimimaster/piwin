import {
  parsePlanDisplayPayload,
  type PlanDisplayPayload,
  type ToolPresentation,
} from '@piwin/contracts';

function isPlanCreateToolName(name: string | undefined): boolean {
  if (name === undefined) return false;
  const normalized = name.trim().toLowerCase();
  return normalized === 'piwin_plan_create' || normalized === 'plan_create';
}

/** Lift the durable plan snapshot from a successful plan-create result. */
export function attachPlanPresentation(
  presentation: ToolPresentation,
  input: { toolName: string; routedToolName?: string; details?: unknown },
): ToolPresentation {
  if (!isPlanCreateToolName(input.toolName) && !isPlanCreateToolName(input.routedToolName)) {
    return presentation;
  }
  if (!input.details || typeof input.details !== 'object' || Array.isArray(input.details)) {
    return presentation;
  }
  const plan = parsePlanDisplayPayload((input.details as Record<string, unknown>).planDisplay);
  if (!plan) return presentation;
  return { ...presentation, plan };
}

export type { PlanDisplayPayload };
