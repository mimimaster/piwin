import type { DatabaseSync } from 'node:sqlite';
import type { SessionTurnSummary, SessionToolCardView } from '@piwin/contracts';
import {
  buildSessionTurnSummaries,
  selectSessionTurnSummaries,
  type TurnSummaryMessage,
} from './transcript-work-summary.js';
import { withActivePath } from './transcript-store-path.js';

type SummaryRow = {
  id: string;
  role: TurnSummaryMessage['role'];
  status: TurnSummaryMessage['status'];
  created_at: string;
  run_id: string | null;
  tools_json: string | null;
  metadata: string | null;
};

/** Read work metadata once per durable revision; never hydrate the complete transcript. */
export function createTranscriptTurnSummaryReader(
  db: DatabaseSync,
  sessionId: string,
): (revision: string, startIndex: number, endIndex: number) => SessionTurnSummary[] {
  let cachedRevision: string | undefined;
  let cached: SessionTurnSummary[] = [];
  function* messages(): Generator<TurnSummaryMessage> {
    const rows = db
      .prepare(
        withActivePath(`
      SELECT transcript_message.id, role, status, created_at, run_id, tools_json,
             json_object('startedAt', json_extract(metadata_json, '$.startedAt'),
                         'endedAt', json_extract(metadata_json, '$.endedAt'),
                         'thinkingStartedAt', json_extract(metadata_json, '$.thinkingStartedAt'),
                         'thinkingEndedAt', json_extract(metadata_json, '$.thinkingEndedAt'),
                         'outcome', json_extract(metadata_json, '$.outcome'),
                         'terminalMessage', json_extract(metadata_json, '$.terminalMessage')) AS metadata
      FROM transcript_message JOIN active_path ON transcript_message.id = active_path.id
      ORDER BY sequence ASC`),
      )
      .iterate(sessionId);
    for (const raw of rows) {
      const row = raw as unknown as SummaryRow;
      const metadata = JSON.parse(row.metadata ?? '{}') as Record<string, unknown>;
      const timing: Partial<TurnSummaryMessage> = {};
      for (const key of [
        'startedAt',
        'endedAt',
        'thinkingStartedAt',
        'thinkingEndedAt',
        'terminalMessage',
      ] as const) {
        const value = metadata[key];
        if (typeof value === 'string') timing[key] = value;
      }
      const outcome = metadata.outcome;
      if (
        outcome === 'completed' ||
        outcome === 'failed' ||
        outcome === 'paused' ||
        outcome === 'cancelled'
      )
        timing.outcome = outcome;
      const tools = JSON.parse(row.tools_json ?? '[]') as SessionToolCardView[];
      yield {
        id: row.id,
        role: row.role,
        status: row.status,
        createdAt: row.created_at,
        ...(row.run_id === null ? {} : { runId: row.run_id }),
        ...timing,
        tools: tools.map((tool) => ({
          status: tool.status,
          ...(tool.presentation
            ? {
                presentation: {
                  ...(tool.presentation.changedPaths
                    ? { changedPaths: tool.presentation.changedPaths }
                    : {}),
                  ...(tool.presentation.targetPaths
                    ? { targetPaths: tool.presentation.targetPaths }
                    : {}),
                  ...(tool.presentation.error ? { error: tool.presentation.error } : {}),
                  ...('targetPath' in tool.presentation
                    ? { targetPath: tool.presentation.targetPath }
                    : {}),
                },
              }
            : {}),
          ...('input' in tool ? { input: tool.input } : {}),
        })),
      };
    }
  }
  return (revision, startIndex, endIndex) => {
    if (revision !== cachedRevision) {
      cached = buildSessionTurnSummaries(messages(), revision);
      cachedRevision = revision;
    }
    return selectSessionTurnSummaries(cached, startIndex, endIndex);
  };
}
