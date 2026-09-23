/**
 * Cursor-style "take it back": a prompt stopped before the model showed
 * anything returns to the composer instead of sitting in the transcript as
 * an unanswered, paused turn.
 *
 * Pause records a candidate only when nothing was visible yet. Once the
 * paused terminal (with its checkpoint) arrives, Host is asked to retract;
 * Host re-checks the durable transcript and refuses if output landed in the
 * meantime, which simply leaves an ordinary pause.
 */
import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import type {
  SessionRetractPausedPromptData,
  SessionTranscriptPageInfo,
} from '@piwin/contracts';
import { chipsFromPromptAttachments } from '../composer-attachment-chips.js';
import type { PendingComposerAttachment } from '../media-utils.js';
import {
  findPausedPromptRetractCandidate,
  hasOutputAfterPrompt,
  mergeRetractedDraft,
  type PausedPromptRetractCandidate,
} from '../paused-prompt-retract-policy.js';
import type { UseComposerMediaArgs } from './composer-media-args.js';
import type { SessionComposerSnapshot } from './composer-session-snapshot.js';

export type UsePausedPromptRetractArgs = {
  args: UseComposerMediaArgs;
  setComposer: Dispatch<SetStateAction<string>>;
  composerRef: MutableRefObject<string>;
  pendingAttachmentsRef: MutableRefObject<PendingComposerAttachment[]>;
  setPendingAttachments: Dispatch<SetStateAction<PendingComposerAttachment[]>>;
  sessionComposerSnapshotsRef: MutableRefObject<Map<string, SessionComposerSnapshot>>;
};

export function usePausedPromptRetract(params: UsePausedPromptRetractArgs): {
  notePauseRequested: () => void;
} {
  const {
    args,
    setComposer,
    composerRef,
    pendingAttachmentsRef,
    setPendingAttachments,
    sessionComposerSnapshotsRef,
  } = params;
  const candidateRef = useRef<PausedPromptRetractCandidate | null>(null);
  const argsRef = useRef(args);
  argsRef.current = args;

  const notePauseRequested = useCallback((): void => {
    const { state } = argsRef.current;
    candidateRef.current = findPausedPromptRetractCandidate(state.activeSessionId, state.messages);
  }, []);

  const restoreDraft = useCallback(
    (sessionId: string, retracted: SessionRetractPausedPromptData['retracted']): void => {
      const current = argsRef.current;
      const chips = chipsFromPromptAttachments(retracted.attachments);
      if (current.state.activeSessionId !== sessionId) {
        // The user moved on while Host answered; park it where drafts restore it.
        const parked = sessionComposerSnapshotsRef.current.get(sessionId);
        const merged = mergeRetractedDraft(retracted, {
          text: parked?.text ?? '',
          contextRefs: parked?.contextRefs ?? [],
        });
        sessionComposerSnapshotsRef.current.set(sessionId, {
          text: merged.text,
          attachments: [...chips, ...(parked?.attachments ?? [])],
          contextRefs: merged.contextRefs,
        });
        return;
      }
      const merged = mergeRetractedDraft(retracted, {
        text: composerRef.current,
        contextRefs: current.getPendingContextRefs?.() ?? [],
      });
      composerRef.current = merged.text;
      setComposer(merged.text);
      if (chips.length > 0) {
        const nextChips = [...chips, ...pendingAttachmentsRef.current];
        pendingAttachmentsRef.current = nextChips;
        setPendingAttachments(nextChips);
      }
      if (merged.contextRefs.length > 0) {
        current.restorePendingContextRefs?.(merged.contextRefs);
      }
    },
    [composerRef, pendingAttachmentsRef, sessionComposerSnapshotsRef, setComposer, setPendingAttachments],
  );

  const { runTerminal, activeSessionId, messages } = args.state;
  useEffect(() => {
    const candidate = candidateRef.current;
    // `none` means the pause is still settling. Any other terminal ends the
    // candidate: a turn that completed or stopped instead must not be
    // retracted by some later, unrelated pause.
    if (candidate === null || runTerminal.kind === 'none') return;
    candidateRef.current = null;
    if (runTerminal.kind !== 'paused') return;
    const checkpointId = runTerminal.checkpointId;
    if (
      checkpointId === undefined ||
      activeSessionId !== candidate.sessionId ||
      hasOutputAfterPrompt(messages, candidate.userMessageId)
    ) {
      return;
    }
    const { hostClient, dispatch } = argsRef.current;
    if (hostClient.supportsCommand?.('session/retract-paused-prompt') === false) return;
    void hostClient
      .request({
        type: 'session/retract-paused-prompt',
        sessionId: candidate.sessionId,
        checkpointId,
        messageProjection: 'tail',
      })
      .then((response) => {
        // A refusal (output arrived, checkpoint moved) is an ordinary pause.
        if (!response.success) return;
        const data = response.data as
          | (SessionRetractPausedPromptData & { transcriptPage?: SessionTranscriptPageInfo })
          | undefined;
        if (data?.retracted === undefined) return;
        dispatch({
          type: 'session/branch-switched',
          sessionId: candidate.sessionId,
          messages: data.messages ?? [],
          ...(data.transcriptPage ? { transcriptPage: data.transcriptPage } : {}),
        });
        if (argsRef.current.state.activeSessionId === candidate.sessionId) {
          dispatch({ type: 'run/terminal-dismiss' });
        }
        restoreDraft(candidate.sessionId, data.retracted);
      })
      .catch((error: unknown) => {
        // The turn stays an ordinary pause; nothing was cut client-side.
        console.warn('[piwin] retracting the paused prompt failed', error);
      });
  }, [activeSessionId, messages, restoreDraft, runTerminal]);

  return { notePauseRequested };
}
