/**
 * Conversation-scoped composer orchestration pill + delegation toggle.
 *
 * The Host session index is the durable owner (`session/set-composer-profile`
 * writes it, `session/resume` returns it), so a conversation keeps its scheme
 * across Desktop reloads. The in-memory park map is only a cache that makes a
 * session switch paint the right pill before resume answers.
 */
import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import {
  ORCHESTRATION_SCHEME_OFF_ID,
  resolveNewSessionOrchestrationSchemeId,
  type PiwinConfig,
} from '@piwin/contracts';
import {
  resolveComposerOrchestrationForSessionChange,
  type ComposerOrchestrationControls,
} from '../composer-orchestration-session';
import type { HostClient } from '../host-client';
import { commitSessionComposerProfile } from './commit-session-composer-profile.js';

export type SessionOrchestrationRestore = {
  sessionId: string;
  orchestrationSchemeId?: string;
  delegationDisabled?: boolean;
};

export type UseComposerOrchestrationControlsArgs = {
  hostClient: Pick<HostClient, 'request'>;
  activeSessionId: string | null;
  config: PiwinConfig | null;
  orchestrationSchemeId: string;
  setOrchestrationSchemeId: Dispatch<SetStateAction<string>>;
  delegationDisabled: boolean;
  setDelegationDisabled: Dispatch<SetStateAction<boolean>>;
};

export function useComposerOrchestrationControls(args: UseComposerOrchestrationControlsArgs) {
  const {
    hostClient,
    activeSessionId,
    config,
    orchestrationSchemeId,
    setOrchestrationSchemeId,
    delegationDisabled,
    setDelegationDisabled,
  } = args;
  const orchestrationSchemeIdRef = useRef(orchestrationSchemeId);
  orchestrationSchemeIdRef.current = orchestrationSchemeId;
  const delegationDisabledRef = useRef(delegationDisabled);
  delegationDisabledRef.current = delegationDisabled;
  const parkedRef = useRef(new Map<string, ComposerOrchestrationControls>());
  // First-send binds the draft pill to the created session before any later
  // null gap (project/set, index remove) can park it as a different conversation.
  const boundSessionRef = useRef<string | null>(activeSessionId);
  const activeSessionIdRef = useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;
  // A pick made after switching in wins over a resume answer still in flight.
  const touchedSessionRef = useRef<string | null>(null);
  const configReady = config !== null;
  const newSessionSchemeId = configReady
    ? resolveNewSessionOrchestrationSchemeId({
        schemes: config.subagents?.schemes,
        maxConcurrency: config.subagents?.maxConcurrency,
        maxTasksPerRun: config.subagents?.maxTasksPerRun,
        defaultSchemeId: config.desktop?.defaultOrchestrationSchemeId,
      })
    : ORCHESTRATION_SCHEME_OFF_ID;
  const newSessionSchemeIdRef = useRef(newSessionSchemeId);
  newSessionSchemeIdRef.current = newSessionSchemeId;
  // A pick made on the blank composer before settings arrive stays put.
  // A later change of the saved default updates that same blank composer.
  const draftSchemeTouchedRef = useRef(false);
  const seenNewSessionSchemeRef = useRef<string | null>(null);

  const commitControls = useCallback(
    (sessionId: string, controls: Partial<ComposerOrchestrationControls>) => {
      void commitSessionComposerProfile({
        request: (command) => hostClient.request(command),
        sessionId,
        ...(controls.schemeId !== undefined ? { orchestrationSchemeId: controls.schemeId } : {}),
        ...(controls.delegationDisabled !== undefined
          ? { delegationDisabled: controls.delegationDisabled }
          : {}),
      }).then((result) => {
        if (!result.ok) {
          console.warn(`[orchestration] could not save session scheme: ${result.error}`);
        }
      });
    },
    [hostClient],
  );

  const selectOrchestrationScheme = useCallback(
    (schemeId: string) => {
      const sessionId = activeSessionIdRef.current;
      setOrchestrationSchemeId(schemeId);
      if (sessionId === null) {
        draftSchemeTouchedRef.current = true;
        return;
      }
      touchedSessionRef.current = sessionId;
      commitControls(sessionId, { schemeId });
    },
    [commitControls, setOrchestrationSchemeId],
  );

  const selectDelegationDisabled = useCallback(
    (disabled: boolean) => {
      const sessionId = activeSessionIdRef.current;
      setDelegationDisabled(disabled);
      if (sessionId === null) {
        return;
      }
      touchedSessionRef.current = sessionId;
      commitControls(sessionId, { delegationDisabled: disabled });
    },
    [commitControls, setDelegationDisabled],
  );

  useEffect(() => {
    if (!configReady || activeSessionId !== null) return;
    const previous = seenNewSessionSchemeRef.current;
    seenNewSessionSchemeRef.current = newSessionSchemeId;
    if (previous === newSessionSchemeId) return;
    if (previous === null && draftSchemeTouchedRef.current) return;
    draftSchemeTouchedRef.current = false;
    setOrchestrationSchemeId((current) =>
      current === newSessionSchemeId ? current : newSessionSchemeId,
    );
  }, [activeSessionId, configReady, newSessionSchemeId, setOrchestrationSchemeId]);

  /** Another New Agent from a draft: drop the unsent draft's choice. */
  const resetOrchestrationForNewDraft = useCallback(() => {
    draftSchemeTouchedRef.current = false;
    setOrchestrationSchemeId(newSessionSchemeIdRef.current);
    setDelegationDisabled(false);
  }, [setDelegationDisabled, setOrchestrationSchemeId]);

  const resetOrchestrationForSessionChange = useCallback(
    (change: { previousSessionId: string | null; nextSessionId: string | null }) => {
      const leavingDraft = change.previousSessionId == null && change.nextSessionId != null;
      const schemePreviousSessionId =
        leavingDraft && boundSessionRef.current === change.nextSessionId
          ? change.nextSessionId
          : change.previousSessionId;
      const resolved = resolveComposerOrchestrationForSessionChange({
        previousSessionId: schemePreviousSessionId,
        nextSessionId: change.nextSessionId,
        current: {
          schemeId: orchestrationSchemeIdRef.current,
          delegationDisabled: delegationDisabledRef.current,
        },
        parked: parkedRef.current,
        newSessionSchemeId: newSessionSchemeIdRef.current,
      });
      if (change.nextSessionId === null) {
        draftSchemeTouchedRef.current = false;
      }
      parkedRef.current = resolved.parked;
      touchedSessionRef.current = null;
      setOrchestrationSchemeId(resolved.controls.schemeId);
      setDelegationDisabled(resolved.controls.delegationDisabled);
      boundSessionRef.current = change.nextSessionId;
    },
    [setDelegationDisabled, setOrchestrationSchemeId],
  );

  /** First send created the Host session: it now owns the draft's choice. */
  const bindOrchestrationSession = useCallback(
    (sessionId: string) => {
      boundSessionRef.current = sessionId;
      const schemeId = orchestrationSchemeIdRef.current;
      const disabled = delegationDisabledRef.current;
      if (schemeId === ORCHESTRATION_SCHEME_OFF_ID && !disabled) {
        return;
      }
      commitControls(sessionId, { schemeId, delegationDisabled: disabled });
    },
    [commitControls],
  );

  /**
   * Resume answered with the Host-stored choice. Absent fields mean the Host
   * has nothing for this session, so the park cache (if any) stays in charge.
   */
  const restoreSessionOrchestration = useCallback(
    (restore: SessionOrchestrationRestore) => {
      if (restore.orchestrationSchemeId === undefined && restore.delegationDisabled !== true) {
        return;
      }
      if (activeSessionIdRef.current !== restore.sessionId) return;
      if (touchedSessionRef.current === restore.sessionId) return;
      setOrchestrationSchemeId(restore.orchestrationSchemeId ?? ORCHESTRATION_SCHEME_OFF_ID);
      setDelegationDisabled(restore.delegationDisabled === true);
    },
    [setDelegationDisabled, setOrchestrationSchemeId],
  );

  return {
    selectOrchestrationScheme,
    selectDelegationDisabled,
    resetOrchestrationForNewDraft,
    resetOrchestrationForSessionChange,
    bindOrchestrationSession,
    restoreSessionOrchestration,
  };
}
