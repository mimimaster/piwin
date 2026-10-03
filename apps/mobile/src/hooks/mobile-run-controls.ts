import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { HostClient } from '@piwin/host-client';
import type { RemotePermissionRequest } from '../mobile-transcript.js';
import {
  buildMobileAbortCommand,
  buildMobilePermissionResolveCommand,
  createMobileIdempotencyKey,
  executeMobileMutation,
} from '../mobile-prompt-send.js';
import { toError } from '../mobile-host-helpers.js';

/** Resolves to an error message, or undefined when the Host accepted the stop. */
export async function abortMobileRun(
  client: HostClient,
  sessionId: string,
  runId: string,
): Promise<string | undefined> {
  try {
    const response = await executeMobileMutation(
      (command, options) => client.request(command, options),
      buildMobileAbortCommand(sessionId, runId),
      createMobileIdempotencyKey(),
    );
    return response.success ? undefined : response.error;
  } catch (error) {
    return toError(error, '停止运行失败。').message;
  }
}

/** Owns only the existing permission relay and its current-request busy state. */
export function useMobilePermission({ clientRef, activeSessionRef, setErrorMessage, onResolved }: {
  clientRef: RefObject<HostClient | undefined>;
  activeSessionRef: RefObject<string | undefined>;
  setErrorMessage: (message: string | undefined) => void;
  onResolved: (client: HostClient) => Promise<void>;
}) {
  const [permissionRequest, setRequest] = useState<RemotePermissionRequest | undefined>();
  const [isResolvingPermission, setResolving] = useState(false);
  const requestRef = useRef<RemotePermissionRequest | undefined>(undefined);
  const pendingRef = useRef<object | undefined>(undefined);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; pendingRef.current = undefined; };
  }, []);

  // Pushes invalidate ownership synchronously, before React paints the new card.
  const setPermissionRequest: Dispatch<SetStateAction<RemotePermissionRequest | undefined>> = useCallback((update) => {
    const next = typeof update === 'function' ? update(requestRef.current) : update;
    const current = requestRef.current;
    const sameRequest = next !== undefined && current !== undefined &&
      next.requestId === current.requestId && next.sessionId === current.sessionId;
    if (!sameRequest) {
      pendingRef.current = undefined;
      setResolving(false);
    }
    requestRef.current = next;
    setRequest(next);
  }, []);

  const handleResolvePermission = async (
    decision: 'allow' | 'deny',
    requestId?: string,
    rememberScope: 'once' | 'session' | 'project' = 'once',
  ): Promise<boolean> => {
    const client = clientRef.current;
    const request = requestRef.current;
    const sessionId = activeSessionRef.current;
    if (!mountedRef.current || client === undefined || request === undefined ||
        (requestId !== undefined && requestId !== request.requestId) ||
        (sessionId !== undefined && request.sessionId !== sessionId) ||
        client.getState().kind !== 'ready' || pendingRef.current !== undefined) return false;
    const token = {};
    pendingRef.current = token;
    const ownsRequest = () => mountedRef.current && pendingRef.current === token &&
      clientRef.current === client && activeSessionRef.current === sessionId &&
      requestRef.current?.requestId === request.requestId &&
      requestRef.current.sessionId === request.sessionId && client.getState().kind === 'ready';
    setResolving(true);
    setErrorMessage(undefined);
    try {
      const error = await resolveMobilePermission(client, request.requestId, decision, rememberScope);
      if (!ownsRequest()) return false;
      if (error !== undefined) {
        setErrorMessage(error);
        return false;
      }
      setPermissionRequest(undefined);
      void onResolved(client).catch((reason: unknown) => console.warn('[mobile] permission activity refresh failed', reason));
      return true;
    } finally {
      if (pendingRef.current === token) {
        const current = ownsRequest();
        pendingRef.current = undefined;
        if (current) setResolving(false);
      }
    }
  };
  return { permissionRequest, setPermissionRequest, isResolvingPermission, handleResolvePermission };
}

/** Relays 允/否 plus the remember scope; the Host owns the decision. */
export async function resolveMobilePermission(
  client: HostClient,
  requestId: string,
  decision: 'allow' | 'deny',
  rememberScope: 'once' | 'session' | 'project',
): Promise<string | undefined> {
  try {
    const response = await executeMobileMutation(
      (command, options) => client.request(command, options),
      buildMobilePermissionResolveCommand(requestId, decision, rememberScope),
      createMobileIdempotencyKey(),
    );
    return response.success ? undefined : response.error;
  } catch (error) {
    return toError(error, '处理权限请求失败。').message;
  }
}
