export {
  createSessionRecord,
  getSessionRecord,
  listSessionsForProject,
  loadSessionIndex,
  saveSessionIndex,
  upsertSessionRecord,
  listChildSessions,
  pinSessionRecord,
  unpinSessionRecord,
  listAllSessionRecords,
  sortSessionRecords,
} from './session-index-store.js';

export {
  loadSessionTranscript,
  saveSessionTranscript,
  ensureSessionTranscript,
  appendTranscriptMessage,
  patchTranscriptMessage,
  listTranscriptMessages,
  createUserTranscriptMessage,
  createAssistantTranscriptMessage,
  appendToolCard,
  truncateTranscriptFrom,
} from './message-store.js';

export { searchSessions } from './session-search.js';
export type { SessionSearchOptions } from './session-search.js';

export {
  buildProductHistoryContext,
  mergeProductHistoryIntoPrompt,
} from './product-context.js';
export type { ProductHistoryContextOptions } from './product-context.js';

export { buildSessionOutline } from './session-outline.js';

export { validateSessionPlan } from './validate-plan.js';
export type { PlanValidationIssue, PlanValidationResult } from './validate-plan.js';
export { loadSessionPlan, saveSessionPlan, clearSessionPlan } from './plan-store.js';

export {
  buildSubagentMergeSummary,
  formatSubagentMergeCard,
  MAX_SUBAGENT_SUMMARY_CHARS,
} from './build-subagent-merge-summary.js';
export type {
  SubagentMergeSummaryInput,
  SubagentMergeSummaryResult,
} from './build-subagent-merge-summary.js';

export {
  applyPlanStepUpdate,
  applyPlanStatus,
  markNextPlanStepActive,
  MAX_PLAN_STEP_NOTE_CHARS,
} from './plan-step-updates.js';
