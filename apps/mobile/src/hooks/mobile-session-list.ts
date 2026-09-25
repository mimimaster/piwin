import { useSyncExternalStore, type Dispatch, type SetStateAction } from 'react';
import type { HostPush, HostResponse, RemoteSessionSummary } from '@piwin/contracts';
import type { HostClient } from '@piwin/host-client';
import { readSessions } from '../mobile-host-readers.js';
import { isRecord, toError } from '../mobile-host-helpers.js';
import { createMobileIdempotencyKey, executeMobileMutation } from '../mobile-prompt-send.js';

/**
 * Session list authority on the phone: the Host's `session/list`. Pushes only
 * patch what they fully describe (a rename); anything structural (created,
 * archived, pinned, preview touched) re-reads the list so the phone never
 * reconstructs Host index semantics.
 */
const SESSION_LIST_PAGE_SIZE = 80;
const REFRESH_DEBOUNCE_MS = 400;

/**
 * How much of the Host's session list the phone is showing. One app, one
 * list: every `session/list` goes through this window so "加载更多" survives
 * refreshes triggered by pushes and mutations.
 */
export interface SessionListWindow {
  limit: number;
  total: number | undefined;
  truncated: boolean;
}

let listWindow: SessionListWindow = { limit: SESSION_LIST_PAGE_SIZE, total: undefined, truncated: false };
const windowListeners = new Set<() => void>();

function setListWindow(next: SessionListWindow): void {
  if (next.limit === listWindow.limit && next.total === listWindow.total && next.truncated === listWindow.truncated) {
    return;
  }
  listWindow = next;
  for (const listener of windowListeners) listener();
}

export function useSessionListWindow(): SessionListWindow {
  return useSyncExternalStore(
    (listener) => {
      windowListeners.add(listener);
      return () => windowListeners.delete(listener);
    },
    () => listWindow,
  );
}

export function mobileSessionListCommand(): {
  type: 'session/list';
  allScopes: true;
  order: 'updated';
  maxItems: number;
} {
  return {
    type: 'session/list',
    allScopes: true,
    order: 'updated',
    maxItems: listWindow.limit,
  };
}

/** `readSessions` plus the Host's `totalCount` / `truncated` for the window. */
export function readSessionListPage(response: HostResponse): RemoteSessionSummary[] {
  if (response.success && typeof response.data === 'object' && response.data !== null) {
    const data = response.data as { totalCount?: unknown; truncated?: unknown };
    setListWindow({
      limit: listWindow.limit,
      total: typeof data.totalCount === 'number' ? data.totalCount : listWindow.total,
      truncated: data.truncated === true,
    });
  }
  return readSessions(response);
}

/** A rename is self-contained; returns undefined when the push is not one. */
export function applySessionNamePush(
  sessions: RemoteSessionSummary[],
  push: HostPush,
): RemoteSessionSummary[] | undefined {
  if (push.type !== 'session/name-updated') return undefined;
  let changed = false;
  const next = sessions.map((session) => {
    if (session.sessionId !== push.sessionId || session.name === push.name) return session;
    changed = true;
    return { ...session, name: push.name };
  });
  return changed ? next : undefined;
}

export function sessionListNeedsRefresh(push: HostPush): boolean {
  return push.type === 'session/index-updated' || push.type === 'subagent/updated';
}

export interface SessionListSync {
  handlePush: (client: HostClient, push: HostPush) => void;
  /** Widen the window by one page and re-read the list. */
  loadMore: (client: HostClient) => Promise<void>;
  dispose: () => void;
}

export function createSessionListSync(
  setSessions: Dispatch<SetStateAction<RemoteSessionSummary[]>>,
): SessionListSync {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    handlePush(client, push) {
      const renamed = (current: RemoteSessionSummary[]) => applySessionNamePush(current, push) ?? current;
      if (push.type === 'session/name-updated') {
        setSessions(renamed);
        return;
      }
      if (!sessionListNeedsRefresh(push)) return;
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        client
          .request(mobileSessionListCommand())
          .then((response) => {
            if (response.success) setSessions(readSessionListPage(response));
          })
          .catch((error: unknown) => {
            console.warn('[mobile] session list refresh failed', error);
          });
      }, REFRESH_DEBOUNCE_MS);
    },
    async loadMore(client) {
      setListWindow({ ...listWindow, limit: listWindow.limit + SESSION_LIST_PAGE_SIZE });
      const response = await client.request(mobileSessionListCommand());
      if (response.success) setSessions(readSessionListPage(response));
    },
    dispose() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
  };
}

/** Pin / rename: Host mutation, then re-read the authoritative list. */
export async function runSessionListMutation(input: {
  client: HostClient | undefined;
  command:
    | { type: 'session/pin' | 'session/unpin'; sessionId: string }
    | { type: 'session/rename'; sessionId: string; name: string };
  setSessions: Dispatch<SetStateAction<RemoteSessionSummary[]>>;
  setErrorMessage: (message: string | undefined) => void;
  failureMessage: string;
}): Promise<boolean> {
  const { client } = input;
  if (client === undefined) return false;
  try {
    const response = await client.request(input.command);
    if (!response.success) {
      input.setErrorMessage(response.error);
      return false;
    }
    input.setSessions(readSessionListPage(await client.request(mobileSessionListCommand())));
    return true;
  } catch (error) {
    input.setErrorMessage(toError(error, input.failureMessage).message);
    return false;
  }
}

export type MobileSessionCreateResult =
  | { ok: true; sessionId: string; sessions: RemoteSessionSummary[] }
  | { ok: false; message: string };

/** `projectId` binds a project session; omit it for a general conversation. */
export async function createMobileSession(
  client: HostClient,
  projectId: string | undefined,
): Promise<MobileSessionCreateResult> {
  try {
    const response = await executeMobileMutation(
      (command, options) => client.request(command, options),
      {
        type: 'session/create',
        input: {
          sessionName: 'Mobile session',
          ...(projectId === undefined || projectId.length === 0
            ? { scope: { kind: 'general' as const } }
            : { projectId }),
        },
      },
      createMobileIdempotencyKey(),
    );
    if (!response.success || !isRecord(response.data) || typeof response.data.sessionId !== 'string') {
      return { ok: false, message: response.success ? 'Host 未返回新会话 ID。' : response.error };
    }
    const sessions = readSessionListPage(await client.request(mobileSessionListCommand()));
    return { ok: true, sessionId: response.data.sessionId, sessions };
  } catch (error) {
    return { ok: false, message: toError(error, '创建会话失败。').message };
  }
}
