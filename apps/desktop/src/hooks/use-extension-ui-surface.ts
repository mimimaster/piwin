/**
 * Extension surface for the active session (ADR 0078). The Host pushes whole
 * snapshots per session; this hook keeps the latest one per session, reads the
 * current snapshot when a session becomes active (late attach, reconnect),
 * and turns one-shot notices into toasts.
 */
import { useEffect, useState } from 'react';
import type {
  ExtensionUiSurfaceSnapshot,
  HostCommand,
  HostResponse,
  HostServerMessage,
} from '@piwin/contracts';
import { showUiNotification } from '@piwin/ui-kit';

export type ExtensionUiSurfaceHostPort = {
  subscribe(listener: (message: HostServerMessage) => void): () => void;
  request(command: HostCommand): Promise<HostResponse>;
  supportsCommand(type: HostCommand['type']): boolean;
};

export function useExtensionUiSurface(
  host: ExtensionUiSurfaceHostPort,
  activeSessionId: string | null,
): ExtensionUiSurfaceSnapshot | null {
  const [surfaces, setSurfaces] = useState<ReadonlyMap<string, ExtensionUiSurfaceSnapshot>>(
    () => new Map(),
  );

  useEffect(
    () =>
      host.subscribe((message) => {
        if (message.type === 'extension/ui_surface') {
          setSurfaces((current) => withSnapshot(current, message.snapshot));
          return;
        }
        if (message.type === 'extension/ui_notice') {
          showUiNotification({ tone: message.level, message: message.message });
        }
      }),
    [host],
  );

  useEffect(() => {
    if (!activeSessionId || !host.supportsCommand('extension/ui_surface_get')) return;
    let cancelled = false;
    void host
      .request({ type: 'extension/ui_surface_get', sessionId: activeSessionId })
      .then((response) => {
        if (cancelled) return;
        if (!response.success) {
          console.warn(`[extension-ui] surface read failed: ${response.error}`);
          return;
        }
        setSurfaces((current) => withSnapshot(current, response.data as ExtensionUiSurfaceSnapshot));
      });
    return () => {
      cancelled = true;
    };
  }, [host, activeSessionId]);

  if (!activeSessionId) return null;
  return surfaces.get(activeSessionId) ?? null;
}

function withSnapshot(
  current: ReadonlyMap<string, ExtensionUiSurfaceSnapshot>,
  snapshot: ExtensionUiSurfaceSnapshot,
): ReadonlyMap<string, ExtensionUiSurfaceSnapshot> {
  const next = new Map(current);
  const empty =
    snapshot.statuses.length === 0 &&
    snapshot.widgets.length === 0 &&
    snapshot.workingMessage === undefined;
  if (empty) next.delete(snapshot.sessionId);
  else next.set(snapshot.sessionId, snapshot);
  return next;
}
