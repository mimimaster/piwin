import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useMediaPreviewRead } from '../media/media-preview-read-context.js';
import {
  sessionRenderResourceKey,
  sessionRenderResources,
} from '../session/session-render-resources.js';

/** Discard only inactive presentations; showing their session restores their renderer. */
export function useSessionRenderRetention(
  input: {
    sessionId?: string;
    beforeReclaim?: () => void;
  } = {},
): boolean {
  const owner = useMediaPreviewRead();
  const sessionId = input.sessionId ?? owner.sessionId;
  const sessionKey =
    sessionId !== null && owner.resourceHostKey !== null
      ? sessionRenderResourceKey(owner.resourceHostKey, sessionId)
      : null;
  const beforeReclaimRef = useRef(input.beforeReclaim);
  beforeReclaimRef.current = input.beforeReclaim;
  const visible = useSyncExternalStore(
    sessionRenderResources.subscribe,
    () => sessionKey === null || sessionRenderResources.isVisible(sessionKey),
    () => true,
  );
  const [snapshot, setSnapshot] = useState({ sessionKey, retained: true });
  useEffect(() => {
    if (sessionKey === null) return;
    return sessionRenderResources.register(sessionKey, () => {
      beforeReclaimRef.current?.();
      setSnapshot({ sessionKey, retained: false });
    });
  }, [sessionKey]);
  useEffect(() => {
    if (visible) setSnapshot({ sessionKey, retained: true });
  }, [visible, sessionKey]);
  return visible || snapshot.sessionKey !== sessionKey || snapshot.retained;
}
