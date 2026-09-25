import { useEffect, useMemo, useRef, useState } from 'react';
import { mobileLocalStorage } from '../../mobile-local-storage.js';
import {
  readDraft,
  readSessionSnapshot,
  writeDraft,
  writeSessionSnapshot,
  type SessionListSnapshot,
} from '../../hooks/mobile-offline-cache.js';
import type { InkstoneHost } from './inkstone-host-context.js';

const SNAPSHOT_WRITE_DELAY_MS = 1_000;
const DRAFT_WRITE_DELAY_MS = 400;

/**
 * Keeps the last Host session list on the device and hands it back while the
 * Host is unreachable, so a cold start in a tunnel still shows what exists.
 * Returns the snapshot only when it is standing in for an empty live list.
 */
export function useSessionListSnapshot(host: InkstoneHost): SessionListSnapshot | undefined {
  const ready = host.connectionState.kind === 'ready';
  const { endpoint, sessions, projects } = host;

  useEffect(() => {
    // An empty list right after connecting usually means "not loaded yet";
    // never let it overwrite the last good copy.
    if (!ready || sessions.length === 0) return undefined;
    const timer = setTimeout(() => {
      writeSessionSnapshot(mobileLocalStorage(), endpoint, sessions, projects);
    }, SNAPSHOT_WRITE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [ready, endpoint, sessions, projects]);

  const standIn = !ready && sessions.length === 0;
  return useMemo(
    () => (standIn ? readSessionSnapshot(mobileLocalStorage(), endpoint) : undefined),
    [standIn, endpoint],
  );
}

/**
 * The Host hook holds one composer text for the whole app; this gives each
 * session its own draft. Switching sessions stores the outgoing text under the
 * session it was written for and restores the incoming session's draft.
 */
export function useSessionDrafts(host: InkstoneHost): void {
  const { endpoint, activeSessionId, composerText, setComposerText } = host;
  const ownerRef = useRef(activeSessionId);
  const textRef = useRef(composerText);
  textRef.current = composerText;
  const [pending, setPending] = useState<{ owner: string; text: string } | undefined>();

  useEffect(() => {
    const previous = ownerRef.current;
    if (previous === activeSessionId) return;
    ownerRef.current = activeSessionId;
    const storage = mobileLocalStorage();
    if (previous !== undefined) writeDraft(storage, endpoint, previous, textRef.current);
    if (activeSessionId === undefined) return;
    const restored = readDraft(storage, endpoint, activeSessionId);
    // First selection after launch: keep text typed before any session existed.
    if (previous === undefined && restored.length === 0) return;
    setComposerText(restored);
  }, [activeSessionId, endpoint, setComposerText]);

  useEffect(() => {
    const owner = ownerRef.current;
    setPending(owner === undefined ? undefined : { owner, text: composerText });
  }, [composerText]);

  useEffect(() => {
    if (pending === undefined) return undefined;
    const flush = (): void => writeDraft(mobileLocalStorage(), endpoint, pending.owner, pending.text);
    const timer = setTimeout(flush, DRAFT_WRITE_DELAY_MS);
    // iOS may suspend the web view right after backgrounding; write now.
    const onHide = (): void => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [pending, endpoint]);
}
