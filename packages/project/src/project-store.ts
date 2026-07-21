import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type {
  ProjectNetworkPolicy,
  ProjectMcpPolicy,
  ProjectRecord,
  ProjectStoreDocument,
  ProjectTrustLevel,
} from '@piwin/contracts';
import { createEmptyMcpPolicy, createEmptyNetworkPolicy } from '@piwin/contracts';


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

export async function getProjectMcpPolicy(
  filePath: string,
  projectPath: string,
): Promise<ProjectMcpPolicy> {
  const absolutePath = resolve(projectPath);
  const document = await loadProjectStore(filePath);
  const existing = document.projects.find((item) => item.path === absolutePath);
  return existing?.mcpPolicy
    ? {
        allowedServerIds: [...existing.mcpPolicy.allowedServerIds],
      }
    : createEmptyMcpPolicy();
}

export async function allowMcpServer(
  filePath: string,
  projectPath: string,
  serverId: string,
): Promise<ProjectMcpPolicy> {
  const normalizedId = serverId.trim();
  if (!normalizedId) {
    return getProjectMcpPolicy(filePath, projectPath);
  }
  const absolutePath = resolve(projectPath);
  await openOrCreateProject(filePath, absolutePath);
  const document = await loadProjectStore(filePath);
  const existing = document.projects.find((item) => item.path === absolutePath);
  if (!existing) {
    return createEmptyMcpPolicy();
  }
  const policy = existing.mcpPolicy
    ? {
        allowedServerIds: [...existing.mcpPolicy.allowedServerIds],
      }
    : createEmptyMcpPolicy();
  if (!policy.allowedServerIds.includes(normalizedId)) {
    policy.allowedServerIds.push(normalizedId);
    policy.allowedServerIds.sort();
  }
  existing.mcpPolicy = policy;
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
