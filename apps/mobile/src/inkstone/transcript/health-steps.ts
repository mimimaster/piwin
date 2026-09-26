import type { WorkStep } from './turn-model.js';

export type ToolWorkStep = Extract<WorkStep, { kind: 'tool' }>;

/**
 * Apple Health reads are sources the reply is built on, like a search result
 * in a chat app, so they are shown on the turn itself rather than folded into
 * the work log next to `ls` and `grep`.
 */
export function partitionHealthSteps(steps: readonly WorkStep[]): {
  health: ToolWorkStep[];
  work: WorkStep[];
} {
  const health: ToolWorkStep[] = [];
  const work: WorkStep[] = [];
  for (const step of steps) {
    if (step.kind === 'tool' && step.tool.presentation?.kind === 'health') {
      health.push(step);
    } else {
      work.push(step);
    }
  }
  return { health, work };
}
