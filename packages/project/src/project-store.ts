import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type {
  ProjectNetworkPolicy,
  ProjectRecord,
  ProjectStoreDocument,
  ProjectTrustLevel,
  RememberedPermission,
} from '@piwin/contracts';
import { createEmptyNetworkPolicy } from '@piwin/contracts';

function nowIso(): string {
  return new Date().toISOString();
}

function emptyDoc(): ProjectStoreDocument {
  return { version: 1, projects: [] };
}

export async function loadProjectStore(filePath: string): Promise<ProjectStoreDocument> {
  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return emptyDoc();
    }
    const record = parsed as Record<string, unknown>;
    const projects = Array.isArray(record.projects) ? record.projects : [];
    return {
      version: 1,
      projects: projects.filter(
        (item): item is ProjectRecord =>
          Boolean(item) &&
          typeof item === 'object' &&
          typeof (item as ProjectRecord).path === 'string',
      ),
    };
  } catch (error) {
    if (isNotFound(error)) {
      return emptyDoc();
    }
    throw error;
  }
}

export async function saveProjectStore(
  filePath: string,
  document: ProjectStoreDocument,
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  // One-release migration: drop legacy project MCP allowlists on write.
  // MCP connection is no longer a project-scoped permission.
  for (const project of document.projects) {
    if ('mcpPolicy' in project) {
      delete (project as ProjectRecord & { mcpPolicy?: unknown }).mcpPolicy;
    }
  }
  await writeFile(filePath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
}

export async function openOrCreateProject(
  filePath: string,
  projectPath: string,
  options?: { trust?: ProjectTrustLevel; displayName?: string },
): Promise<ProjectRecord> {
  const absolutePath = resolve(projectPath);
  const document = await loadProjectStore(filePath);
  const existing = document.projects.find((item) => item.path === absolutePath);
  const timestamp = nowIso();
  if (existing) {
    existing.lastOpenedAt = timestamp;
    if (options?.trust) {
      existing.trust = options.trust;
    }
    if (options?.displayName) {
      existing.displayName = options.displayName;
    }
    await saveProjectStore(filePath, document);
    return existing;
  }

  const created: ProjectRecord = {
    path: absolutePath,
    trust: options?.trust ?? 'untrusted',
    lastOpenedAt: timestamp,
    createdAt: timestamp,
  };
  if (options?.displayName) {
    created.displayName = options.displayName;
  }
  document.projects.unshift(created);
  await saveProjectStore(filePath, document);
  return created;
}

export async function setProjectTrust(
  filePath: string,
  projectPath: string,
  trust: ProjectTrustLevel,
): Promise<ProjectRecord> {
  const absolutePath = resolve(projectPath);
  const document = await loadProjectStore(filePath);
  const existing = document.projects.find((item) => item.path === absolutePath);
  if (!existing) {
    return openOrCreateProject(filePath, absolutePath, { trust });
  }
  existing.trust = trust;
  existing.lastOpenedAt = nowIso();
  await saveProjectStore(filePath, document);
  return existing;
}

export async function listProjects(filePath: string): Promise<ProjectRecord[]> {
  const document = await loadProjectStore(filePath);
  return [...document.projects].sort((left, right) =>
    right.lastOpenedAt.localeCompare(left.lastOpenedAt),
  );
}

function isNotFound(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: string }).code === 'ENOENT',
  );
}

export async function getProjectNetworkPolicy(
  filePath: string,
  projectPath: string,
): Promise<ProjectNetworkPolicy> {
  const absolutePath = resolve(projectPath);
  const document = await loadProjectStore(filePath);
  const existing = document.projects.find((item) => item.path === absolutePath);
  return existing?.networkPolicy
    ? {
        allowedFetchHosts: [...existing.networkPolicy.allowedFetchHosts],
        allowWebSearch: existing.networkPolicy.allowWebSearch,
      }
    : createEmptyNetworkPolicy();
}

export async function allowNetworkFetchHost(
  filePath: string,
  projectPath: string,
  hostname: string,
): Promise<ProjectNetworkPolicy> {
  const host = hostname.trim().toLowerCase();
  if (!host) {
    return getProjectNetworkPolicy(filePath, projectPath);
  }
  const absolutePath = resolve(projectPath);
  await openOrCreateProject(filePath, absolutePath);
  const document = await loadProjectStore(filePath);
  const existing = document.projects.find((item) => item.path === absolutePath);
  if (!existing) {
    return createEmptyNetworkPolicy();
  }
  const policy = existing.networkPolicy
    ? {
        allowedFetchHosts: [...existing.networkPolicy.allowedFetchHosts],
        allowWebSearch: existing.networkPolicy.allowWebSearch,
      }
    : createEmptyNetworkPolicy();
  if (!policy.allowedFetchHosts.includes(host)) {
    policy.allowedFetchHosts.push(host);
    policy.allowedFetchHosts.sort();
  }
  existing.networkPolicy = policy;
  existing.lastOpenedAt = nowIso();
  await saveProjectStore(filePath, document);
  return policy;
}

export async function allowNetworkWebSearch(
  filePath: string,
  projectPath: string,
): Promise<ProjectNetworkPolicy> {
  const absolutePath = resolve(projectPath);
  await openOrCreateProject(filePath, absolutePath);
  const document = await loadProjectStore(filePath);
  const existing = document.projects.find((item) => item.path === absolutePath);
  if (!existing) {
    return createEmptyNetworkPolicy();
  }
  const policy = existing.networkPolicy
    ? {
        allowedFetchHosts: [...existing.networkPolicy.allowedFetchHosts],
        allowWebSearch: true,
      }
    : { ...createEmptyNetworkPolicy(), allowWebSearch: true };
  existing.networkPolicy = policy;
  existing.lastOpenedAt = nowIso();
  await saveProjectStore(filePath, document);
  return policy;
}

const NETWORK_WEB_SEARCH_KEY = 'network:web_search';
const BASH_KEY_PREFIX = 'bash:';
const FILE_WRITE_KEY_PREFIX = 'file-write:';

function networkFetchKey(hostname: string): string {
  return `network:fetch:${hostname}`;
}

function bashAllowKey(command: string): string {
  return `${BASH_KEY_PREFIX}${command}`;
}

function fileWriteAllowKey(absPath: string): string {
  return `${FILE_WRITE_KEY_PREFIX}${absPath}`;
}

/**
 * Remember an exact bash command for a project (ADR 0019 §6). Pushes the
 * trimmed command if not already present. Returns the updated allowlist.
 */
export async function addBashAllowRule(
  filePath: string,
  projectPath: string,
  command: string,
): Promise<string[]> {
  const normalizedCommand = command.trim();
  if (!normalizedCommand) {
    return getBashAllowlist(filePath, projectPath);
  }
  const absolutePath = resolve(projectPath);
  await openOrCreateProject(filePath, absolutePath);
  const document = await loadProjectStore(filePath);
  const existing = document.projects.find((item) => item.path === absolutePath);
  if (!existing) {
    return [];
  }
  const allowlist = existing.bashAllowlist ? [...existing.bashAllowlist] : [];
  if (!allowlist.includes(normalizedCommand)) {
    allowlist.push(normalizedCommand);
  }
  existing.bashAllowlist = allowlist;
  existing.lastOpenedAt = nowIso();
  await saveProjectStore(filePath, document);
  return allowlist;
}

/**
 * Remember an absolute file-write path for a project (ADR 0019 §6). Pushes the
 * normalized absolute path if not already present. Returns the updated allowlist.
 */
export async function addFileWriteAllowRule(
  filePath: string,
  projectPath: string,
  absPath: string,
): Promise<string[]> {
  const normalizedPath = resolve(absPath.trim());
  if (!normalizedPath) {
    return getFileWriteAllowlist(filePath, projectPath);
  }
  const absolutePath = resolve(projectPath);
  await openOrCreateProject(filePath, absolutePath);
  const document = await loadProjectStore(filePath);
  const existing = document.projects.find((item) => item.path === absolutePath);
  if (!existing) {
    return [];
  }
  const allowlist = existing.fileWriteAllowlist ? [...existing.fileWriteAllowlist] : [];
  if (!allowlist.includes(normalizedPath)) {
    allowlist.push(normalizedPath);
  }
  existing.fileWriteAllowlist = allowlist;
  existing.lastOpenedAt = nowIso();
  await saveProjectStore(filePath, document);
  return allowlist;
}

/** Read a project's remembered bash allowlist (defensive copy). */
export async function getBashAllowlist(filePath: string, projectPath: string): Promise<string[]> {
  const absolutePath = resolve(projectPath);
  const document = await loadProjectStore(filePath);
  const existing = document.projects.find((item) => item.path === absolutePath);
  return existing?.bashAllowlist ? [...existing.bashAllowlist] : [];
}

/** Read a project's remembered file-write allowlist (defensive copy). */
export async function getFileWriteAllowlist(
  filePath: string,
  projectPath: string,
): Promise<string[]> {
  const absolutePath = resolve(projectPath);
  const document = await loadProjectStore(filePath);
  const existing = document.projects.find((item) => item.path === absolutePath);
  return existing?.fileWriteAllowlist ? [...existing.fileWriteAllowlist] : [];
}

/** Flatten network remembered allowlists into a Settings-friendly list. */
export async function listRememberedPermissions(
  filePath: string,
  projectPath: string,
): Promise<RememberedPermission[]> {
  const absolutePath = resolve(projectPath);
  const document = await loadProjectStore(filePath);
  const existing = document.projects.find((item) => item.path === absolutePath);
  if (!existing) {
    return [];
  }
  const permissions: RememberedPermission[] = [];
  const network = existing.networkPolicy;
  if (network?.allowWebSearch) {
    permissions.push({
      key: NETWORK_WEB_SEARCH_KEY,
      action: 'network:web_search',
      detail: 'Web search allowed for this project',
    });
  }
  for (const hostname of network?.allowedFetchHosts ?? []) {
    permissions.push({
      key: networkFetchKey(hostname),
      action: 'network:web_fetch',
      detail: `Fetch host allowed: ${hostname}`,
    });
  }
  for (const command of existing.bashAllowlist ?? []) {
    permissions.push({
      key: bashAllowKey(command),
      action: 'bash',
      detail: `Bash command allowed: ${command}`,
    });
  }
  for (const absPath of existing.fileWriteAllowlist ?? []) {
    permissions.push({
      key: fileWriteAllowKey(absPath),
      action: 'file-write',
      detail: `File write allowed: ${absPath}`,
    });
  }
  permissions.sort((left, right) => left.key.localeCompare(right.key));
  return permissions;
}

/**
 * Revoke one remembered permission by stable key.
 * Unknown keys are no-ops (returns current list semantics via ok).
 */
export async function revokeRememberedPermission(
  filePath: string,
  projectPath: string,
  key: string,
): Promise<RememberedPermission[]> {
  const absolutePath = resolve(projectPath);
  const normalizedKey = key.trim();
  if (!normalizedKey) {
    return listRememberedPermissions(filePath, absolutePath);
  }
  const document = await loadProjectStore(filePath);
  const existing = document.projects.find((item) => item.path === absolutePath);
  if (!existing) {
    return [];
  }

  if (normalizedKey === NETWORK_WEB_SEARCH_KEY) {
    if (existing.networkPolicy) {
      existing.networkPolicy = {
        allowedFetchHosts: [...existing.networkPolicy.allowedFetchHosts],
        allowWebSearch: false,
      };
    }
  } else if (normalizedKey.startsWith('network:fetch:')) {
    const hostname = normalizedKey.slice('network:fetch:'.length).toLowerCase();
    if (existing.networkPolicy) {
      existing.networkPolicy = {
        allowedFetchHosts: existing.networkPolicy.allowedFetchHosts.filter(
          (host) => host !== hostname,
        ),
        allowWebSearch: existing.networkPolicy.allowWebSearch,
      };
    }
  } else if (normalizedKey.startsWith(BASH_KEY_PREFIX)) {
    const command = normalizedKey.slice(BASH_KEY_PREFIX.length);
    if (existing.bashAllowlist) {
      existing.bashAllowlist = existing.bashAllowlist.filter((entry) => entry !== command);
    }
  } else if (normalizedKey.startsWith(FILE_WRITE_KEY_PREFIX)) {
    const absPath = normalizedKey.slice(FILE_WRITE_KEY_PREFIX.length);
    if (existing.fileWriteAllowlist) {
      existing.fileWriteAllowlist = existing.fileWriteAllowlist.filter(
        (entry) => entry !== absPath,
      );
    }
  }

  existing.lastOpenedAt = nowIso();
  await saveProjectStore(filePath, document);
  return listRememberedPermissions(filePath, absolutePath);
}
