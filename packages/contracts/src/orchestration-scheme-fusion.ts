/**
 * Built-in Fusion orchestration scheme.
 *
 * Kept beside `orchestration-scheme.ts` so the Lead preamble and sidekick
 * contract do not grow that module past the line cap.
 */

import type { OrchestrationScheme } from './orchestration-scheme.js';

export const FUSION_SCHEME_ID = 'fusion' as const;

export const FUSION_SIDEKICK_ROLE = 'sidekick' as const;

export const PIWIN_FUSION_BRIEF_MARKER = '[piwin-fusion-brief]';

const FUSION_SIDEKICK_DESCRIPTION =
  'Execute one bounded mechanical assignment in a retained worktree. Report done, blocked, or escalate. Do not own architecture or product judgment.';

/**
 * Main-agent (Lead) discipline. Injected only when Fusion is selected.
 * Instructs by tool name; parent/composer is not a child role.
 */
const FUSION_PREAMBLE = `<orchestration_discipline scheme="fusion">
You are the Lead: the user-facing composer. Own the plan, interpretation of ambiguity, and final review. Parent/composer is not a child role.

## Isolation
The sidekick is a persistent CLI-subagent lane (independent child session + retained worktree), not a second loop in this session. Never paste this conversation into a task. The Host wraps the task as a brief; the sidekick cannot see the parent conversation.

## What stays with you
Judgment-as-deliverable stays here. Do not delegate architecture, unresolved product ambiguity, or interaction design (official anti-pattern: a cross-team React/Redux search bar dropped 54→27 while cutting 28% cost). Mechanical implementation, applying a decided interface, running existing tests, and fixing a named error may go to the sidekick.

## Loop
1. Write a self-contained brief in the task text: goal, scope, constraints, success_criteria. Call \`piwin_subagent_start\` with role="sidekick" only. Do not name provider or model ids.
2. Call \`piwin_subagent_wait\` and read the Result only. Do not treat child tool traces as your context.
3. Review the checks. \`escalate\` or consecutive same-mode failure: take the work back in this session (\`fallback=main\`).
4. You are the review authority. Record your decision with \`piwin_subagent_review_submit\` on the exact \`result\` ref from wait. To accept, submit \`approved\`, then call \`piwin_subagent_result_apply\` with that \`result\` and the returned \`reviewRef\` as \`approvedBy\`. One decision per candidate: for changes, send a new brief instead.
5. Sequential briefs reuse the same sidekick. Do not fan-out writers. Do not use start as a map-reduce coordinator. Stage graphs belong to SessionPlan, not this scheme.

Pairing is sticky for this conversation. Do not try to switch the sidekick model per turn.
</orchestration_discipline>`;

/** Child seed: last assistant message is the only Result the parent reads. */
export const FUSION_SIDEKICK_REPORT_CONTRACT = `<sidekick_contract>
You execute one brief in a retained worktree. You cannot see the parent conversation. This brief is the entire assignment.

## Constraints
- Do not spawn child agents.
- Do not make architectural or product decisions. If the brief is ambiguous or the change is judgment-as-deliverable, escalate.
- Zero chatter: no conversational preamble.

## Output Format
Line 1: exactly one of done | blocked | escalate
Body:
- Summary of what changed
- Changed paths
- Checks: command and exit code
- Residual risks
- If escalate: escalate_reason
</sidekick_contract>`;

/**
 * Wrap a Lead task as the only text the sidekick may see.
 * Does not accept parent messages; callers must pass brief text only.
 */
export function formatFusionBriefEnvelope(task: string): string {
  const body = task.trim();
  return [
    PIWIN_FUSION_BRIEF_MARKER,
    'Isolation: persistent CLI-subagent lane (independent child session + retained worktree), not an in-process dual loop.',
    'You cannot see the parent conversation. This brief is the entire assignment.',
    '---',
    body,
  ].join('\n');
}

/**
 * Builtin Fusion: Lead (parent) + one sidekick writer.
 * Models inherit the parent unless Settings overlays pin the sidekick.
 */
export const BUILTIN_FUSION_SCHEME: OrchestrationScheme = {
  id: FUSION_SCHEME_ID,
  name: 'Fusion',
  description:
    'Built-in Lead/sidekick pairing: composer plans and reviews; a cheaper sidekick executes bounded work in a retained worktree. Pin a sidekick model in Settings or it inherits the composer price',
  source: 'builtin',
  defaultRole: FUSION_SIDEKICK_ROLE,
  defaultProfileId: 'implementer',
  exposeSpawnMetadata: false,
  maxConcurrency: 1,
  maxTasksPerRun: 8,
  waitPolicy: 'await-all',
  members: [
    {
      role: FUSION_SIDEKICK_ROLE,
      description: FUSION_SIDEKICK_DESCRIPTION,
      profileId: 'implementer',
      isolation: 'worktree',
      fallback: 'main',
      reportContract: FUSION_SIDEKICK_REPORT_CONTRACT,
    },
  ],
  systemPreamble: FUSION_PREAMBLE,
};
