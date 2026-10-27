/**
 * Turn marks for the user-message index: which turns on the active path
 * failed, produced an artifact, hold a compaction boundary, or fork the
 * conversation tree. One aggregate query; only marked turns come back.
 */

import type { DatabaseSync } from 'node:sqlite';
import {
  ARTIFACT_LANGUAGE_ALIASES,
  NATIVE_HTML_ARTIFACT_LANGUAGES,
  NATIVE_SVG_ARTIFACT_LANGUAGES,
  SESSION_USER_MESSAGE_TURN_MARKS,
  type SessionUserMessageTurnMark,
} from '@piwin/contracts';
import { treeVisibleMessage } from './transcript-store-branches.js';
import { withActivePath } from './transcript-store-path.js';

/** Marks per user-message ordinal; turns without marks are absent. */
export type UserMessageTurnMarks = ReadonlyMap<number, readonly SessionUserMessageTurnMark[]>;

/**
 * Text that opens an artifact the transcript renders: a fence in any artifact
 * language, or the tag form the artifact parser recovers. A cheap substring
 * test, not a parse — a mark only steers navigation.
 */
const ARTIFACT_OPENERS: readonly string[] = [
  ...[...ARTIFACT_LANGUAGE_ALIASES, ...NATIVE_HTML_ARTIFACT_LANGUAGES, ...NATIVE_SVG_ARTIFACT_LANGUAGES].map(
    (language) => `\`\`\`${language}`,
  ),
  ...ARTIFACT_LANGUAGE_ALIASES.map((language) => `<${language}`),
];

/**
 * Every opener names an html or svg language, so two scans for those stems
 * rule out almost every reply before the per-opener checks run (twelve full
 * scans of every reply dominated the query on long sessions).
 */
const ARTIFACT_STEMS = ['htm', 'svg'] as const;

const containsText = (): string => 'instr(CAST(message.text AS BLOB), CAST(? AS BLOB)) > 0';

// Byte search (BLOB) skips UTF-8 character counting; CASE keeps user rows
// out of the scan (a plain AND evaluates both sides).
const ARTIFACT_FLAG = `CASE WHEN message.role = 'assistant' THEN (${ARTIFACT_STEMS.map(containsText).join(
  ' OR ',
)}) AND (${ARTIFACT_OPENERS.map(containsText).join(' OR ')}) ELSE 0 END`;

type TurnMarkRow = {
  ordinal: number;
  error: number;
  compaction: number;
  branch: number;
  artifact: number;
};

/**
 * Marks read once per transcript state. The key must change whenever a mark
 * can: row writes and branch switches bump the transcript revision; recorded
 * compactions do not, so they are part of the key too.
 */
export function createTranscriptTurnMarksReader(
  db: DatabaseSync,
  sessionId: string,
): (revision: string) => UserMessageTurnMarks {
  let cachedKey: string | undefined;
  let cached: UserMessageTurnMarks = new Map();
  return (revision) => {
    const compactions = db
      .prepare(
        'SELECT COUNT(*) AS count, MAX(created_at) AS latest FROM session_compaction WHERE session_id = ?',
      )
      .get(sessionId) as { count: number; latest: string | null };
    const key = `${revision}:${compactions.count}:${compactions.latest ?? ''}`;
    if (key !== cachedKey) {
      cached = readUserMessageTurnMarks(db, sessionId);
      cachedKey = key;
    }
    return cached;
  };
}

export function readUserMessageTurnMarks(db: DatabaseSync, sessionId: string): UserMessageTurnMarks {
  // Rows before the first user message (a system preamble) belong to turn 0.
  // Unmarked non-user rows are dropped before the window sum; they never
  // change a turn ordinal.
  const rows = db
    .prepare(
      withActivePath(
        // Walk the path, then look rows up (CROSS JOIN pins that order; the
        // planner otherwise scans every stored row, branches included), and
        // materialize the narrow flags once so the filter below does not
        // re-run the per-row subqueries. Both cut ~10× on long sessions.
        `, path_rows AS MATERIALIZED (
         SELECT message.sequence,
                message.role = 'user' AND length(trim(message.text)) > 0 AS opens_turn,
                message.role = 'assistant' AND (
                  message.status = 'error'
                  OR json_extract(message.metadata_json, '$.outcome') = 'failed'
                ) AS error,
                EXISTS (
                  SELECT 1 FROM session_compaction AS compaction
                  WHERE compaction.session_id = ? AND compaction.anchor_message_id = message.id
                ) AS compaction,
                EXISTS (
                  SELECT 1 FROM transcript_message AS sibling
                  WHERE sibling.parent_message_id IS message.parent_message_id
                    AND sibling.id <> message.id
                    AND ${treeVisibleMessage('sibling')}
                ) AS branch,
                ${ARTIFACT_FLAG} AS artifact
         FROM active_path
         CROSS JOIN transcript_message AS message ON message.id = active_path.id
       ), turn_rows AS (
         SELECT SUM(opens_turn) OVER (ORDER BY sequence) - 1 AS turn_ordinal,
                error, compaction, branch, artifact
         FROM path_rows
         WHERE error OR compaction OR branch OR artifact OR opens_turn
       )
       SELECT MAX(turn_ordinal, 0) AS ordinal,
              MAX(error) AS error, MAX(compaction) AS compaction,
              MAX(branch) AS branch, MAX(artifact) AS artifact
       FROM turn_rows
       GROUP BY 1
       HAVING MAX(error) OR MAX(compaction) OR MAX(branch) OR MAX(artifact)
       ORDER BY 1`,
      ),
    )
    .all(sessionId, sessionId, ...ARTIFACT_STEMS, ...ARTIFACT_OPENERS) as unknown as TurnMarkRow[];
  const marks = new Map<number, SessionUserMessageTurnMark[]>();
  for (const row of rows) {
    const turnMarks = SESSION_USER_MESSAGE_TURN_MARKS.filter((mark) => row[mark] > 0);
    if (turnMarks.length > 0) marks.set(row.ordinal, turnMarks);
  }
  return marks;
}

/** Union of the marks of every turn in an inclusive ordinal span, in display order. */
export function collectSpanTurnMarks(
  marks: UserMessageTurnMarks,
  spanStartOrdinal: number,
  spanEndOrdinal: number,
): SessionUserMessageTurnMark[] {
  const found = new Set<SessionUserMessageTurnMark>();
  if (spanEndOrdinal - spanStartOrdinal + 1 <= marks.size) {
    for (let ordinal = spanStartOrdinal; ordinal <= spanEndOrdinal; ordinal += 1) {
      for (const mark of marks.get(ordinal) ?? []) found.add(mark);
    }
  } else {
    for (const [ordinal, turnMarks] of marks) {
      if (ordinal < spanStartOrdinal || ordinal > spanEndOrdinal) continue;
      for (const mark of turnMarks) found.add(mark);
    }
  }
  return SESSION_USER_MESSAGE_TURN_MARKS.filter((mark) => found.has(mark));
}
