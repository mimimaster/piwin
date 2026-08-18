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
  ProjectRecord,
  SessionListOrder,
  SessionScope,
} from '@piwin/contracts';
import type { SessionListItemUi } from './chat-reducer';

export type DesktopHostTransport = 'mock' | 'live' | 'remote';

export function isRemoteDesktopTransport(
  transport: string,
): transport is 'remote' {
  return transport === 'remote';
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

function mapListedSessionItem(value: unknown): SessionListItemUi | undefined {
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
  return item;
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
  const projectId = typeof value.projectId === 'string' ? value.projectId.trim() : '';
  if (projectId.length === 0) {
    return undefined;
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
    createdAt: typeof value.lastOpenedAt === 'string' ? value.lastOpenedAt : '',
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
