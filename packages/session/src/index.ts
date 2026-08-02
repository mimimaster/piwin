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
  renameSessionRecord,
  setSessionAutoName,
  archiveSessionRecord,
  unarchiveSessionRecord,
  deleteSessionRecord,
  normalizeSessionName,
  listAllSessionRecords,
  sortSessionRecords,
} from './session-index-store.js';
export type {
  ListSessionsForProjectOptions,
  SessionAutoNameSource,
} from './session-index-store.js';
export { deriveDefaultNameFromMessage } from './derive-default-name.js';

export {
  buildDuplicateSessionName,
  cloneTranscriptForDuplicate,
  duplicateProductSession,
} from './duplicate-session.js';
export type {
  DuplicateSessionInput,
  DuplicateSessionPaths,
  DuplicateSessionResult,
} from './duplicate-session.js';

export {
  loadSessionTranscript,
  saveSessionTranscript,
  saveSessionTranscriptAtomic,
  ensureSessionTranscript,
  appendTranscriptMessage,
  patchTranscriptMessage,
  listTranscriptMessages,
  createUserTranscriptMessage,
  createAssistantTranscriptMessage,
  appendToolCard,
  truncateTranscriptFrom,
} from './message-store.js';

export {
  appendUsageRecord,
  loadUsageRecords,
  readUsageRollup,
  computeUsageRollup,
} from './usage-ledger-store.js';
export type { UsageRollupOptions } from './usage-ledger-store.js';

export {
  exportTranscript,
  suggestSessionExportBasename,
  TOOL_OUTPUT_REDACTED_PLACEHOLDER,
} from './export-transcript.js';
export type {
  ExportTranscriptOptions,
  ExportTranscriptResult,
  SessionExportFormat,
} from './export-transcript.js';

export { searchSessions } from './session-search.js';
export type { SessionSearchOptions } from './session-search.js';

export { buildProductHistoryContext, mergeProductHistoryIntoPrompt } from './product-context.js';
export type { ProductHistoryContextOptions } from './product-context.js';

export { buildSessionOutline } from './session-outline.js';

export { validateSessionPlan } from './validate-plan.js';
export type { PlanValidationIssue, PlanValidationResult } from './validate-plan.js';
export { loadSessionPlan, saveSessionPlan, clearSessionPlan } from './plan-store.js';
export {
  classifyPlanComplexity,
  isWithinPlanSizeLimits,
  LONG_PLAN_INDEPENDENT_THRESHOLD,
  LONG_PLAN_STEP_THRESHOLD,
} from './classify-plan.js';

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
  buildSubagentActivityView,
  formatSubagentActivityText,
  mapSubagentStatusToActivityState,
} from './subagent-activity-card.js';

export {
  applyPlanStepUpdate,
  applyPlanStatus,
  markNextPlanStepActive,
  MAX_PLAN_STEP_NOTE_CHARS,
} from './plan-step-updates.js';
