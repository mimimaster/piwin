import {
  parseGoalDisplayPayload,
  readSubagentControlDisplay,
  readSubagentLoopControlDisplay,
  SUBAGENT_CONTROL_MAX_RUNS,
  type GoalDisplayPayload,
  type SubagentControlDisplay,
  type SubagentLoopControlDisplay,
} from '@piwin/contracts';
import { redactRemoteHostPaths } from './remote-redact.js';

// Public presentation only. Never traverse unknown objects or copy receipt data.
const MAX_TEXT = 2_048;
const MAX_ID = 256;
const MAX_COUNT = 1_000_000;

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? redactRemoteHostPaths(value.trim().slice(0, MAX_TEXT)) : undefined;
}
function id(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_ID;
}
function count(value: unknown): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_COUNT;
}
function ref(value: unknown, key: string): boolean {
  const item = record(value);
  return item !== undefined && id(item[key]) && typeof item.revision === 'number'
    && Number.isSafeInteger(item.revision) && item.revision > 0;
}
function optionalRef(value: unknown, key: string): boolean {
  return value === undefined || ref(value, key);
}

export function projectRemoteGoal(value: unknown): GoalDisplayPayload | undefined {
  const source = record(value);
  if (source === undefined) return undefined;
  switch (source.phase) {
    case 'completed': {
      const summary = text(source.summary);
      if (summary === undefined || (source.verification !== undefined && text(source.verification) === undefined)
        || (source.artifacts !== undefined && !Array.isArray(source.artifacts))) return undefined;
      const artifacts = Array.isArray(source.artifacts) ? source.artifacts.slice(0, 24).map(text) : undefined;
      if (artifacts?.some((item) => item === undefined)) return undefined;
      return parseGoalDisplayPayload({ status: source.phase, summary, verification: text(source.verification), artifacts }) ?? undefined;
    }
    case 'blocked':
      if (source.unblockAction !== undefined && text(source.unblockAction) === undefined) return undefined;
      return parseGoalDisplayPayload({ status: source.phase, reason: text(source.reason), unblockAction: text(source.unblockAction) }) ?? undefined;
    case 'waited':
      if (source.durationSeconds !== undefined && (typeof source.durationSeconds !== 'number'
        || !Number.isFinite(source.durationSeconds) || source.durationSeconds < 0 || source.durationSeconds > MAX_COUNT)) return undefined;
      return parseGoalDisplayPayload({ status: source.phase, reason: text(source.reason), durationSeconds: source.durationSeconds }) ?? undefined;
    default:
      return undefined;
  }
}

export function projectRemoteSubagentControl(value: unknown): SubagentControlDisplay | undefined {
  const source = record(value);
  if (source === undefined) return undefined;
  if (source.phase === 'accepted') {
    if (!id(source.runId) || !id(source.invocationId)
      || (source.childSessionId !== undefined && !id(source.childSessionId))
      || !optionalRef(source.predecessorResult, 'resultId') || !optionalRef(source.reviewRef, 'reviewId')) return undefined;
    return readSubagentControlDisplay({
      phase: source.phase, runId: source.runId, invocationId: source.invocationId,
      task: text(source.task), childSessionId: source.childSessionId,
      predecessorResult: source.predecessorResult, reviewRef: source.reviewRef,
    });
  }
  const waiting = source.phase === 'waiting' || source.phase === 'waited';
  const cancelling = source.phase === 'cancelling' || source.phase === 'cancelled';
  if ((!waiting && !cancelling) || !Array.isArray(source.runs)) return undefined;
  const keys = waiting ? ['total', 'completed', 'failed', 'cancelled', 'needsIntegration'] : ['total', 'cancelled', 'alreadyTerminal'];
  if (keys.some((key) => !count(source[key]))) return undefined;
  const runs: Record<string, unknown>[] = [];
  for (const item of source.runs.slice(0, SUBAGENT_CONTROL_MAX_RUNS)) {
    const run = record(item);
    if (run === undefined || !id(run.runId)
      || ['invocationId', 'childSessionId'].some((key) => run[key] !== undefined && !id(run[key]))
      || ['title', 'activity', 'summaryPreview'].some((key) => run[key] !== undefined && text(run[key]) === undefined)) return undefined;
    runs.push({ runId: run.runId, invocationId: run.invocationId, childSessionId: run.childSessionId,
      title: text(run.title), activity: text(run.activity), summaryPreview: text(run.summaryPreview),
      executionStatus: run.executionStatus, summaryStatus: run.summaryStatus, integrationStatus: run.integrationStatus });
  }
  const control = readSubagentControlDisplay({ phase: source.phase, total: source.total,
    completed: source.completed, failed: source.failed, cancelled: source.cancelled,
    needsIntegration: source.needsIntegration, alreadyTerminal: source.alreadyTerminal, runs });
  return control !== undefined && control.phase !== 'accepted' && control.runs.length === runs.length ? control : undefined;
}

export function projectRemoteSubagentLoop(value: unknown): SubagentLoopControlDisplay | undefined {
  const source = record(value);
  if (source === undefined) return undefined;
  // Reject invalid/missing facts before the tolerant public reader can default them.
  switch (source.kind) {
    case 'result-read':
      if (!ref(source.result, 'resultId') || text(source.summary) === undefined) return undefined;
      break;
    case 'review-submit':
      if (!ref(source.target, 'resultId') || !ref(source.reviewRef, 'reviewId')) return undefined;
      break;
    case 'result-apply':
      if (!ref(source.result, 'resultId') || !id(source.operationId)) return undefined;
      break;
    case 'result-discard':
      if (!ref(source.result, 'resultId') || typeof source.alreadySettled !== 'boolean') return undefined;
      break;
    case 'verification-submit':
      if (!ref(source.result, 'resultId') || !ref(source.verificationRef, 'verificationId')) return undefined;
      break;
    default:
      return undefined;
  }
  // The reader constructs fresh known-key refs; raw scope/output/lease keys cannot survive.
  const loop = readSubagentLoopControlDisplay(source.kind === 'result-read'
    ? { kind: source.kind, result: source.result, mode: source.mode, summary: text(source.summary) } : source);
  return loop;
}
