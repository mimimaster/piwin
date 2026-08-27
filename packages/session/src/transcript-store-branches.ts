/**
 * Branch writes for the conversation tree (ADR 0055).
 *
 * The tree authority lives in this store: rows carry `parent_message_id`,
 * `transcript_meta` carries the one active leaf, and every leaf move bumps
 * both the transcript revision and the user-message revision so open page
 * cursors and user indexes go stale instead of mixing branches.
 *
 * `truncateFrom` is subtree deletion (the explicit "delete from here"
 * gesture) — the non-destructive daily path is rebase + append.
 */

import { rollback } from './sqlite-errors.js';
import { validatePositiveBoundedInteger } from './transcript-store-bounds.js';
import { countPathRows, withActivePath } from './transcript-store-path.js';
import { type MessageRow, rowToMessage } from './transcript-store-rows.js';
import type { SessionTranscriptStore, TranscriptStoreCore } from './transcript-store.js';

/**
 * Local shapes until the contracts stage lifts them into `@piwin/contracts`
 * (`TranscriptBranchPoint` / `TranscriptBranchSibling`); keep field-compatible.
 */
export type TranscriptBranchSibling = {
  /** First message of the branch (the row whose parent is the anchor). */
  headMessageId: string;
  /** Bounded preview of the head message text. */
  preview: string;
  /** Bounded preview of the direct assistant reply to the fork prompt, if any. */
  responsePreview?: string | undefined;
  /** Status of the direct reply / first assistant response. */
  responseStatus?: 'done' | 'error' | 'streaming' | 'interrupted' | undefined;
  /** Bounded preview of the deepest message of the branch. */
  leafPreview: string;
  /** Rows in the branch subtree. */
  messageCount: number;
  /** Any row in the branch subtree recorded workspace writes (ADR 0055 §6.1). */
  writesWorkspace: boolean;
  /** Newest `created_at` in the branch subtree. */
  updatedAt: string;
};

export type TranscriptBranchPoint = {
  /** Shared parent of the sibling heads; null when the fork is at the root. */
  anchorMessageId: string | null;
  /** Shared prompt text if anchor or sibling head is a user prompt. */
  promptPreview?: string | undefined;
  /** Index of the active branch within `siblings` (sequence order). */
  activeIndex: number;
  siblings: TranscriptBranchSibling[];
};

const MAX_PREVIEW_CHARS = 500;

/** Subtree of one message (inclusive). Consumes one bind param: the head id. */
const SUBTREE_CTE = `WITH RECURSIVE subtree(id) AS (
  SELECT id FROM transcript_message WHERE id = ?
  UNION ALL
  SELECT m.id FROM transcript_message m JOIN subtree s ON m.parent_message_id = s.id
)`;

/**
 * Ancestors of one message (inclusive, leaf → root). Chains onto the
 * active-path CTE via {@link withActivePath}; consumes one bind param (the
 * message id) after the session id.
 */
const TARGET_ANCESTORS_CTE = `, target_ancestors(id) AS (
  SELECT id FROM transcript_message WHERE id = ?
  UNION ALL
  SELECT m.parent_message_id FROM transcript_message m
  JOIN target_ancestors t ON m.id = t.id
  WHERE m.parent_message_id IS NOT NULL
)`;

const MESSAGE_COLUMNS = `sequence, transcript_message.id AS id, runtime_generation_id,
        backend_message_id, role, text, thinking, status, created_at, run_id,
        model_json, attachments_json, context_refs_json, tools_json, metadata_json`;

export function createTranscriptBranchesOps(
  core: TranscriptStoreCore,
): Pick<
  SessionTranscriptStore,
  | 'getActiveLeaf'
  | 'getParentMessageId'
  | 'rebaseActiveLeaf'
  | 'switchActiveBranch'
  | 'listAbandonedAssistantRows'
  | 'listBranchPoints'
  | 'truncateFrom'
> {
  const { db, options, ensureOpen, bumpRevision } = core;

  function readActiveLeaf(): string | null {
    const row = db
      .prepare('SELECT active_leaf_message_id FROM transcript_meta WHERE session_id = ?')
      .get(options.sessionId) as { active_leaf_message_id: string | null } | undefined;
    return row?.active_leaf_message_id ?? null;
  }

  function setActiveLeaf(messageId: string | null): void {
    db.prepare(
      'UPDATE transcript_meta SET active_leaf_message_id = ? WHERE session_id = ?',
    ).run(messageId, options.sessionId);
  }

  function messageExists(messageId: string): boolean {
    return db.prepare('SELECT 1 FROM transcript_message WHERE id = ?').get(messageId) !== undefined;
  }

  /** Deepest node of a subtree: childless, highest sequence (switch target). */
  function deepestOfSubtree(headMessageId: string): string {
    const row = db
      .prepare(
        `${SUBTREE_CTE}
         SELECT m.id AS id FROM transcript_message m
         JOIN subtree s ON m.id = s.id
         WHERE NOT EXISTS (
           SELECT 1 FROM transcript_message c WHERE c.parent_message_id = m.id
         )
         ORDER BY m.sequence DESC LIMIT 1`,
      )
      .get(headMessageId) as { id: string } | undefined;
    // The head itself is childless when it has no descendants, so a row
    // always exists for a valid head.
    if (row === undefined) {
      throw new Error(`Branch subtree for message ${headMessageId} is unexpectedly empty`);
    }
    return row.id;
  }

  function subtreeStats(headMessageId: string, previewChars: number): {
    messageCount: number;
    updatedAt: string;
    leafPreview: string;
    responsePreview?: string | undefined;
    responseStatus?: 'done' | 'error' | 'streaming' | 'interrupted' | undefined;
    writesWorkspace: boolean;
  } {
    const headRow = db
      .prepare(
        'SELECT role, status, substr(text, 1, ?) AS preview FROM transcript_message WHERE id = ?',
      )
      .get(previewChars, headMessageId) as
      | { role: string; status: string; preview: string }
      | undefined;

    let responsePreview: string | undefined;
    let responseStatus: 'done' | 'error' | 'streaming' | 'interrupted' | undefined;

    if (headRow?.role === 'assistant') {
      responsePreview = headRow.preview;
      if (
        headRow.status === 'done' ||
        headRow.status === 'error' ||
        headRow.status === 'streaming' ||
        headRow.status === 'interrupted'
      ) {
        responseStatus = headRow.status;
      }
    } else {
      const directChild = db
        .prepare(
          `SELECT role, status, substr(text, 1, ?) AS preview FROM transcript_message
           WHERE parent_message_id = ? AND role = 'assistant'
           ORDER BY sequence ASC LIMIT 1`,
        )
        .get(previewChars, headMessageId) as
        | { role: string; status: string; preview: string }
        | undefined;
      if (directChild) {
        responsePreview = directChild.preview;
        if (
          directChild.status === 'done' ||
          directChild.status === 'error' ||
          directChild.status === 'streaming' ||
          directChild.status === 'interrupted'
        ) {
          responseStatus = directChild.status;
        }
      }
    }

    // Presence of the metadata key is enough: the recorder only persists
    // `workspaceWrites` when a write was actually detected, never an empty set.
    const stats = db
      .prepare(
        `${SUBTREE_CTE}
         SELECT COUNT(*) AS message_count, MAX(m.created_at) AS updated_at,
                MAX(CASE
                      WHEN json_extract(m.metadata_json, '$.workspaceWrites') IS NULL THEN 0
                      ELSE 1
                    END) AS writes_workspace
         FROM transcript_message m JOIN subtree s ON m.id = s.id`,
      )
      .get(headMessageId) as {
      message_count: number;
      updated_at: string;
      writes_workspace: number | null;
    };
    const leaf = db
      .prepare(
        `${SUBTREE_CTE}
         SELECT substr(m.text, 1, ?) AS preview FROM transcript_message m
         JOIN subtree s ON m.id = s.id
         WHERE NOT EXISTS (
           SELECT 1 FROM transcript_message c WHERE c.parent_message_id = m.id
         )
         ORDER BY m.sequence DESC LIMIT 1`,
      )
      .get(headMessageId, previewChars) as { preview: string } | undefined;
    return {
      messageCount: stats.message_count,
      updatedAt: stats.updated_at,
      leafPreview: leaf?.preview ?? '',
      responsePreview,
      responseStatus,
      writesWorkspace: stats.writes_workspace === 1,
    };
  }

  return {
    async getActiveLeaf() {
      ensureOpen();
      return readActiveLeaf();
    },

    async getParentMessageId(messageId) {
      ensureOpen();
      const row = db
        .prepare('SELECT parent_message_id FROM transcript_message WHERE id = ?')
        .get(messageId) as { parent_message_id: string | null } | undefined;
      return row === undefined ? undefined : row.parent_message_id;
    },

    async rebaseActiveLeaf(messageId) {
      ensureOpen();
      if (messageId !== null && !messageExists(messageId)) {
        throw new RangeError(`Branch rebase target message does not exist: ${messageId}`);
      }
      if (readActiveLeaf() === messageId) {
        return;
      }
      db.exec('BEGIN');
      try {
        setActiveLeaf(messageId);
        // Leaf moves change the visible message set wholesale: stale both the
        // page cursors and the user message index.
        bumpRevision(1, 1);
        db.exec('COMMIT');
      } catch (error) {
        rollback(db);
        throw error;
      }
    },

    async switchActiveBranch(targetMessageId) {
      ensureOpen();
      if (!messageExists(targetMessageId)) {
        throw new RangeError(`Branch switch target message does not exist: ${targetMessageId}`);
      }
      const nextLeaf = deepestOfSubtree(targetMessageId);
      if (readActiveLeaf() === nextLeaf) {
        return { activeLeafMessageId: nextLeaf };
      }
      db.exec('BEGIN');
      try {
        setActiveLeaf(nextLeaf);
        bumpRevision(1, 1);
        db.exec('COMMIT');
      } catch (error) {
        rollback(db);
        throw error;
      }
      return { activeLeafMessageId: nextLeaf };
    },

    async listAbandonedAssistantRows(targetMessageId) {
      ensureOpen();
      if (!messageExists(targetMessageId)) {
        return undefined;
      }
      const onPath = db
        .prepare(withActivePath('SELECT 1 FROM active_path WHERE id = ?'))
        .get(options.sessionId, targetMessageId);
      // Switching to a row already on the path keeps the same leaf: nothing
      // is abandoned.
      if (onPath !== undefined) {
        return [];
      }
      // Only assistant rows carry tools, so only they can record writes.
      // Bounded by the abandoned tail, never by the whole path.
      const rows = db
        .prepare(
          `${withActivePath(TARGET_ANCESTORS_CTE)}
           SELECT ${MESSAGE_COLUMNS}
           FROM transcript_message
           JOIN active_path ON transcript_message.id = active_path.id
           WHERE transcript_message.role = 'assistant'
             AND transcript_message.sequence > COALESCE((
               SELECT MAX(fork.sequence) FROM transcript_message fork
               JOIN active_path ON fork.id = active_path.id
               JOIN target_ancestors ON fork.id = target_ancestors.id
             ), 0)
           ORDER BY transcript_message.sequence ASC`,
        )
        .all(options.sessionId, targetMessageId) as unknown as MessageRow[];
      return rows.map((row) => rowToMessage(row));
    },

    async listBranchPoints(listOptions) {
      ensureOpen();
      validatePositiveBoundedInteger(
        listOptions.previewChars,
        'Branch point preview characters',
        MAX_PREVIEW_CHARS,
      );
      const pathRows = db
        .prepare(
          withActivePath(
            `SELECT transcript_message.id AS id, parent_message_id, sequence
             FROM transcript_message
             JOIN active_path ON transcript_message.id = active_path.id
             ORDER BY sequence ASC`,
          ),
        )
        .all(options.sessionId) as unknown as Array<{
        id: string;
        parent_message_id: string | null;
        sequence: number;
      }>;
      const points: TranscriptBranchPoint[] = [];
      for (const node of pathRows) {
        const siblingRows = (
          node.parent_message_id === null
            ? db
                .prepare(
                  `SELECT id, substr(text, 1, ?) AS preview FROM transcript_message
                   WHERE parent_message_id IS NULL ORDER BY sequence ASC`,
                )
                .all(listOptions.previewChars)
            : db
                .prepare(
                  `SELECT id, substr(text, 1, ?) AS preview FROM transcript_message
                   WHERE parent_message_id = ? ORDER BY sequence ASC`,
                )
                .all(listOptions.previewChars, node.parent_message_id)
        ) as unknown as Array<{ id: string; preview: string }>;
        if (siblingRows.length <= 1) {
          continue;
        }
        let promptPreview: string | undefined;
        if (node.parent_message_id !== null) {
          const anchorRow = db
            .prepare(
              `SELECT role, substr(text, 1, ?) AS preview FROM transcript_message WHERE id = ?`,
            )
            .get(listOptions.previewChars, node.parent_message_id) as
            | { role: string; preview: string }
            | undefined;
          if (anchorRow?.role === 'user') {
            promptPreview = anchorRow.preview;
          }
        }
        if (!promptPreview && siblingRows[0]) {
          const firstHeadRow = db
            .prepare(
              `SELECT role, substr(text, 1, ?) AS preview FROM transcript_message WHERE id = ?`,
            )
            .get(listOptions.previewChars, siblingRows[0].id) as
            | { role: string; preview: string }
            | undefined;
          if (firstHeadRow?.role === 'user') {
            promptPreview = firstHeadRow.preview;
          }
        }

        points.push({
          anchorMessageId: node.parent_message_id,
          promptPreview,
          activeIndex: Math.max(
            0,
            siblingRows.findIndex((sibling) => sibling.id === node.id),
          ),
          siblings: siblingRows.map((sibling) => {
            const stats = subtreeStats(sibling.id, listOptions.previewChars);
            return {
              headMessageId: sibling.id,
              preview: sibling.preview,
              responsePreview: stats.responsePreview,
              responseStatus: stats.responseStatus,
              leafPreview: stats.leafPreview,
              messageCount: stats.messageCount,
              writesWorkspace: stats.writesWorkspace,
              updatedAt: stats.updatedAt,
            };
          }),
        });
      }
      return points;
    },

    async truncateFrom(messageId) {
      ensureOpen();
      const target = db
        .prepare('SELECT parent_message_id FROM transcript_message WHERE id = ?')
        .get(messageId) as { parent_message_id: string | null } | undefined;
      if (target === undefined) {
        return {
          found: false,
          removedCount: 0,
          remainingCount: countPathRows(db, options.sessionId),
        };
      }
      db.exec('BEGIN');
      try {
        // Decide the leaf fallback before rows disappear: deleting a subtree
        // that contains the active path's node means the leaf dies with it.
        const targetOnPath =
          db
            .prepare(withActivePath('SELECT 1 FROM active_path WHERE id = ?'))
            .get(options.sessionId, messageId) !== undefined;
        const removedUsers = db
          .prepare(
            `${SUBTREE_CTE}
             SELECT COUNT(*) AS count FROM transcript_message m
             JOIN subtree s ON m.id = s.id
             WHERE m.role = 'user' AND length(trim(m.text)) > 0`,
          )
          .get(messageId) as { count: number };
        db.prepare(
          `${SUBTREE_CTE}
           DELETE FROM native_entry WHERE message_id IN (SELECT id FROM subtree)`,
        ).run(messageId);
        const removed = db
          .prepare(
            `${SUBTREE_CTE}
             DELETE FROM transcript_message WHERE id IN (SELECT id FROM subtree)`,
          )
          .run(messageId);
        if (targetOnPath) {
          setActiveLeaf(target.parent_message_id);
        }
        const removedCount = Number(removed.changes);
        bumpRevision(removedCount, removedUsers.count);
        db.exec('COMMIT');
        return {
          found: true,
          removedCount,
          remainingCount: countPathRows(db, options.sessionId),
        };
      } catch (error) {
        rollback(db);
        throw error;
      }
    },
  };
}
