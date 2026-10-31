/**
 * Device-local copy of the sidebar's session list, so a cold start or a
 * dropped remote connection still shows what exists (the classic phone
 * interface's offline snapshot, ported to the workbench).
 *
 * Display only: the Host list replaces it as soon as it arrives and nothing
 * here is ever sent back as Host state. Keyed per Host so two Hosts never
 * mix. Host filesystem paths, allowlists and transient agent state stay off
 * the device copy.
 */
import type { ProjectRecord } from '@piwin/contracts';
import type { SessionListItemUi } from '../conversation/chat-ui-types';
import type { DesktopLocale } from '../i18n/desktop-locale-id';
import type { ChatUiAction } from '../conversation/chat-ui-types';

const SNAPSHOT_VERSION = 1;
const KEY_PREFIX = 'piwin.desktop.session-list-snapshot.v1.';
export const MAX_SNAPSHOT_SESSIONS_PER_SCOPE = 200;
export const MAX_SNAPSHOT_PROJECTS = 50;
export const MAX_SNAPSHOT_PREVIEW_CHARS = 160;

type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>;

export type SnapshotProject = Pick<
  ProjectRecord,
  | 'path'
  | 'trust'
  | 'displayName'
  | 'lastOpenedAt'
  | 'createdAt'
  | 'gitRepositoryId'
  | 'isPrimaryWorktree'
  | 'currentBranch'
  | 'isCheckoutRoot'
>;

export type SessionListSnapshot = {
  version: typeof SNAPSHOT_VERSION;
  savedAt: string;
  general: SessionListItemUi[];
  /** Keyed by the project scope's `projectPath` (an opaque id on remote Hosts). */
  projects: Record<string, SessionListItemUi[]>;
  recentProjects: SnapshotProject[];
};

export function snapshotRestoreActions(
  snapshot: SessionListSnapshot,
): Extract<ChatUiAction, { type: 'session/hydrate-scope' }>[] {
  return [
    {
      type: 'session/hydrate-scope',
      scope: { kind: 'general' },
      sessions: snapshot.general,
      totalCount: snapshot.general.length,
      truncated: false,
    },
    ...Object.entries(snapshot.projects).map(([projectPath, sessions]) => ({
      type: 'session/hydrate-scope' as const,
      scope: { kind: 'project' as const, projectPath },
      sessions,
      totalCount: sessions.length,
      truncated: false,
    })),
  ];
}

export function sessionListSnapshotKey(hostKey: string): string {
  return `${KEY_PREFIX}${encodeURIComponent(hostKey.trim())}`;
}

function snapshotRow(session: SessionListItemUi): SessionListItemUi {
  const row: SessionListItemUi = { id: session.id, name: session.name };
  if (session.lastPreview !== undefined) {
    row.lastPreview = session.lastPreview.slice(0, MAX_SNAPSHOT_PREVIEW_CHARS);
  }
  if (session.messageCount !== undefined) row.messageCount = session.messageCount;
  if (session.updatedAt !== undefined) row.updatedAt = session.updatedAt;
  if (session.isPinned !== undefined) row.isPinned = session.isPinned;
  if (session.pinnedAt !== undefined) row.pinnedAt = session.pinnedAt;
  if (session.isArchived !== undefined) row.isArchived = session.isArchived;
  if (session.archivedAt !== undefined) row.archivedAt = session.archivedAt;
  if (session.scope !== undefined) row.scope = session.scope;
  if (session.backend !== undefined) {
    row.backend = {
      agentId: session.backend.agentId,
      ...(session.backend.isWorktree !== undefined ? { isWorktree: session.backend.isWorktree } : {}),
    };
  }
  return row;
}

function snapshotRows(sessions: readonly SessionListItemUi[]): SessionListItemUi[] {
  return sessions.slice(0, MAX_SNAPSHOT_SESSIONS_PER_SCOPE).map(snapshotRow);
}

function snapshotProject(project: ProjectRecord): SnapshotProject {
  const kept: SnapshotProject = {
    path: project.path,
    trust: project.trust,
    lastOpenedAt: project.lastOpenedAt,
    createdAt: project.createdAt,
  };
  if (project.displayName !== undefined) kept.displayName = project.displayName;
  if (project.gitRepositoryId !== undefined) kept.gitRepositoryId = project.gitRepositoryId;
  if (project.isPrimaryWorktree !== undefined) kept.isPrimaryWorktree = project.isPrimaryWorktree;
  if (project.currentBranch !== undefined) kept.currentBranch = project.currentBranch;
  if (project.isCheckoutRoot !== undefined) kept.isCheckoutRoot = project.isCheckoutRoot;
  return kept;
}

export function buildSessionListSnapshot(input: {
  general: readonly SessionListItemUi[];
  projectSessionsByPath: Readonly<Record<string, readonly SessionListItemUi[]>>;
  recentProjects: readonly ProjectRecord[];
  now?: Date;
}): SessionListSnapshot {
  const recentProjects = input.recentProjects.slice(0, MAX_SNAPSHOT_PROJECTS).map(snapshotProject);
  const projects: Record<string, SessionListItemUi[]> = {};
  // Only folders the sidebar can show are worth keeping.
  for (const project of recentProjects) {
    const sessions = input.projectSessionsByPath[project.path];
    if (sessions !== undefined && sessions.length > 0)
      projects[project.path] = snapshotRows(sessions);
  }
  return {
    version: SNAPSHOT_VERSION,
    savedAt: (input.now ?? new Date()).toISOString(),
    general: snapshotRows(input.general),
    projects,
    recentProjects,
  };
}

/** A snapshot with nothing in it is never worth writing over a good one. */
export function isEmptySessionListSnapshot(snapshot: SessionListSnapshot): boolean {
  return snapshot.general.length === 0 && Object.keys(snapshot.projects).length === 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseRows(value: unknown): SessionListItemUi[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (row): row is SessionListItemUi =>
      isRecord(row) && typeof row.id === 'string' && typeof row.name === 'string',
  ).map(snapshotRow);
}

function parseProjects(value: unknown): SnapshotProject[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (project): project is SnapshotProject =>
      isRecord(project) &&
      typeof project.path === 'string' &&
      (project.trust === 'trusted' || project.trust === 'untrusted') &&
      typeof project.lastOpenedAt === 'string' &&
      typeof project.createdAt === 'string',
  );
}

export function parseSessionListSnapshot(raw: string): SessionListSnapshot | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error: unknown) {
    console.warn('[session-list-snapshot] dropping unreadable snapshot', error);
    return undefined;
  }
  if (!isRecord(value) || value.version !== SNAPSHOT_VERSION || typeof value.savedAt !== 'string') {
    return undefined;
  }
  const projects: Record<string, SessionListItemUi[]> = {};
  if (isRecord(value.projects)) {
    for (const [path, rows] of Object.entries(value.projects)) {
      const parsed = parseRows(rows);
      if (parsed.length > 0) projects[path] = parsed;
    }
  }
  return {
    version: SNAPSHOT_VERSION,
    savedAt: value.savedAt,
    general: parseRows(value.general),
    projects,
    recentProjects: parseProjects(value.recentProjects),
  };
}

export function readSessionListSnapshot(
  storage: KeyValueStorage | undefined,
  hostKey: string,
): SessionListSnapshot | undefined {
  if (storage === undefined || hostKey.trim().length === 0) return undefined;
  let raw: string | null;
  try {
    raw = storage.getItem(sessionListSnapshotKey(hostKey));
  } catch (error: unknown) {
    console.warn('[session-list-snapshot] storage read failed', error);
    return undefined;
  }
  return raw === null ? undefined : parseSessionListSnapshot(raw);
}

export function writeSessionListSnapshot(
  storage: KeyValueStorage | undefined,
  hostKey: string,
  snapshot: SessionListSnapshot,
): void {
  if (
    storage === undefined ||
    hostKey.trim().length === 0 ||
    isEmptySessionListSnapshot(snapshot)
  ) {
    return;
  }
  try {
    storage.setItem(sessionListSnapshotKey(hostKey), JSON.stringify(snapshot));
  } catch (error: unknown) {
    // Quota or blocked storage: the snapshot is optional, the app keeps working.
    console.warn('[session-list-snapshot] storage write failed', error);
  }
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** "14:05" today, "10月27日 14:05" / "Oct 27 14:05" otherwise. */
export function formatSnapshotSyncTime(
  savedAt: string,
  locale: DesktopLocale,
  now: Date = new Date(),
): string {
  const saved = new Date(savedAt);
  if (Number.isNaN(saved.getTime())) return locale === 'en' ? 'unknown' : '未知';
  const clock = `${pad(saved.getHours())}:${pad(saved.getMinutes())}`;
  if (saved.toDateString() === now.toDateString()) return clock;
  if (locale === 'en') {
    const month = saved.toLocaleString('en', { month: 'short' });
    return `${month} ${saved.getDate()} ${clock}`;
  }
  return `${saved.getMonth() + 1}月${saved.getDate()}日 ${clock}`;
}
