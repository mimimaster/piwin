/**
 * `session/handoff`: distill a session into a summary and open a new empty
 * session that carries it as a context ref. The source session is not changed.
 *
 * Reuses the compact-export snapshot (ADR 0035) as the only summarizer; the
 * new session is created lazily like `session/create`, so no runtime starts
 * until the user sends the first prompt.
 */
import { rm } from 'node:fs/promises';
import type {
  HandoffSessionOrigin,
  HostCommand,
  HostResponse,
  SessionCompactResult,
  SessionHandoffContextRef,
  SessionHandoffData,
  SessionHandoffRefusedProblem,
  SessionHandoffRefusedReason,
  SessionHandoffSummaryData,
  SessionHandoffSummaryMissingProblem,
} from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import { deleteSessionRecord, getSessionRecord, updateSessionRecord } from '@piwin/session';
import { persistDurableSessionRecord } from '../durable-session-record.js';
import { getPiwinRoot, getPiwinSessionDir, getPiwinSessionIndexPath } from '../paths.js';
import { createProductSessionId } from '../product-agent-host.js';
import { fail, ok } from '../response-helpers.js';
import { rejectUnavailableSessionBody } from '../session-body-guard.js';
import { readStoredHandoffSummary, writeSessionHandoffSummary } from '../session-handoff-store.js';
import { SummaryModelError } from '../summary-model-error.js';
import { sessionIndexUpdatedPush } from '../session-index-push.js';
import { indexRecordToSummary } from '../session-summary-map.js';
import {
  SNAPSHOT_COMPACTION_ACTIVE_MESSAGE,
  SNAPSHOT_COMPACTION_CANCELLED_MESSAGE,
  SNAPSHOT_COMPACTION_EMPTY_MESSAGE,
  compactTranscriptSnapshot,
} from './compaction-live.js';
import type { SessionLiveContext } from './session-live-context.js';

type HandoffCommand = Extract<HostCommand, { type: 'session/handoff' }>;
type HandoffSummaryCommand = Extract<HostCommand, { type: 'session/handoff-summary' }>;

export const SESSION_HANDOFF_CONTEXT_LABEL = 'Handoff summary';

/** Steers the shared compaction prompt toward what a fresh session needs to continue. */
export const SESSION_HANDOFF_INSTRUCTIONS = [
  'This summary hands the work off to a new session that has none of this history.',
  'Write it so that session can continue immediately. Cover: the goal; the current state;',
  'key decisions and why; files and commands that matter; open problems; concrete next steps.',
  'Keep exact paths, identifiers and error messages. Leave out finished detours.',
].join(' ');

function snapshotRefusalReason(message: string): SessionHandoffRefusedReason | undefined {
  switch (message) {
    case SNAPSHOT_COMPACTION_CANCELLED_MESSAGE:
      return 'cancelled';
    case SNAPSHOT_COMPACTION_EMPTY_MESSAGE:
      return 'empty-transcript';
    case SNAPSHOT_COMPACTION_ACTIVE_MESSAGE:
      return 'already-running';
    default:
      return undefined;
  }
}

function refuse(
  requestId: string | undefined,
  message: string,
  reason: SessionHandoffRefusedReason,
): HostResponse {
  const problem: SessionHandoffRefusedProblem = { code: 'session-handoff-refused', data: { reason } };
  return fail(requestId, 'session/handoff', message, problem);
}

export function buildHandoffSessionName(sourceName: string | undefined, sourceId: string): string {
  return `Handoff · ${sourceName ?? `session-${sourceId.slice(0, 8)}`}`;
}

export async function handleSessionHandoffCommand(
  command: HandoffCommand,
  requestId: string | undefined,
  context: SessionLiveContext,
): Promise<HostResponse> {
  const rootDir = getPiwinRoot(context.piwinRoot);
  const indexPath = getPiwinSessionIndexPath(rootDir);
  const source = await getSessionRecord(indexPath, command.sessionId);
  if (!source) {
    return fail(requestId, 'session/handoff', `Unknown session: ${command.sessionId}`);
  }
  const unavailable = rejectUnavailableSessionBody(requestId, 'session/handoff', source, 'handoff');
  if (unavailable) return unavailable;
  if (source.isArchived === true) {
    return refuse(requestId, 'Source session is archived', 'archived');
  }

  const focus = command.instructions?.trim();
  let result: SessionCompactResult;
  try {
    result = await compactTranscriptSnapshot(
      context,
      source,
      focus ? `${SESSION_HANDOFF_INSTRUCTIONS}\nFocus: ${focus}` : SESSION_HANDOFF_INSTRUCTIONS,
    );
  } catch (error) {
    if (error instanceof SummaryModelError) {
      return fail(requestId, 'session/handoff', error.message, error.toProblem());
    }
    throw error;
  }
  const summary = result.summary?.trim() ?? '';
  if (!result.ok) {
    const message = result.message ?? 'Handoff summary failed';
    const reason = snapshotRefusalReason(message);
    return reason
      ? refuse(requestId, message, reason)
      : fail(requestId, 'session/handoff', message);
  }
  if (summary.length === 0) {
    return refuse(requestId, 'Handoff summary was empty', 'empty-summary');
  }

  const sessionId = createProductSessionId();
  try {
    await persistDurableSessionRecord({
      rootDir,
      indexPath,
      sessionId,
      projectPath: source.projectPath,
      sessionName: buildHandoffSessionName(source.name, source.id),
      lineage: { kind: 'main', depth: 0 },
      ...(source.model ? { model: source.model } : {}),
      ...(source.thinkingLevel !== undefined ? { thinkingLevel: source.thinkingLevel } : {}),
      ...(source.knowledgeBaseIds ? { knowledgeBaseIds: source.knowledgeBaseIds } : {}),
      ...(source.disabledMcpServerIds ? { disabledMcpServerIds: source.disabledMcpServerIds } : {}),
    });
    await writeSessionHandoffSummary(rootDir, sessionId, summary);
    const origin: HandoffSessionOrigin = {
      kind: 'handoff',
      sourceSessionId: source.id,
      ...(source.name ? { sourceSessionNameSnapshot: source.name } : {}),
      createdAt: new Date().toISOString(),
    };
    const record = await updateSessionRecord(indexPath, sessionId, (draft) => {
      draft.origin = origin;
      // Same place to work in: a custom cwd or general scope is not derivable
      // from projectPath alone.
      if (source.scope) draft.scope = source.scope;
      if (source.workingDirectory) draft.workingDirectory = source.workingDirectory;
      if (source.orchestrationSchemeId) draft.orchestrationSchemeId = source.orchestrationSchemeId;
      if (source.delegationDisabled !== undefined)
        draft.delegationDisabled = source.delegationDisabled;
    });
    if (!record) {
      throw new Error(`Handoff session record disappeared: ${sessionId}`);
    }
    const session = indexRecordToSummary(record);
    context.pushStatus();
    context.push(sessionIndexUpdatedPush({ op: 'created', sessionId, session }));
    const contextRef: SessionHandoffContextRef = {
      kind: 'session-handoff',
      sessionId,
      sourceSessionId: source.id,
      label: SESSION_HANDOFF_CONTEXT_LABEL,
    };
    const data: SessionHandoffData = {
      sessionId,
      sourceSessionId: source.id,
      session,
      origin,
      contextRef,
      summaryChars: summary.length,
    };
    return ok(requestId, 'session/handoff', data);
  } catch (error) {
    // No half-handoff: a session without its summary would look like a plain new chat.
    const errors = [formatError(error)];
    try {
      await deleteSessionRecord(indexPath, sessionId);
    } catch (cleanupError) {
      errors.push(`Session record cleanup failed: ${formatError(cleanupError)}`);
    }
    try {
      await rm(getPiwinSessionDir(rootDir, sessionId), { recursive: true, force: true });
    } catch (cleanupError) {
      errors.push(`Session files cleanup failed: ${formatError(cleanupError)}`);
    }
    return fail(requestId, 'session/handoff', `Handoff failed: ${errors.join('; ')}`);
  }
}

/** Read the summary the chip previews. Same cap as prompt injection. */
export async function handleSessionHandoffSummaryCommand(
  command: HandoffSummaryCommand,
  requestId: string | undefined,
  context: SessionLiveContext,
): Promise<HostResponse> {
  const rootDir = getPiwinRoot(context.piwinRoot);
  const indexPath = getPiwinSessionIndexPath(rootDir);
  const session = await getSessionRecord(indexPath, command.sessionId);
  if (!session) {
    return fail(requestId, 'session/handoff-summary', `Unknown session: ${command.sessionId}`);
  }
  const stored = await readStoredHandoffSummary(rootDir, command.sessionId);
  if (!stored) {
    const problem: SessionHandoffSummaryMissingProblem = { code: 'session-handoff-summary-missing' };
    return fail(requestId, 'session/handoff-summary', 'Handoff summary is missing', problem);
  }
  const data: SessionHandoffSummaryData = {
    sessionId: command.sessionId,
    summary: stored.summary,
    truncated: stored.truncated,
  };
  return ok(requestId, 'session/handoff-summary', data);
}
