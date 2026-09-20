/**
 * Core send flow: build the Host prompt request, paint the optimistic user
 * bubble, submit (foreground, queued-turn, or steer-queue admission), and
 * reconcile on ACK/failure.
 */
import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type {
  AgentModeId,
  PromptAttachment,
  PromptContextRef,
  QueuedTurnRecord,
  SessionScope,
} from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import type { SkillActivityView } from '../chat-reducer';
import {
  isFailedMediaAttachment,
  isPendingAttachmentReady,
  type PendingAttachmentUploadStatus,
  type PendingComposerAttachment,
} from '../media-utils.js';
import type { DesktopCopy, DesktopLocale } from '../desktop-locale.js';
import {
  applySkillToPrompt,
  normalizeCompactCustomInstructions,
  parseComposerSlashSubmit,
} from '../slash';
import { deriveDefaultNameFromMessage } from '@piwin/session/derive-default-name';
import { composerSessionListName } from '../composer-session-list-name';
import { isPlaceholderSessionName } from '../title-display';
import {
  foregroundMismatchNotice,
  readForegroundProblem,
  requestPromptWithForeground,
} from '../prompt-foreground';
import { createGestureIdempotencyKey } from '../gesture-idempotency.js';
import { hostFailureNotice, hostReconnectNotice } from '../host-problem-copy.js';
import { shouldBlockRemoteHostGesture } from '../host-reconnect-gate.js';
import { desktopForegroundMutationsEnabled } from '../foreground-admission.js';
import { flattenUnsafeRemoteContextRefs } from '../remote-context-refs.js';
import {
  shouldRestoreLiveComposer,
  sendOwnerLockKey,
  acquireSendOwnerLock,
  releaseSendOwnerLock,
} from '../composer-send-owner.js';
import { logSessionChain, sessionChainErrorCode } from '../session-chain-log.js';
import { sessionScopeKey } from '../session-scope-key.js';
import { isImagePromptAttachment, useComposerPromptInput } from './use-composer-prompt-input.js';
import type { UseComposerMediaArgs } from './composer-media-args.js';
import type { SessionComposerSnapshot } from './composer-session-snapshot.js';

export type { ComposerPromptRequestInput } from './use-composer-prompt-input.js';

export type UseComposerSendArgs = {
  args: UseComposerMediaArgs;
  locale: DesktopLocale;
  attachmentCopy: DesktopCopy['composer'];
  notifyError: (message: string) => void;
  composer: string;
  setComposer: Dispatch<SetStateAction<string>>;
  composerRef: MutableRefObject<string>;
  pendingAttachmentsRef: MutableRefObject<PendingComposerAttachment[]>;
  setPendingAttachments: Dispatch<SetStateAction<PendingComposerAttachment[]>>;
  pendingContextRefsRef: MutableRefObject<PromptContextRef[]>;
  promptSubmissionInProgress: MutableRefObject<boolean>;
  activeSessionIdRef: MutableRefObject<string | null>;
  sessionComposerSnapshotsRef: MutableRefObject<Map<string, SessionComposerSnapshot>>;
  // Drafts domain.
  upsertCurrentDraft: (text: string, scope: SessionScope, options?: { select?: boolean }) => void;
  removeCurrentDraft: (reason?: 'discard' | 'send') => void;
  skipDraftSaveRef: MutableRefObject<boolean>;
  preserveComposerOnSessionActivationRef: MutableRefObject<boolean>;
  draftTextRef: MutableRefObject<string>;
  currentDraftScopeRef: MutableRefObject<SessionScope>;
  currentDraftIdRef: MutableRefObject<string | null>;
  sendOwnerLocksRef: MutableRefObject<Set<string>>;
  // Attachments domain.
  clearPendingAttachments: () => void;
  forceDisposeComposerAttachments: (attachments: PendingComposerAttachment[]) => void;
  markAttachmentUploadStatus: (localIds: string[], status: PendingAttachmentUploadStatus) => void;
  readResolvedComposerChips: () => PendingComposerAttachment[];
  saveDeferredMediaChips: (sessionId: string, chips: PendingComposerAttachment[]) => Promise<void>;
};

export function useComposerSend(params: UseComposerSendArgs) {
  const {
    args,
    locale,
    attachmentCopy,
    notifyError,
    composer,
    setComposer,
    composerRef,
    pendingAttachmentsRef,
    setPendingAttachments,
    pendingContextRefsRef,
    promptSubmissionInProgress,
    activeSessionIdRef,
    sessionComposerSnapshotsRef,
    upsertCurrentDraft,
    removeCurrentDraft,
    skipDraftSaveRef,
    preserveComposerOnSessionActivationRef,
    draftTextRef,
    currentDraftScopeRef,
    currentDraftIdRef,
    sendOwnerLocksRef,
    clearPendingAttachments,
    forceDisposeComposerAttachments,
    markAttachmentUploadStatus,
    readResolvedComposerChips,
    saveDeferredMediaChips,
  } = params;

  const { buildPromptRequestInput } = useComposerPromptInput(args);

  const applyAcceptedRun = useCallback(
    (responseData: unknown, sessionId: string): void => {
      const accepted = responseData as { runId?: string; acceptedAt?: string };
      if (typeof accepted.runId === 'string') {
        args.dispatch({
          type: 'run/accepted',
          runId: accepted.runId,
          sessionId,
          ...(accepted.acceptedAt ? { acceptedAt: accepted.acceptedAt } : {}),
        });
      }
    },
    [args],
  );

  const paintOptimisticUserSend = useCallback(
    (params: {
      text: string;
      attachments?: PromptAttachment[];
      contextRefs?: PromptContextRef[];
      displayText?: string;
      skill?: SkillActivityView;
      /**
       * Mode this turn is actually sent under. `/goal <objective>` switches
       * mode and sends in one gesture, so the caller's parsed value is the
       * truth — `args.agentMode` is still the pre-switch state here.
       */
      agentMode?: AgentModeId;
      /** Queueing paints a user row without replacing the active Run projection. */
      queued?: boolean;
      clientMessageId?: string;
    }): string => {
      const clientMessageId = params.clientMessageId ?? crypto.randomUUID();
      const turnAgentMode = params.agentMode ?? args.agentMode;
      // Same model resolution as the Host prompt — Conversation needs it on
      // the optimistic turn so the avatar survives after streaming ends.
      const turnModel = buildPromptRequestInput({
        text: params.text,
        agentMode: turnAgentMode,
      }).model;
      args.dispatch({
        type: params.queued ? 'user/queue' : 'user/send',
        text: params.displayText ?? params.text,
        attachments: params.attachments ?? [],
        ...(params.contextRefs && params.contextRefs.length > 0
          ? { contextRefs: params.contextRefs }
          : {}),
        clientMessageId,
        ...(params.skill ? { skill: params.skill } : {}),
        ...(turnModel ? { model: turnModel } : {}),
        agentMode: turnAgentMode,
      });
      setComposer('');
      // Hide chips without releasing them: File, blob URL and save results
      // survive until the session/prompt ACK. On failure the snapshot is
      // restored; on ACK forceDisposeComposerAttachments releases everything.
      pendingAttachmentsRef.current = [];
      setPendingAttachments([]);
      return clientMessageId;
    },
    [args],
  );

  const rollbackOptimisticUserSend = useCallback(
    (
      clientMessageId: string,
      restoreText: string,
      restoreAttachments: PendingComposerAttachment[] | undefined,
      ownerSessionId: string | null,
      ownerScope: SessionScope,
    ): void => {
      args.dispatch({ type: 'user/send-rollback', clientMessageId });
      const restoreLive = shouldRestoreLiveComposer({
        ownerSessionId,
        liveSessionId: activeSessionIdRef.current,
        liveComposer: composerRef.current,
        restoreText,
      });
      if (restoreLive) {
        composerRef.current = restoreText;
        setComposer(restoreText);
        if (restoreAttachments && restoreAttachments.length > 0) {
          pendingAttachmentsRef.current = [...restoreAttachments];
          setPendingAttachments([...restoreAttachments]);
        }
      }
      skipDraftSaveRef.current = false;
      if (ownerSessionId) {
        sessionComposerSnapshotsRef.current.delete(ownerSessionId);
        sessionComposerSnapshotsRef.current.set(ownerSessionId, {
          text: restoreText,
          attachments: [...(restoreAttachments ?? pendingAttachmentsRef.current)],
          contextRefs: [...pendingContextRefsRef.current],
        });
        return;
      }
      upsertCurrentDraft(restoreText, ownerScope, { select: restoreLive });
    },
    [args, upsertCurrentDraft],
  );

  const refreshQueuedTurnQueue = useCallback(
    (sessionId: string): void => {
      void args.hostClient
        .request({ type: 'session/queued-turn-list', sessionId })
        .then((response) => {
          if (!response.success) return;
          const data = response.data as
            { queueRevision?: unknown; queuedTurns?: unknown } | undefined;
          if (
            data === undefined ||
            !Number.isSafeInteger(data.queueRevision) ||
            !Array.isArray(data.queuedTurns)
          ) {
            return;
          }
          args.dispatch({
            type: 'session/queued-turns-hydrate',
            sessionId,
            queueRevision: data.queueRevision as number,
            queuedTurns: data.queuedTurns as QueuedTurnRecord[],
          });
        })
        .catch((error: unknown) => {
          args.dispatch({ type: 'error', message: formatError(error) });
        });
    },
    [args],
  );

  const resolveSessionIdForComposer = useCallback(
    async (sessionName?: string): Promise<string | null> => {
      if (args.state.activeSessionId) {
        return args.state.activeSessionId;
      }
      // Explicit New Agent scope binding (clicked project folder / restored
      // draft) wins over the latest navigation scope, so project first-send
      // never falls back to a General session.
      const draftScope = currentDraftScopeRef.current;
      const isGeneral = draftScope.kind === 'general';
      const draftProjectTrusted =
        draftScope.kind === 'project' &&
        args.state.projectPath === draftScope.projectPath &&
        args.state.projectTrusted;
      if (!isGeneral && !draftProjectTrusted) {
        args.dispatch({ type: 'project/trust-dialog', open: true });
        return null;
      }
      if (!args.ensureSession) {
        notifyError('Create a session before sending');
        return null;
      }
      // We only reach this point from draft mode (activeSessionId was null).
      // Creating the session activates it in the reducer, which normally runs
      // the draft-exit effect and clears the composer. handleSend sets
      // skipDraftSaveRef first, so the send path still clears.
      const pendingMountedIds = args.knowledgeMountsRef?.current?.mountedIds;
      const draftMcpDisabled = args.draftMcpSwitches?.disabledServerIds;
      const draftCreateOptions = {
        ...(pendingMountedIds && pendingMountedIds.length > 0
          ? { knowledgeBaseIds: pendingMountedIds }
          : {}),
        ...(draftMcpDisabled && draftMcpDisabled.length > 0
          ? { disabledMcpServerIds: draftMcpDisabled }
          : {}),
      };
      const sessionId = isGeneral
        ? await args.ensureSession({
            scope: { kind: 'general' },
            ...(sessionName !== undefined ? { sessionName } : {}),
            ...draftCreateOptions,
          })
        : await args.ensureSession({
            scope: draftScope,
            projectPath: draftScope.projectPath,
            alreadyTrusted: true,
            ...(sessionName !== undefined ? { sessionName } : {}),
            ...draftCreateOptions,
          });
      if (sessionId) {
        preserveComposerOnSessionActivationRef.current = true;
        // The draft's mount choice now lives on the created session (or the
        // create call failed to apply it, in which case retrying a stale
        // draft value on the next new draft would be wrong either way).
        args.knowledgeMountsRef?.current?.clearDraft();
        args.draftMcpSwitches?.clearDraft();
      }
      return sessionId;
    },
    [args],
  );

  const handleSend = useCallback(
    async (overrideText?: string): Promise<void> => {
      const text = (overrideText ?? composer).trim();
      const ownerSessionIdAtEntry = args.state.activeSessionId;
      const ownerDraftIdAtEntry = currentDraftIdRef.current;
      const ownerScopeAtEntry = currentDraftScopeRef.current;
      const ownerLockKey = sendOwnerLockKey(ownerSessionIdAtEntry, ownerDraftIdAtEntry);
      if (sendOwnerLocksRef.current.has(ownerLockKey) || promptSubmissionInProgress.current) {
        return;
      }
      // `/compact` must intercept before Send gates. Admission reconciling,
      // paused runs, leftover chips, and failed chips would otherwise swallow
      // the command with an empty composer and no toast. Stop is a toolbar
      // action (⌘.), not a slash command.
      if (text.startsWith('/')) {
        const parsed = parseComposerSlashSubmit(text, []);
        if (parsed.kind === 'command' && parsed.commandId === 'compact') {
          promptSubmissionInProgress.current = true;
          try {
            const compacted = await args.onCompact?.(
              normalizeCompactCustomInstructions(parsed.args),
            );
            if (compacted !== false) {
              setComposer('');
              clearPendingAttachments();
            }
          } finally {
            promptSubmissionInProgress.current = false;
          }
          return;
        }
      }
      if (!desktopForegroundMutationsEnabled(args.state)) {
        return;
      }
      if (shouldBlockRemoteHostGesture(args.hostClient)) {
        notifyError(hostReconnectNotice(locale));
        return;
      }
      const promptRefsSnapshot = args.getPendingContextRefTokens?.() ?? null;
      const contextRefs = promptRefsSnapshot
        ? promptRefsSnapshot.items.map((item) => item.ref)
        : (args.getPendingContextRefs?.() ?? []);

      // Failed chips are never dropped into a prompt silently and never
      // auto-retried here. The composer confirmation (Phase 0) resolves them
      // through retryFailedAttachments/discardFailedAttachments before this
      // point; anything left is a hard stop that keeps the draft intact.
      const failedChipsAtEntry = pendingAttachmentsRef.current.filter(isFailedMediaAttachment);
      if (failedChipsAtEntry.length > 0) {
        args.dispatch({
          type: 'error',
          message: attachmentCopy.attachmentSendBlocked(failedChipsAtEntry.length),
        });
        return;
      }

      if (!acquireSendOwnerLock(sendOwnerLocksRef.current, ownerLockKey)) {
        return;
      }
      const sendStartedAt = Date.now();
      logSessionChain({
        event: 'send/start',
        operationId: ownerLockKey,
        owner: ownerLockKey,
        scopeKey: sessionScopeKey(ownerScopeAtEntry),
        hostInstanceId: args.hostClient.getHostInstanceId?.() ?? null,
      });
      try {
        // ADR 0045 compatibility path: pastes are queued locally and only reach
        // `media/save` here, after Send resolves the destination session. The
        // bubble must carry real Host attachment refs, so deferred saves run
        // before the optimistic paint. Error chips stay visible for Retry.
        const deferredChips = [...pendingAttachmentsRef.current].filter(
          (item) =>
            item.attachment.kind === 'media' &&
            !isPendingAttachmentReady(item) &&
            item.uploadStatus !== 'error',
        );

        const wasInDraftMode = !args.state.activeSessionId;
        const isGeneral = args.state.activeScope.kind === 'general' || !args.state.projectPath;
        const listName = composerSessionListName(text, pendingAttachmentsRef.current);

        // Sync gates before paint so we never flash a bubble that cannot send.
        // The check itself stays synchronous so a plain trusted send still paints
        // in the same turn as Enter; only a missing workspace awaits the picker.
        const checkSendGates = (): { ok: true } | { ok: false; awaitWorkspacePicker?: true } => {
          if (!isGeneral) {
            if (!args.state.projectPath) {
              return { ok: false, awaitWorkspacePicker: true };
            }
            if (!args.state.projectTrusted) {
              args.dispatch({ type: 'project/trust-dialog', open: true });
              return { ok: false };
            }
          }
          return { ok: true };
        };

        let deferredSessionId: string | null = null;
        if (deferredChips.length > 0) {
          const gates = checkSendGates();
          if (!gates.ok) {
            if (gates.awaitWorkspacePicker) {
              await args.onNeedWorkspace?.();
            }
            return;
          }
          if (wasInDraftMode) {
            skipDraftSaveRef.current = true;
            draftTextRef.current = '';
          }
          markAttachmentUploadStatus(
            deferredChips.map((item) => item.localId),
            'saving',
          );
          const sessionId = await resolveSessionIdForComposer(listName);
          if (!sessionId) {
            if (wasInDraftMode) {
              skipDraftSaveRef.current = false;
            }
            // Nothing painted yet: text stays, unsaved chips return to queued.
            markAttachmentUploadStatus(
              deferredChips.map((item) => item.localId),
              'queued',
            );
            return;
          }
          if (wasInDraftMode) {
            removeCurrentDraft('send');
          }
          deferredSessionId = sessionId;
          await saveDeferredMediaChips(sessionId, deferredChips);
          const failed = readResolvedComposerChips().filter(isFailedMediaAttachment);
          if (failed.length > 0) {
            args.dispatch({
              type: 'error',
              message: attachmentCopy.attachmentSendBlocked(failed.length),
            });
            return;
          }
        }

        // Include ready chips only; error chips stay visible for an explicit
        // Retry and are never silently dropped into the prompt.
        let attachments: PromptAttachment[] = readResolvedComposerChips()
          .filter(isPendingAttachmentReady)
          .map((item) => item.attachment);
        if (!text && attachments.length === 0 && contextRefs.length === 0) {
          return;
        }
        // Streaming is allowed: host supersedes the in-flight run when a newer
        // message arrives (session/prompt interrupt). Users no longer need to
        // press Stop first.

        const hasImage = attachments.some(isImagePromptAttachment);
        if (hasImage) {
          const selected = args.modelOptions?.find(
            (option) => `${option.providerId}::${option.modelId}` === args.selectedModelKey,
          );
          const supportsImage = selected?.supportsImage === true;
          if (!supportsImage && !args.visionDelegationEnabled) {
            const message =
              '当前模型是纯文本（无视觉）。图片只会以本地路径字符串注入，模型看不到像素。' +
              '请切换到带「视觉」标签的模型，或在设置里开启视觉委派。仍要发送吗？';
            if (args.confirmTextOnlyImageSend) {
              const ok = await args.confirmTextOnlyImageSend(message);
              if (!ok) {
                return;
              }
            }
          }
        }

        if (deferredChips.length === 0) {
          const gates = checkSendGates();
          if (!gates.ok) {
            if (gates.awaitWorkspacePicker) {
              await args.onNeedWorkspace?.();
            }
            return;
          }
        }

        // Whole-message slash commands that must not paint a chat bubble.
        if (text.startsWith('/') && attachments.length === 0) {
          const skills = (args.menuSkills ?? []).map((skill) => ({
            id: skill.id,
            name: skill.name,
            enabled: skill.enabled,
          }));
          const parsed = parseComposerSlashSubmit(text, skills);

          if (parsed.kind === 'scheme') {
            if (args.conversationChat === true) {
              return;
            }
            args.onOrchestrationSchemeChange?.(parsed.schemeId);
            setComposer('');
            clearPendingAttachments();
            return;
          }
          if (parsed.kind === 'knowledge') {
            setComposer('');
            clearPendingAttachments();
            args.onOpenKnowledge?.(parsed.subTab);
            return;
          }
          if (parsed.kind === 'cards-panel') {
            setComposer('');
            clearPendingAttachments();
            args.onOpenCardsPanel?.();
            return;
          }
          if (parsed.kind === 'mode' && !parsed.args) {
            args.onAgentModeChange?.(parsed.modeId);
            setComposer('');
            clearPendingAttachments();
            return;
          }
          if (parsed.kind === 'skill') {
            const skillEnabled =
              skills.find((skill) => skill.id === parsed.skillId)?.enabled !== false;
            if (!skillEnabled) {
              args.dispatch({
                type: 'error',
                message: `Skill "${parsed.skillName}" is disabled — enable it in Settings → Skills`,
              });
              return;
            }
          }
        }

        // Freeze all model-facing prompt choices before either the queue or the
        // ordinary prompt path. A slash-mode/skill send while a Run is active
        // must carry the same transformed text and metadata as an idle send.
        let displayText = text;
        let hostPromptText = text;
        let promptAgentMode: AgentModeId = args.agentMode;
        let promptAttachments: PromptAttachment[] = attachments;
        let promptContextRefs = contextRefs;
        let skillActivity: SkillActivityView | undefined;
        if (text.startsWith('/') && attachments.length === 0 && promptContextRefs.length === 0) {
          const skills = (args.menuSkills ?? []).map((skill) => ({
            id: skill.id,
            name: skill.name,
            enabled: skill.enabled,
          }));
          const parsed = parseComposerSlashSubmit(text, skills);
          if (parsed.kind === 'mode' && parsed.args) {
            args.onAgentModeChange?.(parsed.modeId);
            displayText = parsed.args;
            hostPromptText = parsed.args;
            promptAgentMode = parsed.modeId;
            promptAttachments = [];
          } else if (parsed.kind === 'skill') {
            hostPromptText = applySkillToPrompt(parsed.skillName, parsed.skillId, parsed.args);
            promptAttachments = [];
            skillActivity = { skillId: parsed.skillId, name: parsed.skillName };
          }
        }

        if (args.hostClient.getTransport?.() === 'remote') {
          const flattened = flattenUnsafeRemoteContextRefs(hostPromptText, promptContextRefs);
          // The slash-mode/skill branch above only runs when promptContextRefs
          // was empty, so whenever flattening actually appends text here,
          // displayText still equals the pre-flatten hostPromptText. Mirror the
          // same appended text into the bubble so what's shown immediately
          // matches what the Host is actually asked to store and answer.
          if (flattened.text !== hostPromptText) {
            displayText = flattened.text;
          }
          hostPromptText = flattened.text;
          promptContextRefs = flattened.contextRefs;
        }

        // Stage 4: an ordinary Send during an active Run is a Host-owned
        // next-turn queue admission. The Host persists the same user identity
        // and later drains it after the exact foreground Run terminalizes.
        if (args.state.streaming && args.state.activeSessionId) {
          const sessionId = args.state.activeSessionId;
          const queuedTurnId = crypto.randomUUID();
          const paintSnapshotAttachments = [...pendingAttachmentsRef.current];
          const clientMessageId = crypto.randomUUID();
          paintOptimisticUserSend({
            text,
            displayText,
            attachments: promptAttachments,
            contextRefs: promptContextRefs,
            ...(skillActivity ? { skill: skillActivity } : {}),
            agentMode: promptAgentMode,
            queued: true,
            clientMessageId,
          });
          pendingContextRefsRef.current = promptContextRefs;
          promptSubmissionInProgress.current = true;
          try {
            const response = await args.hostClient.request(
              {
                type: 'session/queued-turn-submit',
                sessionId,
                queuedTurnId,
                userMessageId: clientMessageId,
                input: buildPromptRequestInput({
                  text: hostPromptText,
                  attachments: promptAttachments,
                  contextRefs: promptContextRefs,
                  agentMode: promptAgentMode,
                  clientMessageId,
                  ...(skillActivity ? { skillId: skillActivity.skillId } : {}),
                }),
              },
              { idempotencyKey: createGestureIdempotencyKey() },
            );
            if (!response.success) {
              rollbackOptimisticUserSend(
                clientMessageId,
                text,
                paintSnapshotAttachments,
                sessionId,
                ownerScopeAtEntry,
              );
              notifyError(hostFailureNotice(response, locale));
              return;
            }
            forceDisposeComposerAttachments(paintSnapshotAttachments);
            pendingContextRefsRef.current = [];
            const data = response.data as { queuedTurn?: QueuedTurnRecord } | undefined;
            if (data?.queuedTurn) {
              args.dispatch({ type: 'session/queued-turn-updated', queuedTurn: data.queuedTurn });
            }
            refreshQueuedTurnQueue(sessionId);
            if (promptRefsSnapshot) {
              args.consumePendingContextRefs?.(promptRefsSnapshot);
            } else {
              args.clearPendingContextRefs?.();
            }
          } catch (error) {
            rollbackOptimisticUserSend(
              clientMessageId,
              text,
              paintSnapshotAttachments,
              sessionId,
              ownerScopeAtEntry,
            );
            notifyError(formatError(error));
          } finally {
            promptSubmissionInProgress.current = false;
          }
          return;
        }

        // Paint-first: clear composer and show the user bubble before any IPC.
        // Session create / prompt ACK stay off the critical input path. A send
        // with deferred media already ensured the session above.
        if (deferredSessionId === null) {
          if (wasInDraftMode) {
            skipDraftSaveRef.current = true;
            draftTextRef.current = '';
          }
        }

        let clientMessageId: string | null = null;

        // Chips exactly as painted (deferred saves already resolved to ready).
        // Kept alive until ACK so a failed prompt can restore them intact.
        const paintSnapshotAttachments = [...pendingAttachmentsRef.current];
        // Paint exactly what will be persisted: on a remote transport,
        // promptContextRefs is already the post-flatten "safe" subset (see
        // flattenUnsafeRemoteContextRefs above). Painting the pre-flatten
        // `contextRefs` here would show chips that vanish the next time this
        // message is hydrated from the Host's stored transcript.
        clientMessageId = paintOptimisticUserSend({
          text,
          displayText,
          attachments: promptAttachments,
          contextRefs: promptContextRefs,
          ...(skillActivity ? { skill: skillActivity } : {}),
          agentMode: promptAgentMode,
        });
        // paintOptimisticUserSend hides attachment chips; workspace refs belong
        // to this same prompt and must survive until the Host request is built.
        pendingContextRefsRef.current = promptContextRefs;

        promptSubmissionInProgress.current = true;
        let ownerSessionId: string | null = ownerSessionIdAtEntry;
        try {
          const sessionId = deferredSessionId ?? (await resolveSessionIdForComposer(listName));
          if (!sessionId) {
            if (wasInDraftMode) {
              skipDraftSaveRef.current = false;
            }
            rollbackOptimisticUserSend(
              clientMessageId,
              text,
              paintSnapshotAttachments,
              ownerSessionId,
              ownerScopeAtEntry,
            );
            return;
          }
          if (wasInDraftMode && deferredSessionId === null) {
            removeCurrentDraft('send');
          }
          ownerSessionId = sessionId;

          const input = buildPromptRequestInput({
            text: hostPromptText,
            attachments: promptAttachments,
            contextRefs: promptContextRefs,
            agentMode: promptAgentMode,
            clientMessageId,
            ...(skillActivity ? { skillId: skillActivity.skillId } : {}),
          });
          const response = await requestPromptWithForeground({
            request: (command, options) => args.hostClient.request(command, options),
            sessionId,
            input,
            createIdempotencyKey: createGestureIdempotencyKey,
            ...(args.confirmBusyRun ? { resolveBusy: args.confirmBusyRun } : {}),
            ...(args.confirmForegroundReplace
              ? { confirmReplace: args.confirmForegroundReplace }
              : {}),
            onQueue: async () => {
              rollbackOptimisticUserSend(
                clientMessageId,
                text,
                paintSnapshotAttachments,
                sessionId,
                ownerScopeAtEntry,
              );
              const queuedTurnId = crypto.randomUUID();
              return args.hostClient.request(
                {
                  type: 'session/queued-turn-submit',
                  sessionId,
                  queuedTurnId,
                  userMessageId: clientMessageId,
                  input,
                },
                { idempotencyKey: createGestureIdempotencyKey() },
              );
            },
            ...(typeof args.hostClient.supportsForegroundAdmission === 'function'
              ? { remoteForegroundAdmission: args.hostClient.supportsForegroundAdmission() }
              : {}),
          });
          if (response.command === 'session/queued-turn-submit') {
            if (!response.success) {
              rollbackOptimisticUserSend(
                clientMessageId,
                text,
                paintSnapshotAttachments,
                sessionId,
                ownerScopeAtEntry,
              );
              notifyError(hostFailureNotice(response, locale));
              return;
            }
            forceDisposeComposerAttachments(paintSnapshotAttachments);
            pendingContextRefsRef.current = [];
            const queuedData = response.data as { queuedTurn?: QueuedTurnRecord } | undefined;
            if (queuedData?.queuedTurn) {
              args.dispatch({
                type: 'session/queued-turn-updated',
                queuedTurn: queuedData.queuedTurn,
              });
            }
            refreshQueuedTurnQueue(sessionId);
            if (promptRefsSnapshot) {
              args.consumePendingContextRefs?.(promptRefsSnapshot);
            } else {
              args.clearPendingContextRefs?.();
            }
            return;
          }
          if (!response.success) {
            rollbackOptimisticUserSend(
              clientMessageId,
              text,
              paintSnapshotAttachments,
              sessionId,
              ownerScopeAtEntry,
            );
            const problem = readForegroundProblem(response);
            if (problem) {
              notifyError(foregroundMismatchNotice(problem, locale));
            } else {
              notifyError(hostFailureNotice(response, locale));
            }
            logSessionChain({
              event: 'send/failed',
              operationId: clientMessageId ?? ownerLockKey,
              owner: sessionId,
              scopeKey: sessionScopeKey(ownerScopeAtEntry),
              elapsedMs: Date.now() - sendStartedAt,
              errorCode: sessionChainErrorCode(response.error),
              hostInstanceId: args.hostClient.getHostInstanceId?.() ?? null,
            });
            return;
          }

          // ACK: the prompt now owns the attachments. Only here may the local
          // File, blob preview and save results be released (ADR 0045 recovery).
          forceDisposeComposerAttachments(paintSnapshotAttachments);
          pendingContextRefsRef.current = [];

          applyAcceptedRun(response.data, sessionId);
          logSessionChain({
            event: 'send/accepted',
            operationId: clientMessageId ?? ownerLockKey,
            owner: sessionId,
            scopeKey: sessionScopeKey(ownerScopeAtEntry),
            elapsedMs: Date.now() - sendStartedAt,
            hostInstanceId: args.hostClient.getHostInstanceId?.() ?? null,
          });
          if (promptRefsSnapshot) {
            args.consumePendingContextRefs?.(promptRefsSnapshot);
          } else {
            args.clearPendingContextRefs?.();
          }

          // Optimistic recency + text title on send. Bumping updatedAt here
          // moves an already-named session to the top of the project list
          // before the host index-updated push arrives. Placeholder names
          // still get the interim title; LLM may upgrade later.
          const currentName =
            args.state.sessions.find((session) => session.id === sessionId)?.name ??
            args.state.generalSessions.find((session) => session.id === sessionId)?.name ??
            Object.values(args.state.projectSessionsByPath)
              .flat()
              .find((session) => session.id === sessionId)?.name;
          const interim = isPlaceholderSessionName(currentName)
            ? deriveDefaultNameFromMessage(displayText)
            : undefined;
          const preview = displayText.trim().slice(0, 160);
          args.dispatch({
            type: 'session/update',
            session: {
              id: sessionId,
              name: interim ?? currentName ?? '',
              updatedAt: new Date().toISOString(),
              scope: ownerScopeAtEntry,
              ...(preview ? { lastPreview: preview } : {}),
            },
          });
        } catch (error) {
          if (clientMessageId) {
            rollbackOptimisticUserSend(
              clientMessageId,
              text,
              paintSnapshotAttachments,
              ownerSessionId,
              ownerScopeAtEntry,
            );
          }
          notifyError(formatError(error));
          logSessionChain({
            event: 'send/failed',
            operationId: clientMessageId ?? ownerLockKey,
            owner: ownerSessionId ?? ownerLockKey,
            scopeKey: sessionScopeKey(ownerScopeAtEntry),
            elapsedMs: Date.now() - sendStartedAt,
            errorCode: sessionChainErrorCode(error),
            hostInstanceId: args.hostClient.getHostInstanceId?.() ?? null,
          });
        } finally {
          promptSubmissionInProgress.current = false;
        }
      } finally {
        releaseSendOwnerLock(sendOwnerLocksRef.current, ownerLockKey);
      }
    },
    [
      args,
      applyAcceptedRun,
      attachmentCopy,
      buildPromptRequestInput,
      clearPendingAttachments,
      composer,
      forceDisposeComposerAttachments,
      markAttachmentUploadStatus,
      paintOptimisticUserSend,
      readResolvedComposerChips,
      refreshQueuedTurnQueue,
      removeCurrentDraft,
      resolveSessionIdForComposer,
      rollbackOptimisticUserSend,
      saveDeferredMediaChips,
      sendOwnerLocksRef,
      upsertCurrentDraft,
    ],
  );

  return {
    handleSend,
    buildPromptRequestInput,
    refreshQueuedTurnQueue,
  };
}
