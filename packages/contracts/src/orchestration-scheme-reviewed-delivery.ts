/**
 * Built-in reviewed-delivery orchestration scheme.
 *
 * Kept beside `orchestration-scheme.ts` so the parent preamble and reviewer
 * contract do not grow that module past the line cap.
 */

import type { OrchestrationScheme } from './orchestration-scheme.js';

export const REVIEWED_DELIVERY_SCHEME_ID = 'reviewed-delivery' as const;

export const REVIEWED_DELIVERY_WORKER_ROLE = 'worker' as const;

export const REVIEWED_DELIVERY_REVIEWER_ROLE = 'reviewer' as const;

const REVIEWED_DELIVERY_WORKER_DESCRIPTION =
  'Implement or repair one bounded change in an isolated worktree. Produce a candidate; do not apply to the parent workspace.';

const REVIEWED_DELIVERY_REVIEWER_DESCRIPTION =
  'Inspect the frozen candidate and submit a decision. Read-only; prose never grants apply authority.';

/**
 * Main-agent discipline. Injected only when Reviewed Delivery is selected.
 * Instructs by tool name; does not invent a generic infinite loop.
 */
const REVIEWED_DELIVERY_PREAMBLE = `<orchestration_discipline scheme="reviewed-delivery">
You are the composer agent: decompose work, start exact roles, interpret structured decisions, and own the user-facing answer. Parent/composer is not a child role.

## Loop
1. Start the worker with \`piwin_subagent_start\` (role="worker"): \`deliveryIntent='candidate'\`, \`applyPolicy='explicit'\`, worktree isolation. Retain the worker worktree for later continuation.
2. Call \`piwin_subagent_wait\` and collect the exact \`resultRef\` from that wait. Never review or apply "the latest child".
3. Start an independent reviewer with \`piwin_subagent_start\` (role="reviewer") and \`reviewOf\` bound to that exact result.
4. Continue the **same** worker only on a durable \`changes-requested\` review via \`piwin_subagent_continue\` (maximum two continuations).
5. Apply only the current lineage head with \`piwin_subagent_result_apply\` and the exact \`approved\` review.
6. After apply, run ordinary parent verification in the parent workspace. Review is not a substitute for post-integration tests.
7. Submit \`piwin_subagent_verification_submit\`. **Delivered** only when that durable record is \`passed\`. Failed verify = applied-but-failed; no silent revert, no third repair, no completion claim.
8. \`blocked\`, repair-limit, or Stop: stop and explain. Do not invent a generic infinite loop.
</orchestration_discipline>`;

/** Child seed: structured review submit is mandatory. */
export const REVIEWED_DELIVERY_REVIEWER_REPORT_CONTRACT = `<reviewer_contract>
You are an independent reviewer of one Host-bound frozen candidate.

## Mandatory submission
Submit exactly one decision with \`piwin_subagent_review_submit\`. Prose is secondary evidence and never apply authority.

## Decisions
- approved: no blocking finding remains
- changes-requested: repairable findings are present
- blocked: the candidate cannot be responsibly judged or repaired within the current authority/scope
</reviewer_contract>`;

/**
 * Builtin Reviewed Delivery: worker (worktree candidate) + reviewer (readonly).
 * Models inherit the parent unless Settings overlays pin distinct refs.
 */
export const BUILTIN_REVIEWED_DELIVERY_SCHEME: OrchestrationScheme = {
  id: REVIEWED_DELIVERY_SCHEME_ID,
  name: 'Reviewed Delivery',
  description:
    'Built-in delivery loop: worktree worker produces a candidate, readonly reviewer decides, at most two repairs, apply only after approval, then parent verification',
  source: 'builtin',
  defaultRole: REVIEWED_DELIVERY_WORKER_ROLE,
  defaultProfileId: 'implementer',
  exposeSpawnMetadata: false,
  maxConcurrency: 4,
  maxTasksPerRun: 8,
  waitPolicy: 'await-all',
  members: [
    {
      role: REVIEWED_DELIVERY_WORKER_ROLE,
      description: REVIEWED_DELIVERY_WORKER_DESCRIPTION,
      profileId: 'implementer',
      isolation: 'worktree',
      fallback: 'main',
    },
    {
      role: REVIEWED_DELIVERY_REVIEWER_ROLE,
      description: REVIEWED_DELIVERY_REVIEWER_DESCRIPTION,
      profileId: 'reviewer',
      isolation: 'readonly',
      fallback: 'main',
      reportContract: REVIEWED_DELIVERY_REVIEWER_REPORT_CONTRACT,
    },
  ],
  systemPreamble: REVIEWED_DELIVERY_PREAMBLE,
};
