/**
 * Memoize the app-level context-menu value so deep surfaces do not rebuild
 * dispatchers on every App render.
 *
 * Invariant: the value identity changes only with data that shapes `caps`
 * (project, session, host readiness, locale, Host client, media support).
 * Handler deps reach the dispatchers through a latest-ref instead: several of
 * them (notably `handleSend`) close over the composer text and change on every
 * keystroke, and every transcript row consumes this context — keying the memo
 * on them re-rendered the whole transcript per typed character.
 */
import { useInsertionEffect, useMemo, useRef } from 'react';
import type { DesktopContextMenuValue } from '../context-menu';
import {
  createDesktopContextMenuValue,
  type DesktopContextMenuValueDeps,
} from '../context-menu/desktop-context-menu-value';

export function useDesktopContextMenuValue(
  deps: DesktopContextMenuValueDeps,
): DesktopContextMenuValue {
  const latestDepsRef = useRef(deps);
  // Insertion effects run before layout effects, so a handler fired from a
  // child commit already sees this render's closures.
  useInsertionEffect(() => {
    latestDepsRef.current = deps;
  });
  const { activeSessionId, hostClient, hostReady, locale, projectPath } = deps;
  // Presence (not identity) decides the media capability and dispatcher.
  const hasMediaAttachment = deps.addMediaAttachment !== undefined;
  return useMemo(
    () =>
      createDesktopContextMenuValue({
        projectPath,
        activeSessionId,
        hostReady,
        locale,
        hostClient,
        addContextRef: (ref) => latestDepsRef.current.addContextRef(ref),
        ...(hasMediaAttachment
          ? {
              addMediaAttachment: (attachment) =>
                latestDepsRef.current.addMediaAttachment?.(attachment),
            }
          : {}),
        dispatchNotification: (action) => latestDepsRef.current.dispatchNotification(action),
        handleForkSession: (sessionId, messageId) =>
          latestDepsRef.current.handleForkSession(sessionId, messageId),
        handleOpenDocument: (doc) => latestDepsRef.current.handleOpenDocument(doc),
        handleRetryMessage: (messageId) => latestDepsRef.current.handleRetryMessage(messageId),
        handleSend: (text) => latestDepsRef.current.handleSend(text),
        openInspector: (tab) => latestDepsRef.current.openInspector(tab),
        requestTruncateAfter: (messageId) =>
          latestDepsRef.current.requestTruncateAfter(messageId),
        setComposer: (next) => latestDepsRef.current.setComposer(next),
      }),
    [activeSessionId, hasMediaAttachment, hostClient, hostReady, locale, projectPath],
  );
}
