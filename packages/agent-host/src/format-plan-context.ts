/**
 * Format an approved/executing plan as model-facing context (not UI transcript).
 */
import type { SessionPlan } from '@piwin/contracts';

export function formatPlanForModelContext(plan: SessionPlan): string {
  const lines: string[] = [
    '[piwin plan context — follow this plan unless the user revises it]',
    `Title: ${plan.title}`,
    `Status: ${plan.status}`,
    `Goal: ${plan.goal}`,
    'Steps:',
  ];
  for (const step of plan.steps) {
    const mark =
      step.status === 'done'
        ? '[x]'
        : step.status === 'active'
          ? '[>]'
          : step.status === 'skipped'
            ? '[-]'
            : '[ ]';
    lines.push(`  ${mark} ${step.id}: ${step.title}`);
    if (step.detail) {
      lines.push(`      ${step.detail}`);
    }
  }
  if (plan.status === 'approved' || plan.status === 'executing') {
    lines.push(
      'Instruction: When you finish or start a step, call piwin_plan_set_step.',
    );
    lines.push('Only one step should be active at a time.');
  }
  lines.push('[end plan context]');
  return lines.join(String.fromCharCode(10));
}
