/**
 * project/open + trust + permissions + list-dir + read-file.
 */
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { HostCommand, HostResponse } from '@piwin/contracts'
import { formatError } from '@piwin/contracts';;
import {
  listProjects,
  listRememberedPermissions,
  loadProjectStore,
  openOrCreateProject,
  resolveInsideRoot,
  revokeRememberedPermission,
  setProjectTrust,
} from '@piwin/project';
import { fail, ok } from '../response-helpers.js';
import { getPiwinProjectsPath, getPiwinRoot } from '../paths.js';

const PROJECT_TYPES = new Set<HostCommand['type']>([
  'project/list',
  'project/open',
  'project/trust',
  'project/authorize-terminal',
  'project/permissions-list',
  'project/permissions-revoke',
  'project/list-dir',
  'project/read-file',
  'project/write-file',
]);

export function isProjectCommand(command: HostCommand): boolean {
  return PROJECT_TYPES.has(command.type);
}

export async function handleProjectCommand(
  command: HostCommand,
  requestId: string | undefined,
  piwinRoot: string | undefined,
): Promise<HostResponse | null> {
  if (!isProjectCommand(command)) {
    return null;
  }
  const rootDir = getPiwinRoot(piwinRoot);
  const projectsPath = getPiwinProjectsPath(rootDir);

  switch (command.type) {
    case 'project/list': {
      const projects = await listProjects(projectsPath);
      return ok(requestId, 'project/list', { projects });
    }
    case 'project/open': {
      const project = await openOrCreateProject(projectsPath, command.path);
      return ok(requestId, 'project/open', {
        path: project.path,
        trusted: project.trust === 'trusted',
        trust: project.trust,
        project,
      });
    }
    case 'project/trust': {
      const project = await setProjectTrust(projectsPath, command.path, 'trusted');
      return ok(requestId, 'project/trust', {
        path: project.path,
        trusted: true,
        trust: project.trust,
        project,
      });
    }
    case 'project/authorize-terminal': {
      return authorizeTerminalCwd(projectsPath, command.projectPath, command.cwd, requestId);
    }
    case 'project/permissions-list': {
      const permissions = await listRememberedPermissions(projectsPath, command.path);
      return ok(requestId, 'project/permissions-list', {
        projectPath: command.path,
        permissions,
      });
    }
    case 'project/permissions-revoke': {
      const key = command.key?.trim() ?? '';
      if (!key) {
        return fail(requestId, 'project/permissions-revoke', 'permission key required');
      }
      const permissions = await revokeRememberedPermission(projectsPath, command.path, key);
      return ok(requestId, 'project/permissions-revoke', {
        projectPath: command.path,
        key,
        ok: true as const,
        permissions,
      });
    }
    case 'project/list-dir': {
      return listProjectDirectory(command.projectPath, command.relativePath, requestId);
    }
    case 'project/read-file': {
      return readProjectFile(
        command.projectPath,
        command.relativePath,
        command.maxBytes,
        requestId,
      );
    }
    case 'project/write-file': {
      return writeProjectFile(
        command.projectPath,
        command.relativePath,
        command.content,
        command.overwrite,
        requestId,
      );
    }
    default:
      return null;
  }
}

const IGNORED_DIR_NAMES = new Set([
  '.git',
  'node_modules',
  '.pnpm-store',
  'dist',
  'target',
  '.next',
  'coverage',
]);

/**
 * List one directory under project root. Rejects path traversal outside root.
 */
async function listProjectDirectory(
  projectPath: string,
  relativePath: string | undefined,
  requestId: string | undefined,
): Promise<HostResponse> {
  const rootAbsolute = path.resolve(projectPath);
  const relativeNormalized = (relativePath ?? '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
  const resolved = resolveInsideRoot(rootAbsolute, relativePath ?? '');
  if (!resolved.ok) {
    return fail(requestId, 'project/list-dir', resolved.reason);
  }
  const targetAbsolute = resolved.absolute;

  let directoryEntries;
  try {
    directoryEntries = await readdir(targetAbsolute, { withFileTypes: true });
  } catch (error) {
    const message = formatError(error);
    return fail(requestId, 'project/list-dir', `cannot read directory: ${message}`);
  }

  const entries = [];
  for (const dirent of directoryEntries) {
    if (dirent.name.startsWith('.') && dirent.name !== '.env.example') {
      // Hide dotfiles by default except common docs; tree stays readable.
      if (dirent.name !== '.gitignore' && dirent.name !== '.env.example') {
        continue;
      }
    }
    if (dirent.isDirectory() && IGNORED_DIR_NAMES.has(dirent.name)) {
      continue;
    }
    const entryRelative = relativeNormalized ? `${relativeNormalized}/${dirent.name}` : dirent.name;
    const kind = dirent.isDirectory() ? ('directory' as const) : ('file' as const);
    const entry: {
      name: string;
      relativePath: string;
      kind: 'file' | 'directory';
      sizeBytes?: number;
    } = {
      name: dirent.name,
      relativePath: entryRelative.replace(/\\/g, '/'),
      kind,
    };
    if (kind === 'file') {
      try {
        const fileStats = await stat(path.join(targetAbsolute, dirent.name));
        entry.sizeBytes = fileStats.size;
      } catch {
        /* size optional */
      }
    }
    entries.push(entry);
  }

  entries.sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === 'directory' ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
  });

  return ok(requestId, 'project/list-dir', {
    projectPath: rootAbsolute,
    relativePath: relativeNormalized,
    entries,
  });
}

const DEFAULT_MAX_READ_BYTES = 256 * 1024;
const HARD_MAX_READ_BYTES = 512 * 1024;

/**
 * Read a text file under project root for File tree preview.
 * Rejects path traversal; flags binary / oversized content honestly.
 */
async function readProjectFile(
  projectPath: string,
  relativePath: string,
  maxBytesInput: number | undefined,
  requestId: string | undefined,
): Promise<HostResponse> {
  const rootAbsolute = path.resolve(projectPath);
  const relativeNormalized = (relativePath ?? '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
  if (!relativeNormalized) {
    return fail(requestId, 'project/read-file', 'relativePath is required');
  }
  const resolved = resolveInsideRoot(rootAbsolute, relativePath);
  if (!resolved.ok) {
    return fail(requestId, 'project/read-file', resolved.reason);
  }
  const targetAbsolute = resolved.absolute;

  const maxBytes = Math.min(
    HARD_MAX_READ_BYTES,
    Math.max(1024, maxBytesInput ?? DEFAULT_MAX_READ_BYTES),
  );

  let fileStats;
  try {
    fileStats = await stat(targetAbsolute);
  } catch (error) {
    const message = formatError(error);
    return fail(requestId, 'project/read-file', `cannot stat file: ${message}`);
  }
  if (!fileStats.isFile()) {
    return fail(requestId, 'project/read-file', 'path is not a file');
  }

  let buffer: Buffer;
  try {
    buffer = await readFile(targetAbsolute);
  } catch (error) {
    const message = formatError(error);
    return fail(requestId, 'project/read-file', `cannot read file: ${message}`);
  }

  const byteSize = buffer.byteLength;
  const sample = buffer.subarray(0, Math.min(buffer.length, 8000));
  const isBinary = sample.includes(0);
  if (isBinary) {
    return ok(requestId, 'project/read-file', {
      projectPath: rootAbsolute,
      relativePath: relativeNormalized,
      absolutePath: targetAbsolute,
      content: '',
      byteSize,
      truncated: false,
      isBinary: true,
      mimeHint: 'application/octet-stream',
    });
  }

  let truncated = false;
  let contentBuffer = buffer;
  if (contentBuffer.byteLength > maxBytes) {
    contentBuffer = contentBuffer.subarray(0, maxBytes);
    truncated = true;
  }
  const content = contentBuffer.toString('utf8');

  return ok(requestId, 'project/read-file', {
    projectPath: rootAbsolute,
    relativePath: relativeNormalized,
    absolutePath: targetAbsolute,
    content,
    byteSize,
    truncated,
    isBinary: false,
    mimeHint: 'text/plain',
  });
}

/**
 * Write a text file under project root (CM-14 apply).
 * Enforces the path jail; refuses overwrite unless `overwrite: true`
 * (Desktop gates the call behind an explicit confirm).
 */
async function writeProjectFile(
  projectPath: string,
  relativePath: string,
  content: string,
  overwrite: boolean,
  requestId: string | undefined,
): Promise<HostResponse> {
  const rootAbsolute = path.resolve(projectPath);
  const relativeNormalized = (relativePath ?? '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
  if (!relativeNormalized) {
    return fail(requestId, 'project/write-file', 'relativePath is required');
  }
  const resolved = resolveInsideRoot(rootAbsolute, relativePath);
  if (!resolved.ok) {
    return fail(requestId, 'project/write-file', resolved.reason);
  }
  const targetAbsolute = resolved.absolute;

  let existed = false;
  try {
    const fileStats = await stat(targetAbsolute);
    existed = fileStats.isFile();
  } catch {
    existed = false;
  }
  if (existed && !overwrite) {
    return fail(requestId, 'project/write-file', 'file exists; overwrite was not confirmed');
  }

  try {
    // Apply may target a nested/new path; create parent dirs (jail already
    // verified the target stays inside the project root).
    await mkdir(path.dirname(targetAbsolute), { recursive: true });
    await writeFile(targetAbsolute, content, 'utf8');
  } catch (error) {
    const message = formatError(error);
    return fail(requestId, 'project/write-file', `cannot write file: ${message}`);
  }

  const byteSize = Buffer.byteLength(content, 'utf8');
  return ok(requestId, 'project/write-file', {
    projectPath: rootAbsolute,
    relativePath: relativeNormalized,
    absolutePath: targetAbsolute,
    byteSize,
    existed,
  });
}

async function authorizeTerminalCwd(
  projectsPath: string,
  projectPath: string,
  cwd: string | undefined,
  requestId: string | undefined,
): Promise<HostResponse> {
  const requestedCwd = path.resolve(cwd?.trim() || os.homedir());
  const fs = await import('node:fs/promises');

  let canonicalCwd: string;
  try {
    canonicalCwd = await fs.realpath(requestedCwd);
  } catch {
    canonicalCwd = requestedCwd;
  }

  try {
    const info = await stat(canonicalCwd);
    if (!info.isDirectory()) {
      return fail(requestId, 'project/authorize-terminal', 'cwd is not a directory');
    }
  } catch {
    return fail(requestId, 'project/authorize-terminal', 'cwd does not exist');
  }

  const trimmedProject = projectPath.trim();
  if (!trimmedProject) {
    // General-scope terminal: no project record needed.
    return ok(requestId, 'project/authorize-terminal', {
      authorized: true as const,
      projectPath: '',
      cwd: canonicalCwd,
    });
  }

  const absoluteProject = path.resolve(trimmedProject);
  const document = await loadProjectStore(projectsPath);
  const record = document.projects.find((item) => item.path === absoluteProject);
  if (!record || record.trust !== 'trusted') {
    return fail(requestId, 'project/authorize-terminal', 'project is not opened and trusted');
  }

  let canonicalProject = absoluteProject;
  try {
    canonicalProject = await fs.realpath(absoluteProject);
  } catch {
    // fall back to resolve() when realpath fails (missing path)
  }

  const rootWithSep = canonicalProject.endsWith(path.sep)
    ? canonicalProject
    : `${canonicalProject}${path.sep}`;
  const inside = canonicalCwd === canonicalProject || canonicalCwd.startsWith(rootWithSep);
  if (!inside) {
    return fail(requestId, 'project/authorize-terminal', 'cwd is outside the trusted project root');
  }

  return ok(requestId, 'project/authorize-terminal', {
    authorized: true as const,
    projectPath: canonicalProject,
    cwd: canonicalCwd,
  });
}
