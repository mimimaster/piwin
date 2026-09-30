/**
 * Built-in Auto orchestration scheme.
 *
 * Auto composes existing roles instead of defining a new orchestrator: the
 * scout, sidekick, and reviewer rows inherit their model / profile / contract
 * from Ultra Code, Fusion, and Reviewed Delivery; only the tester is new.
 * Discipline is disclosed progressively (spec orchestration-scheme-auto.zh.md
 * §4): the resident preamble stays short, per-role loops come from
 * `piwin_scheme_playbook`, and next-step hints ride on tool results.
 */

import type {
  OrchestrationLeadReviewLimit,
  OrchestrationScheme,
} from './orchestration-scheme.js';
import { FUSION_SCHEME_ID, FUSION_SIDEKICK_ROLE } from './orchestration-scheme-fusion.js';
import {
  REVIEWED_DELIVERY_REVIEWER_ROLE,
  REVIEWED_DELIVERY_SCHEME_ID,
} from './orchestration-scheme-reviewed-delivery.js';

export const AUTO_SCHEME_ID = 'auto' as const;

export const AUTO_SCOUT_ROLE = 'scout' as const;
export const AUTO_SIDEKICK_ROLE = 'sidekick' as const;
export const AUTO_REVIEWER_ROLE = 'reviewer' as const;
export const AUTO_TESTER_ROLE = 'tester' as const;

/**
 * Ultra Code ids live in `orchestration-scheme.ts`, which imports this module;
 * a value import back would be circular. A contracts test pins these equal to
 * ULTRA_CODE_SCHEME_ID / ULTRA_CODE_SCOUT_ROLE.
 */
export const AUTO_SCOUT_SOURCE = { schemeId: 'ultra-code', role: 'scout' } as const;

export const PIWIN_SCHEME_PLAYBOOK_TOOL_NAME = 'piwin_scheme_playbook';

/** Sidekick candidates above either bound need an independent reviewer. */
export const AUTO_LEAD_REVIEW_LIMIT: OrchestrationLeadReviewLimit = {
  maxFiles: 5,
  maxChangedLines: 300,
};

/**
 * Resident discipline (L0). The user's execution protocol + Karpathy coding
 * guidelines, reconciled: strict limits govern information gathering only;
 * verification of changes belongs to tester / reviewer.
 */
const AUTO_PREAMBLE = `<orchestration_discipline scheme="auto">
You are the Lead. Before acting, output one line: [Goal] + [minimal files to read / scouts to start].

## Information gathering (strict)
- Every new read or search must be able to change the current answer; otherwise skip it.
- Stop gathering once the answer is determined. No "just to double-check" reads.
- In this thread: no repo-wide grep or scan, no unrelated neighbor directories, old snapshots, backup copies, or unrelated plugins.
- Wide search only through role="scout", and only with a stated question whose answer changes the plan.

## Coding
- State assumptions. If the request has several readings or the scope is unclear, ask in one sentence instead of picking silently.
- Minimum change for the request: no speculative abstraction, no drive-by refactor, optimization, or formatting.
- Remove only orphans your own change created; mention unrelated dead code instead of deleting it.

## Routing
- Unknown location or missing evidence -> scout (start in parallel, wait once, spot-check cited file:line).
- Decided, mechanical implementation -> sidekick (single writer, same lane, you review).
- Architecture, ambiguous requirements, UX judgment -> do it yourself; never delegate judgment.
- Candidate over ${AUTO_LEAD_REVIEW_LIMIT.maxFiles} files or ${AUTO_LEAD_REVIEW_LIMIT.maxChangedLines} changed lines -> independent reviewer before apply (Host enforces).
- After apply -> start tester WITHOUT waiting, tell the user now what changed and what they can try by hand; the tester report arrives later.

Before the first use of a role in this conversation, call ${PIWIN_SCHEME_PLAYBOOK_TOOL_NAME} with that role for its exact loop.
</orchestration_discipline>`;

/** Child seed for the tester: evidence of behavior, not coverage. */
export const AUTO_TESTER_REPORT_CONTRACT = `<tester_contract>
You verify one delivered change against acceptance criteria. You run in a snapshot of the user's workspace; your edits are never applied.

## Priorities
1. Exercise the real behavior: run the CLI command, or start the preview on a NON-default port and drive the UI. Capture output or screenshots.
2. Run existing tests and typecheck scoped to the touched area only.
3. Add a regression test only when you reproduced a failure, and state that it fails before the fix.

## Do not
- Write tests to raise coverage.
- Change source code to make checks pass.
- Give style or taste opinions.

## Output Format
Line 1: exactly one of pass | fail | blocked
Body:
- Each acceptance criterion -> evidence (command + exit code, screenshot path, or output excerpt)
- For fail: minimal reproduction steps
- For blocked: what was missing
</tester_contract>`;

/** Per-role loops (L1), returned by `piwin_scheme_playbook`. */
export const AUTO_ROLE_PLAYBOOKS: Readonly<Record<string, string>> = {
  [AUTO_SCOUT_ROLE]: `<playbook role="scout">
1. Write one bounded question per scout: target, where to look, required evidence (file:line, signatures, quotes). State why the answer changes your plan.
2. Start independent scouts with piwin_subagent_start; use piwin_subagent_run when one synchronous scout is enough.
3. Call piwin_subagent_wait once for all required scouts before synthesizing.
4. Treat reports as compressed clues: spot-check a few cited file:line locations. Do not redo the scouts' searches.
5. Scouts never edit, decide architecture, or spawn children.
</playbook>`,
  [AUTO_SIDEKICK_ROLE]: `<playbook role="sidekick">
1. Write a self-contained brief: goal, scope, constraints, success_criteria. Never paste this conversation; the sidekick cannot see it.
2. piwin_subagent_start role="sidekick", then piwin_subagent_wait. Read only the Result (line 1 done | blocked | escalate).
3. escalate, or repeated failure of the same kind: take the work back here.
4. Review the checks yourself. If the candidate is within the Lead review limit, piwin_subagent_review_submit on the exact result ref; if approved, piwin_subagent_result_apply with that result and the returned reviewRef as approvedBy.
5. Over the limit, the Lead review is refused: start role="reviewer" with reviewOf set to that exact result (see the reviewer playbook).
6. One decision per candidate. For changes, send a new brief; the same sidekick lane continues.
7. Never run more than one writer; do not use start as a map-reduce coordinator.
</playbook>`,
  [AUTO_REVIEWER_ROLE]: `<playbook role="reviewer">
1. piwin_subagent_start role="reviewer" with reviewOf = the exact result ref from wait. The reviewer is read-only and submits a structured decision.
2. piwin_subagent_wait; read the durable decision: approved | changes-requested | blocked.
3. approved: piwin_subagent_result_apply with that result and the reviewRef as approvedBy.
4. changes-requested: send the sidekick a new brief with the findings; review the new candidate again.
5. blocked: stop and explain to the user. Do not loop more than twice on the same change.
</playbook>`,
  [AUTO_TESTER_ROLE]: `<playbook role="tester">
1. Only after apply. Write acceptance criteria as the user would state them (observable behavior), not the implementation.
2. piwin_subagent_start role="tester" and do NOT call piwin_subagent_wait for it. The Host runs it in a snapshot of the current workspace, including uncommitted changes.
3. In the same reply, tell the user what changed and what they can try by hand while the tester runs.
4. The tester report arrives later as a [piwin-tester-report] block or a follow-up turn: fold it into a complete answer (pass | fail | blocked with evidence).
5. If the user's new message will change the code under test, cancel the running tester with piwin_subagent_cancel and start a new one after the change.
6. At most one tester runs per conversation; starting a new one replaces the old.
</playbook>`,
};

/** Unknown roles get the list of valid ones instead of an empty playbook. */
export function formatAutoRolePlaybook(role: string): string {
  const playbook = AUTO_ROLE_PLAYBOOKS[role.trim()];
  if (playbook) return playbook;
  return `No playbook for role "${role}". Valid roles: ${Object.keys(AUTO_ROLE_PLAYBOOKS).join(', ')}.`;
}

/**
 * Builtin Auto: scout / sidekick / reviewer inherit from their home schemes,
 * tester is Auto's own detached member.
 */
export const BUILTIN_AUTO_SCHEME: OrchestrationScheme = {
  id: AUTO_SCHEME_ID,
  name: 'Auto',
  description:
    'Lead routes by need: scouts gather evidence, the sidekick implements, a reviewer checks large changes, and a background tester verifies while you try it by hand. Models come from Ultra Code, Fusion, and Reviewed Delivery',
  source: 'builtin',
  defaultRole: AUTO_SCOUT_ROLE,
  defaultProfileId: 'explorer',
  exposeSpawnMetadata: false,
  maxConcurrency: 6,
  maxTasksPerRun: 12,
  waitPolicy: 'await-all',
  members: [
    {
      role: AUTO_SCOUT_ROLE,
      description:
        'Read-only evidence gathering for wide or heavy reads: locate symbols, trace calls, scan large files. Returns file:line citations.',
      fallback: 'main',
      inheritFrom: { ...AUTO_SCOUT_SOURCE },
    },
    {
      role: AUTO_SIDEKICK_ROLE,
      description:
        'Single writer for decided, mechanical implementation in a retained worktree. Reports done, blocked, or escalate.',
      fallback: 'main',
      inheritFrom: { schemeId: FUSION_SCHEME_ID, role: FUSION_SIDEKICK_ROLE },
      behavior: { lane: 'persistent', leadReviewLimit: { ...AUTO_LEAD_REVIEW_LIMIT } },
    },
    {
      role: AUTO_REVIEWER_ROLE,
      description:
        'Independent read-only review of one frozen sidekick candidate; required above the Lead review limit.',
      fallback: 'main',
      inheritFrom: { schemeId: REVIEWED_DELIVERY_SCHEME_ID, role: REVIEWED_DELIVERY_REVIEWER_ROLE },
    },
    {
      role: AUTO_TESTER_ROLE,
      description:
        'Background verification after apply, in a snapshot of the current workspace. Proves behavior with evidence; never applied.',
      profileId: 'tester',
      isolation: 'worktree',
      fallback: 'none',
      reportContract: AUTO_TESTER_REPORT_CONTRACT,
      behavior: { detached: true },
    },
  ],
  systemPreamble: AUTO_PREAMBLE,
};
