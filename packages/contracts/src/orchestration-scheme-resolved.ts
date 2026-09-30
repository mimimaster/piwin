import type { ModelRef, ThinkingLevel } from './host.js';
import type { SubagentIsolationMode } from './subagent.js';
import type {
  OrchestrationMemberBehavior,
  OrchestrationMemberFallback,
  OrchestrationMemberRef,
  OrchestrationScheme,
  OrchestrationWaitPolicy,
} from './orchestration-scheme-types.js';

/** Resolved roster row after migrate + validation. */
export type ResolvedOrchestrationMember = {
  role: string;
  description: string;
  profileId?: string;
  model?: ModelRef;
  thinkingLevel?: ThinkingLevel;
  isolation?: SubagentIsolationMode;
  fallback: OrchestrationMemberFallback;
  available: boolean;
  unavailableReason?: string;
  reportContract?: string;
  /** Member this row took its recipe from (Settings shows it read-only). */
  inheritedFrom?: OrchestrationMemberRef;
  behavior?: OrchestrationMemberBehavior;
};

export type ResolvedOrchestrationScheme = {
  schemeId: string;
  scheme: OrchestrationScheme;
  /** Effective default profile (from default member profileId or v1 field). */
  defaultProfileId: string;
  /** Effective default role for soft-generic / omitted role. */
  defaultRole: string;
  members: ResolvedOrchestrationMember[];
  exposeSpawnMetadata: boolean;
  maxConcurrency: number;
  maxTasksPerRun: number;
  waitPolicy: OrchestrationWaitPolicy;
  maxSubagentThinkingLevel?: ThinkingLevel;
  systemPreamble: string;
};

const THINKING_RANK: Readonly<Record<ThinkingLevel, number>> = {
  off: 0,
  minimal: 1,
  low: 2,
  medium: 3,
  high: 4,
  xhigh: 5,
  max: 6,
  ultra: 7,
};

/** Compare thinking levels for clamp (lower rank = less effort). */
export function compareThinkingLevel(left: ThinkingLevel, right: ThinkingLevel): number {
  return THINKING_RANK[left] - THINKING_RANK[right];
}

/** Clamp a thinking level so it does not exceed a scheme ceiling. */
export function clampThinkingLevelToMax(
  value: ThinkingLevel | undefined,
  maximum: ThinkingLevel | undefined,
): ThinkingLevel | undefined {
  if (value === undefined) {
    return maximum;
  }
  if (maximum === undefined) {
    return value;
  }
  return compareThinkingLevel(value, maximum) <= 0 ? value : maximum;
}

/** Child seed contract (Codex agents/default.toml analogue). */
export const ULTRA_CODE_SCOUT_REPORT_CONTRACT = `<scout_contract>
You are a one-shot read-only scout. Explore and gather verifiable evidence for the parent agent.

## Constraints
- Read-only: Never edit files, execute mutating commands, or spawn child agents.
- Zero chatter: No conversational preamble, reasoning recap, or whole-file dumping.

## Output Format
Line 1: exactly one of complete | partial | blocked
Body:
- Key findings with exact \`file:line\` citations, symbol signatures, and verbatim quotes.
- Distinguish verified facts from inferences. For negative results, state queried paths/terms.
- If partial/blocked, state explicitly what was covered and the blocker encountered.
</scout_contract>`;

export const PIWIN_REPORT_CONTRACT_MARKER = '[piwin-report-contract]';

/** Wrap a member report contract for the child's first user message. */
export function formatSubagentReportContractBlock(contract: string | undefined): string | undefined {
  const trimmed = contract?.trim();
  if (!trimmed) return undefined;
  return `${PIWIN_REPORT_CONTRACT_MARKER}\n${trimmed}\nYour last assistant message must follow this contract. The parent only reads that message.`;
}

/** True when an assistant message follows a scheme report-contract first line. */
export function isSubagentReportContractMessage(text: string): boolean {
  return /^(complete|partial|blocked|done|escalate|pass|fail)\b/i.test(text.trim());
}
