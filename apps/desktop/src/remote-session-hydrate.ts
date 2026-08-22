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
  HostResponse,
  ModelRef,
  ProjectRecord,
  SessionListOrder,
  SessionScope,
  ThinkingLevel,
} from '@piwin/contracts';
import { isThinkingLevel } from '@piwin/contracts';
import type { ChatUiAction, SessionListItemUi } from './chat-reducer';
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
    if (!isOpaqueRemoteProjectId(projectKey)) {
      return {
        ok: false,
        error:
          'Remote Host cannot open a folder from this computer. Pick a project already registered on the Host.',
      };
    }
    const listed = await request({ type: 'project/list' });
    if (!listed.success) {
      return { ok: false, error: listed.error };
    }
    const record = mapListedProjects(listed.data).find((project) => project.path === projectKey);
    const trusted = record?.trust === 'trusted';
    if (!trusted) {
      return {
        ok: false,
        error:
          options?.autoTrust === false
            ? 'This project is not trusted on the Host.'
            : 'This project is not trusted on the Host yet. Trust it in Settings on the machine running the Host.',
      };
    }
    return { ok: true, path: projectKey, trusted: true };
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
        project.displayName === previous[index]?.displayName,
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
  if (typeof value.pinnedAt === 'string') item.pinnedAt = value.pinnedAt;
  if (value.isArchived === true || value.archived === true) item.isArchived = true;
  if (typeof value.archivedAt === 'string') item.archivedAt = value.archivedAt;
  const scope = mapListedSessionScope(value);
  if (scope !== undefined) item.scope = scope;
  const model = readListedModelRef(value.model);
  if (model) item.model = model;
  if (isThinkingLevel(value.thinkingLevel)) item.thinkingLevel = value.thinkingLevel;
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

function mapListedSessionScope(value: Record<string, unknown>): SessionScope | undefined {
  const scope = value.scope;
  if (isRecord(scope) && scope.kind === 'general') {
    return { kind: 'general' };
  }
  if (isRecord(scope) && scope.kind === 'project' && typeof scope.projectPath === 'string') {
    return { kind: 'project', projectPath: scope.projectPath };
  }
  if (scope === 'general') {
    return { kind: 'general' };
  }
  if (scope === 'project') {
    const projectId = typeof value.projectId === 'string' ? value.projectId.trim() : '';
    if (projectId.length > 0) {
      return { kind: 'project', projectPath: projectId };
    }
  }
  return undefined;
}

function mapListedProject(value: unknown): ProjectRecord | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const projectId = typeof value.projectId === 'string' ? value.projectId.trim() : '';
  if (projectId.length > 0) {
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
    };
  }
  if (typeof value.path === 'string' && value.path.trim().length > 0) {
    const trust = value.trust === 'trusted' ? 'trusted' : 'untrusted';
    return {
      path: value.path,
      trust,
      lastOpenedAt: typeof value.lastOpenedAt === 'string' ? value.lastOpenedAt : '',
      createdAt: typeof value.createdAt === 'string' ? value.createdAt : '',
      ...(typeof value.displayName === 'string' ? { displayName: value.displayName } : {}),
    };
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
