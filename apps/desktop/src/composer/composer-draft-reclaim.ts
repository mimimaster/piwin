import type { DraftSessionItemUi } from './draft-session.js';
import type { SessionComposerSnapshot } from '../hooks/composer-session-snapshot.js';
import { buildComposerDraftStore } from './composer-draft-persistence.js';

type ComposerReclaimInput = {
  drafts: readonly DraftSessionItemUi[];
  draftSnapshots: ReadonlyMap<string, SessionComposerSnapshot>;
  sessionSnapshots: ReadonlyMap<string, SessionComposerSnapshot>;
};

function snapshotMatches(
  snapshot: SessionComposerSnapshot,
  stored: { text: string; contextRefs: SessionComposerSnapshot['contextRefs'] } | undefined,
): boolean {
  if (snapshot.attachments.length > 0) return false;
  if (!stored) return snapshot.text.length === 0 && snapshot.contextRefs.length === 0;
  return (
    snapshot.text === stored.text &&
    JSON.stringify(snapshot.contextRefs) === JSON.stringify(stored.contextRefs)
  );
}

/** Persistence intentionally bounds/trims drafts; an automatic reload must never lose that excess. */
export function canReclaimComposerDrafts(input: ComposerReclaimInput): boolean {
  const stored = buildComposerDraftStore({ ...input, hostInstanceId: 'reclaim-check' });
  if (stored.drafts.length !== input.drafts.length) return false;
  const draftsById = new Map(stored.drafts.map((draft) => [draft.id, draft]));
  for (const draft of input.drafts) {
    const persisted = draftsById.get(draft.id);
    if (
      !persisted ||
      persisted.name !== draft.name ||
      persisted.text !== (input.draftSnapshots.get(draft.id)?.text ?? draft.text)
    )
      return false;
  }
  for (const [draftId, snapshot] of input.draftSnapshots) {
    if (!snapshotMatches(snapshot, draftsById.get(draftId))) return false;
  }
  const sessionsById = new Map(
    stored.sessionSnapshots.map((snapshot) => [snapshot.sessionId, snapshot]),
  );
  for (const [sessionId, snapshot] of input.sessionSnapshots) {
    if (!snapshotMatches(snapshot, sessionsById.get(sessionId))) return false;
  }
  return true;
}
