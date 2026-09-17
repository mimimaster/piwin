/**
 * project/open + remove + trust + permissions + list-dir + read-file.
 */
import { open, readFile, readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {
  HostCommand,
  HostResponse,
  ProjectListData,
  ProjectReadFileData,
  ProjectRecord,
} from '@piwin/contracts';
import {
  formatError,
  inferAttachmentMimeType,
  PROJECT_PREVIEW_CHUNK_BYTES,
  PROJECT_PREVIEW_INLINE_WIRE_BYTES,
  PROJECT_PREVIEW_THUMB_EDGE_PX,
} from '@piwin/contracts';
import { renderImagePreviewWebp } from '@piwin/media';
import {
  listProjects,
  listRememberedPermissions,
  loadProjectStore,
  openOrCreateProject,
  removeProject,
  isRegisteredProjectRoot,
  normalizeProjectRootPath,
  resolveInsideRootWithRealpath,
  resolveProjectPathById,
  revokeRememberedPermission,
  setProjectTrust,
} from '@piwin/project';
import {
  findTrustedSameRepositoryRoot,
  readGitWorkspaceListing,
  resolveOpenGitWorkspacePath,
  type GitWorkspaceListing,
} from '@piwin/git';
import { fail, ok } from '../response-helpers.js';
import { getPiwinGeneralWorkspacePath, getPiwinProjectsPath, getPiwinRoot } from '../paths.js';
import { ensureGeneralWorkspace } from '../general-workspace.js';
import { bindProjectLocator } from '../project-locator.js';
import { createRemoteProjectId, isRemoteProjectId } from '../remote-project-id.js';

const PROJECT_TYPES = new Set<HostCommand['type']>([
  'project/list',
  'project/open',
  'project/remove',
  'project/trust',
  'project/authorize-terminal',
  'project/permissions-list',
  'project/permissions-revoke',
  'project/list-dir',
  'project/read-file',
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
      const listed = await enrichProjectsWithGitWorkspace(projects);
      return ok(requestId, 'project/list', listed);
    }
    case 'project/open': {
      const openPath = await resolveOpenProjectPath(projectsPath, command.path, requestId);
      if (!openPath.ok) {
        return openPath.response;
      }
      const document = await loadProjectStore(projectsPath);
      const registeredPaths = document.projects.map((item) => item.path);
      const targetPath = await resolveOpenGitWorkspacePath(openPath.path, registeredPaths);
      const existing = document.projects.find((item) => item.path === path.resolve(targetPath));
      let project: ProjectRecord;
      if (existing) {
        project = await openOrCreateProject(projectsPath, targetPath);
      } else {
        const trustedPaths = document.projects
          .filter((item) => item.trust === 'trusted')
          .map((item) => item.path);
        const inheritedFrom = await findTrustedSameRepositoryRoot(targetPath, trustedPaths);
        project = inheritedFrom
          ? await openOrCreateProject(projectsPath, targetPath, { trust: 'trusted' })
          : await openOrCreateProject(projectsPath, targetPath);
      }
      return ok(requestId, 'project/open', {
        path: project.path,
        projectId: createRemoteProjectId(project.path),
        trusted: project.trust === 'trusted',
        trust: project.trust,
        project,
      });
    }
    case 'project/remove': {
      const bound = bindProjectLocator(command.path, (await loadProjectStore(projectsPath)).projects);
      if (!bound.ok) {
        return fail(requestId, 'project/remove', bound.error);
      }
      const project = await removeProject(projectsPath, bound.path);
      if (!project) {
        return fail(requestId, 'project/remove', `Project not found: ${command.path}`);
      }
      return ok(requestId, 'project/remove', {
        path: project.path,
        removed: true,
      });
    }
    case 'project/trust': {
      const bound = bindProjectLocator(command.path, (await loadProjectStore(projectsPath)).projects);
      if (!bound.ok) {
        return fail(requestId, 'project/trust', bound.error);
      }
      const project = await setProjectTrust(projectsPath, bound.path, 'trusted');
      return ok(requestId, 'project/trust', {
        path: project.path,
        projectId: createRemoteProjectId(project.path),
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
      return listProjectDirectory(
        projectsPath,
        command.projectPath,
        command.relativePath,
        requestId,
        rootDir,
      );
    }
    case 'project/read-file': {
      return readProjectFile(
        projectsPath,
        command.projectPath,
        command.relativePath,
        command.maxBytes,
        requestId,
        rootDir,
        command.previewRange,
      );
    }
    default:
      return null;
  }
}

/**
 * Git identity is a sidebar nicety, never a gate on the list itself. A `git`
 * child can block indefinitely — e.g. macOS parks it behind a Desktop /
 * removable-volume TCC prompt when a new app signature first touches the
 * path — so a project that misses the budget is listed without enrichment
 * and the response says so, letting the client re-list once git settles.
 */
export const PROJECT_LIST_GIT_BUDGET_MS = 2_500;

export async function enrichProjectsWithGitWorkspace(
  projects: readonly ProjectRecord[],
  options: {
    budgetMs?: number;
    readListing?: typeof readGitWorkspaceListing;
  } = {},
): Promise<ProjectListData> {
  const budgetMs = options.budgetMs ?? PROJECT_LIST_GIT_BUDGET_MS;
  const readListing = options.readListing ?? readGitWorkspaceListing;
  const timedOut = Symbol('git-budget');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<typeof timedOut>((resolve) => {
    timer = setTimeout(() => resolve(timedOut), budgetMs);
  });
  let pending = false;
  try {
    const enriched = await Promise.all(
      projects.map(async (project) => {
        const listing = await Promise.race([
          readListing(project.path).catch(() => null),
          budget,
        ]);
        if (listing === timedOut) {
          pending = true;
          return project;
        }
        return applyGitWorkspaceListing(project, listing);
      }),
    );
    return pending ? { projects: enriched, gitWorkspacePending: true } : { projects: enriched };
  } finally {
    clearTimeout(timer);
  }
}

function applyGitWorkspaceListing(
  project: ProjectRecord,
  listing: GitWorkspaceListing | null,
): ProjectRecord {
  if (!listing) {
    return project;
  }
  const enriched: ProjectRecord = {
    ...project,
    gitRepositoryId: listing.gitRepositoryId,
    isPrimaryWorktree: listing.isPrimaryWorktree,
    gitRootPath: listing.gitRootPath,
  };
  if (listing.currentBranch) {
    enriched.currentBranch = listing.currentBranch;
  }
  return enriched;
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
  projectsPath: string,
  projectPath: string,
  relativePath: string | undefined,
  requestId: string | undefined,
  piwinRoot: string,
): Promise<HostResponse> {
  const rootCheck = await requireBrowseRoot(
    projectsPath,
    projectPath,
    requestId,
    'project/list-dir',
    piwinRoot,
  );
  if (!rootCheck.ok) {
    return rootCheck.response;
  }
  const rootAbsolute = rootCheck.rootAbsolute;
  const relativeNormalized = (relativePath ?? '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
  const resolved = await resolveInsideRootWithRealpath(rootAbsolute, relativePath ?? '');
  if (!resolved.ok) {
    return fail(requestId, 'project/list-dir', resolved.reason);
  }
  const targetAbsolute = resolved.realAbsolute ?? resolved.absolute;

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
    projectPath,
    relativePath: relativeNormalized,
    entries,
  });
}

const DEFAULT_MAX_READ_BYTES = 256 * 1024;
const HARD_MAX_READ_BYTES = 512 * 1024;
/** Image previews may be larger than text; still capped to bound IPC payload. */
const IMAGE_PREVIEW_MAX_BYTES = 8 * 1024 * 1024;
/** Raw WebP cap for the ranged-image placeholder (~800 KB once base64'd). */
const PROJECT_PREVIEW_THUMB_MAX_BYTES = 600 * 1024;

function isInlineImagePreviewMime(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

/**
 * Read a file under a browse root for File tree / Doc Preview.
 * Accepts a remembered project or the product General workspace; rejects path
 * traversal and out-of-root symlinks; flags binary / oversized content honestly.
 * Image bytes under {@link IMAGE_PREVIEW_MAX_BYTES} also get a `previewDataUrl`
 * so Desktop can render them (Tauri asset scope only covers `~/.piwin/media/**`).
 */
async function readProjectFile(
  projectsPath: string,
  projectPath: string,
  relativePath: string,
  maxBytesInput: number | undefined,
  requestId: string | undefined,
  piwinRoot: string,
  previewRange?: { offset: number; length: number },
): Promise<HostResponse> {
  const rootCheck = await requireBrowseRoot(
    projectsPath,
    projectPath,
    requestId,
    'project/read-file',
    piwinRoot,
  );
  if (!rootCheck.ok) {
    return rootCheck.response;
  }
  const rootAbsolute = rootCheck.rootAbsolute;
  const relativeNormalized = (relativePath ?? '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
  if (!relativeNormalized) {
    return fail(requestId, 'project/read-file', 'relativePath is required');
  }
  const resolved = await resolveInsideRootWithRealpath(rootAbsolute, relativePath);
  if (!resolved.ok) {
    return fail(requestId, 'project/read-file', resolved.reason);
  }
  const targetAbsolute = resolved.realAbsolute ?? resolved.absolute;

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

  if (previewRange !== undefined) {
    return readProjectPreviewSlice({
      requestId,
      projectPath: resolved.rootReal,
      relativePath: relativeNormalized,
      absolutePath: targetAbsolute,
      byteSize: fileStats.size,
      range: previewRange,
    });
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
  const inferredMime =
    inferAttachmentMimeType(relativeNormalized, undefined, sample) ??
    (isBinary ? 'application/octet-stream' : 'text/plain');

  if (isInlineImagePreviewMime(inferredMime) && byteSize <= IMAGE_PREVIEW_MAX_BYTES) {
    const base = {
      projectPath: resolved.rootReal,
      relativePath: relativeNormalized,
      absolutePath: targetAbsolute,
      byteSize,
      isBinary,
      mimeHint: inferredMime,
    };
    // A whole data URL beyond one Host wire frame fails the send (remote hosts
    // surfaced it as "file not found"); announce ranged slices instead.
    const inlineCost = Math.ceil(byteSize / 3) * 4 + (isBinary ? 0 : byteSize);
    if (inlineCost > PROJECT_PREVIEW_INLINE_WIRE_BYTES) {
      const thumb = isBinary
        ? await renderImagePreviewWebp(targetAbsolute, {
            edge: PROJECT_PREVIEW_THUMB_EDGE_PX,
            quality: 80,
          })
        : null;
      const data: ProjectReadFileData = {
        ...base,
        content: '',
        truncated: !isBinary,
        previewChunkBytes: PROJECT_PREVIEW_CHUNK_BYTES,
        // Only when it saves a real trip and still fits the frame.
        ...(thumb && thumb.byteLength <= PROJECT_PREVIEW_THUMB_MAX_BYTES
          ? { previewThumbDataUrl: `data:image/webp;base64,${thumb.toString('base64')}` }
          : {}),
      };
      return ok(requestId, 'project/read-file', data);
    }
    const data: ProjectReadFileData = {
      ...base,
      content: isBinary ? '' : buffer.toString('utf8'),
      truncated: false,
      previewDataUrl: `data:${inferredMime};base64,${buffer.toString('base64')}`,
    };
    return ok(requestId, 'project/read-file', data);
  }

  if (isBinary) {
    return ok(requestId, 'project/read-file', {
      projectPath: resolved.rootReal,
      relativePath: relativeNormalized,
      absolutePath: targetAbsolute,
      content: '',
      byteSize,
      truncated: false,
      isBinary: true,
      mimeHint: inferredMime,
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
    projectPath: resolved.rootReal,
    relativePath: relativeNormalized,
    absolutePath: targetAbsolute,
    content,
    byteSize,
    truncated,
    isBinary: false,
    mimeHint: inferredMime,
  });
}

/** One raw slice of an image preview that was too large to inline. */
async function readProjectPreviewSlice(input: {
  requestId: string | undefined;
  projectPath: string;
  relativePath: string;
  absolutePath: string;
  byteSize: number;
  range: { offset: number; length: number };
}): Promise<HostResponse> {
  const { offset, length } = input.range;
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length <= 0 ||
    length > PROJECT_PREVIEW_CHUNK_BYTES ||
    offset >= input.byteSize
  ) {
    return fail(input.requestId, 'project/read-file', 'invalid preview range');
  }
  if (input.byteSize > IMAGE_PREVIEW_MAX_BYTES) {
    return fail(input.requestId, 'project/read-file', 'file exceeds image preview limit');
  }
  let handle;
  try {
    handle = await open(input.absolutePath, 'r');
    const sample = Buffer.alloc(Math.min(input.byteSize, 8000));
    await handle.read(sample, 0, sample.length, 0);
    const mimeType = inferAttachmentMimeType(input.relativePath, undefined, sample);
    if (!mimeType || !isInlineImagePreviewMime(mimeType)) {
      return fail(input.requestId, 'project/read-file', 'preview ranges are limited to images');
    }
    const slice = Buffer.alloc(Math.min(length, input.byteSize - offset));
    const { bytesRead } = await handle.read(slice, 0, slice.length, offset);
    const data: ProjectReadFileData = {
      projectPath: input.projectPath,
      relativePath: input.relativePath,
      absolutePath: input.absolutePath,
      content: '',
      byteSize: input.byteSize,
      truncated: false,
      isBinary: true,
      mimeHint: mimeType,
      previewChunk: { offset, base64Data: slice.subarray(0, bytesRead).toString('base64') },
    };
    return ok(input.requestId, 'project/read-file', data);
  } catch (error) {
    return fail(input.requestId, 'project/read-file', `cannot read file: ${formatError(error)}`);
  } finally {
    await handle?.close();
  }
}

/**
 * Browse root for list-dir / read-file.
 *
 * Remembered user projects stay registered. The product General workspace
 * (`~/.piwin/workspace`) is also allowed so Chat can preview generated files
 * without pretending that directory is a user project. Callers still cannot
 * invent arbitrary roots (e.g. dirname of a skill path, `/etc`).
 */
async function requireBrowseRoot(
  projectsPath: string,
  projectPath: string,
  requestId: string | undefined,
  commandType: 'project/read-file' | 'project/list-dir',
  piwinRoot: string,
): Promise<
  | { ok: true; rootAbsolute: string }
  | { ok: false; response: HostResponse }
> {
  const trimmed = (projectPath ?? '').trim();
  if (!trimmed) {
    return {
      ok: false,
      response: fail(requestId, commandType, 'project-root-required'),
    };
  }
  const document = await loadProjectStore(projectsPath);
  const bound = bindProjectLocator(trimmed, document.projects);
  if (!bound.ok) {
    return {
      ok: false,
      response: fail(requestId, commandType, bound.error),
    };
  }
  const generalWorkspace = normalizeProjectRootPath(getPiwinGeneralWorkspacePath(piwinRoot));
  if (normalizeProjectRootPath(bound.path) === generalWorkspace) {
    await ensureGeneralWorkspace(piwinRoot);
    return { ok: true, rootAbsolute: generalWorkspace };
  }
  const registeredRoots = document.projects.map((project) => project.path);
  if (!isRegisteredProjectRoot(registeredRoots, bound.path)) {
    return {
      ok: false,
      response: fail(requestId, commandType, 'project-root-not-registered'),
    };
  }
  return { ok: true, rootAbsolute: normalizeProjectRootPath(bound.path) };
}

async function resolveOpenProjectPath(
  projectsPath: string,
  locator: string,
  requestId: string | undefined,
): Promise<{ ok: true; path: string } | { ok: false; response: HostResponse }> {
  const trimmed = typeof locator === 'string' ? locator.trim() : '';
  if (!trimmed) {
    return { ok: false, response: fail(requestId, 'project/open', 'project-root-required') };
  }
  if (!isRemoteProjectId(trimmed)) {
    return { ok: true, path: trimmed };
  }
  const document = await loadProjectStore(projectsPath);
  const path = resolveProjectPathById(document.projects, trimmed);
  if (path === undefined) {
    return { ok: false, response: fail(requestId, 'project/open', 'unknown-project') };
  }
  return { ok: true, path };
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

  const document = await loadProjectStore(projectsPath);
  const bound = bindProjectLocator(trimmedProject, document.projects);
  if (!bound.ok) {
    return fail(requestId, 'project/authorize-terminal', bound.error);
  }
  const absoluteProject = path.resolve(bound.path);
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
