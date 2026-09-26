import type { RemoteProjectSummary, RemoteSessionSummary } from '@piwin/contracts';
import { mobileLocalStorage } from '../mobile-local-storage.js';

/**
 * The two halves of the product, same split as Desktop's `SidebarMode`:
 * `chat` is a conversation without a workspace, `agent` works inside a Host
 * project. A session's half is decided by its scope, never stored.
 */
export type SessionMode = 'chat' | 'agent';

export const SESSION_MODE_STORAGE_KEY = 'piwin.mobile.session-mode.v1';

export const SESSION_MODE_LABELS: Record<SessionMode, string> = {
  chat: '对话',
  agent: 'Agent',
};

export function sessionModeOf(session: Pick<RemoteSessionSummary, 'scope'> | undefined): SessionMode {
  return session?.scope === 'project' ? 'agent' : 'chat';
}

export function filterSessionsByMode(
  sessions: readonly RemoteSessionSummary[],
  mode: SessionMode,
): RemoteSessionSummary[] {
  return sessions.filter((session) => sessionModeOf(session) === mode);
}

/**
 * The project a new Agent draft starts in: the one the user worked in most
 * recently, else the first project the Host lists. Undefined when the Host has
 * no projects, in which case the draft starts as a general conversation.
 */
export function pickDefaultAgentProjectId(
  sessions: readonly RemoteSessionSummary[],
  projects: readonly RemoteProjectSummary[],
): string | undefined {
  const known = new Set(projects.map((project) => project.projectId));
  let latest: { projectId: string; time: number } | undefined;
  for (const session of sessions) {
    if (session.archived === true || session.projectId === undefined || !known.has(session.projectId)) {
      continue;
    }
    const time = session.updatedAt === undefined ? 0 : Date.parse(session.updatedAt);
    const comparable = Number.isNaN(time) ? 0 : time;
    if (latest === undefined || comparable > latest.time) {
      latest = { projectId: session.projectId, time: comparable };
    }
  }
  return latest?.projectId ?? projects[0]?.projectId;
}

export function readSessionMode(
  storage: Pick<Storage, 'getItem'> | undefined = mobileLocalStorage(),
): SessionMode {
  try {
    const raw = storage?.getItem(SESSION_MODE_STORAGE_KEY);
    return raw === 'agent' ? 'agent' : 'chat';
  } catch {
    return 'chat';
  }
}

export function writeSessionMode(
  mode: SessionMode,
  storage: Pick<Storage, 'setItem'> | undefined = mobileLocalStorage(),
): void {
  try {
    storage?.setItem(SESSION_MODE_STORAGE_KEY, mode);
  } catch {
    // Remembering the tab is a convenience; the list still works without it.
  }
}
