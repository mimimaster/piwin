/**
 * Remote Desktop session list / project mapping.
 *
 * Remote Hosts reject path-owning `session/list.scope` and do not allow
 * `config/get`. Listing uses `scopeRef` (general / all-authorized / projectId)
 * and maps projected `{ sessionId, projectId }` payloads back onto Desktop's
 * local list-item shape. Synthetic `projectPath` values are opaque projectIds,
 * never Host filesystem paths.
 */
import type {
  HostCommand,
  HostPush,
  HostResponse,
  ModelRef,
  ProjectRecord,
  SessionListOrder,
  SessionScope,
  ThinkingLevel,
} from '@piwin/contracts';
import { isThinkingLevel, parseSessionStorageInfo } from '@piwin/contracts';
import type { ChatUiAction, SessionListItemUi } from './chat-reducer';
import { clearLocalRootPresenceForTests } from './local-file-reveal-policy.js';
import { MAX_RECENT_PROJECTS } from './record-budget';

export type DesktopHostTransport = 'mock' | 'live' | 'remote';

export function isRemoteDesktopTransport(
  transport: string,
): transport is 'remote' {
  return transport === 'remote';
}

/** Host-issued remote project id (`project-` + 24 hex). Never a filesystem path. */
export function isOpaqueRemoteProjectId(value: string): boolean {
  return /^project-[a-f0-9]{24}$/.test(value);
}

function looksLikeHostFilesystemPath(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0 || isOpaqueRemoteProjectId(trimmed)) {
    return false;
  }
  return (
    trimmed.startsWith('/') ||
    /^[A-Za-z]:[\\/]/.test(trimmed) ||
    trimmed.startsWith('\\\\')
  );
}

/** Opaque projectId → Host filesystem root (for copy-absolute-path / reveal joins). */
const remoteProjectRootsById = new Map<string, string>();

export function rememberRemoteProjectRoot(projectId: string, filesystemPath: string): void {
  if (!isOpaqueRemoteProjectId(projectId) || !looksLikeHostFilesystemPath(filesystemPath)) {
    return;
  }
  const root = filesystemPath.replace(/[\\/]+$/, '');
  remoteProjectRootsById.set(projectId, root);
  // Fire-and-forget: remote Reveal stays off until Desktop confirms the root
  // exists on this machine (policy A — same-machine / shared disk only).
  void import('./local-file-actions.js')
    .then((mod) => mod.probeLocalFilesystemRoot(root))
    .catch(() => undefined);
}

export function rememberRemoteProjectRootsFromList(listData: unknown): void {
  const record = isRecord(listData) ? listData : undefined;
  const projects = Array.isArray(record?.projects) ? record.projects : [];
  for (const project of projects) {
    if (!isRecord(project)) continue;
    const id = typeof project.projectId === 'string' ? project.projectId.trim() : '';
    const hostPath = typeof project.path === 'string' ? project.path.trim() : '';
    if (id.length > 0 && hostPath.length > 0) {
      rememberRemoteProjectRoot(id, hostPath);
    }
  }
}

/** Host filesystem root for an opaque projectId, when known from list/open. */
export function remoteProjectFilesystemRoot(projectId: string): string | null {
  if (!isOpaqueRemoteProjectId(projectId)) {
    return looksLikeHostFilesystemPath(projectId) ? projectId.replace(/[\\/]+$/, '') : null;
  }
  return remoteProjectRootsById.get(projectId) ?? null;
}

/**
 * Resolve a Desktop project key (opaque id or filesystem path) to the Host
 * root used for absolute path joins. Falls back to the key itself.
 */
export function resolveProjectFilesystemRoot(projectPath: string | null | undefined): string {
  const key = (projectPath ?? '').trim();
  if (!key) return '';
  return remoteProjectFilesystemRoot(key) ?? key.replace(/[\\/]+$/, '');
}

/** Test seam: clear remembered remote roots. */
export function clearRemoteProjectRootsForTests(): void {
  remoteProjectRootsById.clear();
  clearLocalRootPresenceForTests();
}

export type ProjectActivationResult =
  | { ok: true; path: string; trusted: boolean }
  | { ok: false; error: string };

/**
 * Local sidecar opens folders with `project/open`. Remote shells only see opaque
 * projectIds from `project/list` — `project/open` is intentionally blocked.
 */
export async function activateProjectOnHost(
  request: (command: HostCommand) => Promise<HostResponse>,
  transport: DesktopHostTransport,
  projectKey: string,
  options?: { autoTrust?: boolean },
): Promise<ProjectActivationResult> {
  if (isRemoteDesktopTransport(transport)) {
    if (isOpaqueRemoteProjectId(projectKey)) {
      const listed = await request({ type: 'project/list' });
      if (!listed.success) {
        return { ok: false, error: listed.error };
      }
      rememberRemoteProjectRootsFromList(listed.data);
      const record = mapListedProjects(listed.data).find((project) => project.path === projectKey);
      let trusted = record?.trust === 'trusted';
      if (!trusted && options?.autoTrust !== false) {
        const trustResponse = await request({ type: 'project/trust', path: projectKey });
        if (!trustResponse.success) {
          return { ok: false, error: trustResponse.error };
        }
        trusted = true;
      }
      if (!trusted) {
        return {
          ok: false,
          error: 'This project is not trusted on the Host.',
        };
      }
      return { ok: true, path: projectKey, trusted: true };
    }
    const openResponse = await request({ type: 'project/open', path: projectKey });
    if (!openResponse.success) {
      return { ok: false, error: openResponse.error };
    }
    const openPayload = openResponse.data as {
      projectId?: string;
      path?: string;
      trusted?: boolean;
      trust?: string;
    };
    const projectId =
      typeof openPayload.projectId === 'string' && isOpaqueRemoteProjectId(openPayload.projectId)
        ? openPayload.projectId
        : typeof openPayload.path === 'string' && isOpaqueRemoteProjectId(openPayload.path)
          ? openPayload.path
          : '';
    if (!projectId) {
      return {
        ok: false,
        error: 'Host did not return a project id for this workspace.',
      };
    }
    const hostPath =
      typeof openPayload.path === 'string' && looksLikeHostFilesystemPath(openPayload.path)
        ? openPayload.path
        : looksLikeHostFilesystemPath(projectKey)
          ? projectKey
          : null;
    if (hostPath) {
      rememberRemoteProjectRoot(projectId, hostPath);
    }
    let trusted = openPayload.trusted === true || openPayload.trust === 'trusted';
    if (!trusted && options?.autoTrust !== false) {
      const trustResponse = await request({ type: 'project/trust', path: projectId });
      if (!trustResponse.success) {
        return { ok: false, error: trustResponse.error };
      }
      trusted = true;
    }
    if (!trusted) {
      return { ok: true, path: projectId, trusted: false };
    }
    return { ok: true, path: projectId, trusted: true };
  }

  const openResponse = await request({ type: 'project/open', path: projectKey });
  if (!openResponse.success) {
    return { ok: false, error: openResponse.error };
  }
  const openPayload = openResponse.data as {
    path?: string;
    trusted?: boolean;
    trust?: string;
  };
  let trusted = openPayload.trusted === true || openPayload.trust === 'trusted';
  const openedPath = openPayload.path ?? projectKey;
  if (!trusted && options?.autoTrust !== false) {
    const trustResponse = await request({ type: 'project/trust', path: openedPath });
    if (!trustResponse.success) {
      return { ok: false, error: trustResponse.error };
    }
    trusted = true;
  }
  if (!trusted) {
    return { ok: true, path: openedPath, trusted: false };
  }
  return { ok: true, path: openedPath, trusted: true };
}

export type SessionCreateInputPayload = {
  scope?: SessionScope;
  projectPath?: string;
  projectId?: string;
  sessionName?: string;
  model?: ModelRef;
  thinkingLevel?: ThinkingLevel;
};

/** Remote `session/create` must send `projectId`, never path-owning scope. */
export function sessionCreateInputForTransport(
  transport: DesktopHostTransport,
  input: {
    useGeneral: boolean;
    projectKey?: string;
    sessionName?: string;
    model?: ModelRef;
    thinkingLevel?: ThinkingLevel;
  },
): SessionCreateInputPayload {
  const common = {
    ...(input.sessionName !== undefined ? { sessionName: input.sessionName } : {}),
    ...(input.model !== undefined ? { model: input.model } : {}),
    ...(input.thinkingLevel !== undefined ? { thinkingLevel: input.thinkingLevel } : {}),
  };
  if (input.useGeneral) {
    return { ...common, scope: { kind: 'general' } };
  }
  const projectKey = input.projectKey?.trim() ?? '';
  if (projectKey.length === 0) {
    return common;
  }
  if (transport === 'remote' && isOpaqueRemoteProjectId(projectKey)) {
    return { ...common, projectId: projectKey };
  }
  return {
    ...common,
    scope: { kind: 'project', projectPath: projectKey },
    projectPath: projectKey,
  };
}

export function sessionListCommandForTransport(input: {
  transport: DesktopHostTransport;
  scope: SessionScope;
  includeArchived?: boolean;
  order?: SessionListOrder;
  maxItems?: number;
  allScopes?: boolean;
}): HostCommand {
  const common = {
    type: 'session/list' as const,
    ...(input.includeArchived === undefined ? {} : { includeArchived: input.includeArchived }),
    ...(input.order === undefined ? {} : { order: input.order }),
    ...(input.maxItems === undefined ? {} : { maxItems: input.maxItems }),
  };
  if (input.transport !== 'remote') {
    return {
      ...common,
      scope: input.scope,
      ...(input.allScopes === undefined ? {} : { allScopes: input.allScopes }),
    };
  }
  if (input.allScopes === true) {
    return { ...common, scopeRef: { kind: 'all-authorized' } };
  }
  if (input.scope.kind === 'general') {
    return { ...common, scopeRef: { kind: 'general' } };
  }
  return {
    ...common,
    scopeRef: { kind: 'project', projectId: input.scope.projectPath },
  };
}

export function mapListedSessionItems(data: unknown): {
  sessions: SessionListItemUi[];
  totalCount: number;
  truncated: boolean;
} {
  const record = isRecord(data) ? data : undefined;
  const rawSessions = Array.isArray(record?.sessions) ? record.sessions : [];
  const sessions = rawSessions
    .map((session) => mapListedSessionItem(session))
    .filter((session): session is SessionListItemUi => session !== undefined);
  const totalCount =
    typeof record?.totalCount === 'number' &&
    Number.isSafeInteger(record.totalCount) &&
    record.totalCount >= 0
      ? record.totalCount
      : sessions.length;
  return {
    sessions,
    totalCount,
    truncated: record?.truncated === true,
  };
}

/**
 * Hello hydration used to dispatch one `session/update` per row. Each update
 * copies the whole chat UI state (lists + live transcript), so 200 sessions
 * meant 200 full copies in one WebSocket turn. Replace each scope once.
 */
export function hydrationSessionApplyActions(
  sessions: readonly SessionListItemUi[],
): Extract<ChatUiAction, { type: 'session/hydrate-scope' }>[] {
  const general: SessionListItemUi[] = [];
  const byProject = new Map<string, SessionListItemUi[]>();
  for (const session of sessions) {
    if (session.scope?.kind === 'project') {
      const list = byProject.get(session.scope.projectPath) ?? [];
      list.push(session);
      byProject.set(session.scope.projectPath, list);
    } else {
      general.push(session);
    }
  }
  const actions: Extract<ChatUiAction, { type: 'session/hydrate-scope' }>[] = [];
  if (general.length > 0) {
    actions.push({
      type: 'session/hydrate-scope',
      scope: { kind: 'general' },
      sessions: general,
      totalCount: general.length,
      truncated: false,
    });
  }
  for (const [projectPath, projectSessions] of byProject) {
    actions.push({
      type: 'session/hydrate-scope',
      scope: { kind: 'project', projectPath },
      sessions: projectSessions,
      totalCount: projectSessions.length,
      truncated: false,
    });
  }
  return actions;
}

export function mergeRecentProjects(
  previous: ProjectRecord[],
  fetched: ProjectRecord[],
  keepPaths: readonly string[] = [],
): ProjectRecord[] {
  if (previous.length === 0) {
    return capRecentProjects(fetched, keepPaths);
  }
  const previousByPath = new Map(previous.map((project) => [project.path, project]));
  const fetchedByPath = new Map(fetched.map((project) => [project.path, project]));
  const added = fetched.filter((project) => !previousByPath.has(project.path));
  const kept = previous
    .map((project) => fetchedByPath.get(project.path) ?? project)
    .filter((project) => fetchedByPath.has(project.path));
  const next = capRecentProjects([...added, ...kept], keepPaths);
  if (
    next.length === previous.length &&
    next.every(
      (project, index) =>
        project.path === previous[index]?.path &&
        project.displayName === previous[index]?.displayName &&
        project.gitRepositoryId === previous[index]?.gitRepositoryId &&
        project.currentBranch === previous[index]?.currentBranch &&
        project.isPrimaryWorktree === previous[index]?.isPrimaryWorktree &&
        project.gitRootPath === previous[index]?.gitRootPath,
    )
  ) {
    return previous;
  }
  return next;
}

/** Keep the active project plus the newest remaining rows. */
function capRecentProjects(
  projects: ProjectRecord[],
  keepPaths: readonly string[] = [],
): ProjectRecord[] {
  if (projects.length <= MAX_RECENT_PROJECTS) {
    return projects;
  }
  const keep = new Set(keepPaths);
  const pinned: ProjectRecord[] = [];
  const rest: ProjectRecord[] = [];
  for (const project of projects) {
    if (keep.has(project.path)) {
      pinned.push(project);
    } else {
      rest.push(project);
    }
  }
  const room = Math.max(0, MAX_RECENT_PROJECTS - pinned.length);
  return [...pinned, ...rest.slice(0, room)];
}

export function mapListedProjects(data: unknown): ProjectRecord[] {
  const record = isRecord(data) ? data : undefined;
  const rawProjects = Array.isArray(record?.projects) ? record.projects : [];
  const projects: ProjectRecord[] = [];
  for (const project of rawProjects) {
    const mapped = mapListedProject(project);
    if (mapped !== undefined) {
      projects.push(mapped);
    }
  }
  return projects;
}

export function sessionUpdateFromIndexPush(
  op: Extract<HostPush, { type: 'session/index-updated' }>['op'],
  listed: SessionListItemUi,
): Extract<ChatUiAction, { type: 'session/update' }> {
  if (op === 'unarchived') {
    return {
      type: 'session/update',
      session: { ...listed, isArchived: false },
      restore: true,
    };
  }
  return { type: 'session/update', session: listed };
}

export function mapListedSessionItem(value: unknown): SessionListItemUi | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const id =
    typeof value.id === 'string' && value.id.trim().length > 0
      ? value.id
      : typeof value.sessionId === 'string'
        ? value.sessionId.trim()
        : '';
  if (id.length === 0) {
    return undefined;
  }
  const item: SessionListItemUi = {
    id,
    name: typeof value.name === 'string' ? value.name.trim() : '',
  };
  if (typeof value.lastPreview === 'string') item.lastPreview = value.lastPreview;
  if (typeof value.messageCount === 'number') item.messageCount = value.messageCount;
  if (typeof value.updatedAt === 'string') item.updatedAt = value.updatedAt;
  if (value.isPinned === true || value.pinned === true) item.isPinned = true;
  if (value.isPinned === false || value.pinned === false) item.isPinned = false;
  if (typeof value.pinnedAt === 'string') item.pinnedAt = value.pinnedAt;
  if (value.isArchived === true || value.archived === true) item.isArchived = true;
  if (value.isArchived === false || value.archived === false) item.isArchived = false;
  if (typeof value.archivedAt === 'string') item.archivedAt = value.archivedAt;
  const scope = mapListedSessionScope(value);
  if (scope !== undefined) item.scope = scope;
  const model = readListedModelRef(value.model);
  if (model) item.model = model;
  if (isThinkingLevel(value.thinkingLevel)) item.thinkingLevel = value.thinkingLevel;
  const storage = parseSessionStorageInfo(value.storage);
  if (storage && storage.state !== 'local') item.storage = storage;
  return item;
}

function readListedModelRef(value: unknown): ModelRef | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const protocol = value.protocol;
  if (
    protocol !== 'openai-compatible' &&
    protocol !== 'anthropic-compatible' &&
    protocol !== 'google-gemini'
  ) {
    return undefined;
  }
  if (typeof value.providerId !== 'string' || value.providerId.length === 0) {
    return undefined;
  }
  if (typeof value.modelId !== 'string' || value.modelId.length === 0) {
    return undefined;
  }
  return {
    protocol,
    providerId: value.providerId,
    modelId: value.modelId,
  };
}

function isUsableListedProjectId(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed !== '[host-path]' && !trimmed.includes('[host-path]');
}

function mapListedSessionScope(value: Record<string, unknown>): SessionScope | undefined {
  const scope = value.scope;
  if (isRecord(scope) && scope.kind === 'general') {
    return { kind: 'general' };
  }
  if (isRecord(scope) && scope.kind === 'project' && typeof scope.projectPath === 'string') {
    if (!isUsableListedProjectId(scope.projectPath)) {
      const projectId = typeof value.projectId === 'string' ? value.projectId.trim() : '';
      if (isUsableListedProjectId(projectId)) {
        return { kind: 'project', projectPath: projectId };
      }
      return undefined;
    }
    return { kind: 'project', projectPath: scope.projectPath };
  }
  if (scope === 'general') {
    return { kind: 'general' };
  }
  if (scope === 'project') {
    const projectId = typeof value.projectId === 'string' ? value.projectId.trim() : '';
    if (projectId.length > 0 && isUsableListedProjectId(projectId)) {
      return { kind: 'project', projectPath: projectId };
    }
  }
  return undefined;
}

function mapListedProject(value: unknown): ProjectRecord | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const gitFields = readListedGitWorkspaceFields(value);
  const projectId = typeof value.projectId === 'string' ? value.projectId.trim() : '';
  const listedPath = typeof value.path === 'string' ? value.path.trim() : '';
  // Remote list identity stays on opaque projectId (Host command key). The
  // filesystem root is remembered separately for absolute path joins.
  if (projectId.length > 0) {
    if (looksLikeHostFilesystemPath(listedPath)) {
      rememberRemoteProjectRoot(projectId, listedPath);
    }
    const displayName =
      typeof value.displayName === 'string' && value.displayName.trim().length > 0
        ? value.displayName
        : projectId;
    return {
      path: projectId,
      displayName,
      trust: value.trust === 'trusted' ? 'trusted' : 'untrusted',
      lastOpenedAt: typeof value.lastOpenedAt === 'string' ? value.lastOpenedAt : '',
      createdAt: typeof value.createdAt === 'string' ? value.createdAt : '',
      ...gitFields,
    };
  }
  if (listedPath.length > 0) {
    const trust = value.trust === 'trusted' ? 'trusted' : 'untrusted';
    return {
      path: listedPath,
      trust,
      lastOpenedAt: typeof value.lastOpenedAt === 'string' ? value.lastOpenedAt : '',
      createdAt: typeof value.createdAt === 'string' ? value.createdAt : '',
      ...(typeof value.displayName === 'string' ? { displayName: value.displayName } : {}),
      ...gitFields,
    };
  }
  return undefined;
}

function readListedGitWorkspaceFields(value: Record<string, unknown>): Pick<
  ProjectRecord,
  'gitRepositoryId' | 'isPrimaryWorktree' | 'currentBranch' | 'gitRootPath'
> {
  const fields: Pick<
    ProjectRecord,
    'gitRepositoryId' | 'isPrimaryWorktree' | 'currentBranch' | 'gitRootPath'
  > = {};
  if (typeof value.gitRepositoryId === 'string' && value.gitRepositoryId.trim().length > 0) {
    fields.gitRepositoryId = value.gitRepositoryId.trim();
  }
  if (value.isPrimaryWorktree === true || value.isPrimaryWorktree === false) {
    fields.isPrimaryWorktree = value.isPrimaryWorktree;
  }
  if (typeof value.currentBranch === 'string' && value.currentBranch.trim().length > 0) {
    fields.currentBranch = value.currentBranch.trim();
  }
  if (typeof value.gitRootPath === 'string' && value.gitRootPath.trim().length > 0) {
    fields.gitRootPath = value.gitRootPath.trim();
  }
  return fields;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
