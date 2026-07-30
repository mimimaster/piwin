/**
 * Replace Pi built-in `write`/`edit` tools with permission-gated versions.
 *
 * Wraps the injected `writeFile` / `mkdir` operations so every file mutation
 * flows through `evaluateFileWritePermission` (ADR 0019 §4). This closes the
 * largest security blind spot: Pi's native write/edit tools are otherwise not
 * gated by the host at all.
 *
 * Pattern mirrors `gated-bash-tool.ts`: dynamically import Pi, take the tool
 * definition factories, inject local operations that gate before delegating to
 * `fs/promises`, and return the modified definitions. Register them as
 * `customTools` named `write` / `edit` so they override Pi's built-ins by name.
 */
import {
  access as fsAccess,
  mkdir as fsMkdir,
  readFile as fsReadFile,
  realpath as fsRealpath,
  stat as fsStat,
  writeFile as fsWriteFile,
} from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import type { PermissionDecision, PermissionMode, PermissionRuleSet } from '@piwin/contracts';
import { getFileWriteAllowlist, pathInFileWriteAllowlist } from '@piwin/project';
import { evaluateFileWritePermission, resolveNonInteractiveDecision } from './permission-policy.js';
import type { ToolPermissionGate } from './session-tools.js';

export type BuildGatedFileToolsOptions = {
  /** Session working directory; passed to Pi as `cwd`. */
  cwd: string;
  /** Permission mode from `config.permissions?.mode` (default `'auto'`). */
  mode: PermissionMode;
  /** Merged rule set (bundled + user + project layers). */
  rules: PermissionRuleSet;
  /** Absolute project root used for in-project / escapes-root checks. */
  projectRoot: string;
  /** Path to `~/.piwin/projects.json`; read once for the remembered allowlist. */
  projectsFilePath: string;
  /** Project path key for the project-store lookup (defaults to `projectRoot`). */
  projectPath?: string;
  /** Interactive gate (Desktop via HostRuntime). When omitted, ask → deny. */
  requestPermission?: ToolPermissionGate;
};

type WriteOperations = {
  writeFile: (absolutePath: string, content: string) => Promise<void>;
  mkdir: (dir: string) => Promise<void>;
};

type EditOperations = {
  readFile: (absolutePath: string) => Promise<Buffer>;
  writeFile: (absolutePath: string, content: string) => Promise<void>;
  access: (absolutePath: string) => Promise<void>;
};

/** Default local write operations (mirrors Pi's `defaultWriteOperations`). */
const localWriteOperations: WriteOperations = {
  writeFile: (path, content) => fsWriteFile(path, content, 'utf-8'),
  mkdir: (dir) => fsMkdir(dir, { recursive: true }).then(() => undefined),
};

/** Default local edit operations (mirrors Pi's `defaultEditOperations`). */
const localEditOperations: EditOperations = {
  readFile: (path) => fsReadFile(path),
  writeFile: (path, content) => fsWriteFile(path, content, 'utf-8'),
  access: (path) => fsAccess(path, constants.R_OK | constants.W_OK),
};

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

/**
 * Build gated `write` + `edit` Pi ToolDefinitions. Register both as
 * `customTools` so they override Pi's built-in definitions by name.
 */
export async function buildGatedFileToolsDefinition(
  options: BuildGatedFileToolsOptions,
): Promise<unknown[]> {
  const piModule = await import('@earendil-works/pi-coding-agent');
  const createWriteToolDefinition = (
    piModule as {
      createWriteToolDefinition?: (
        cwd: string,
        writeOptions?: { operations?: WriteOperations },
      ) => unknown;
    }
  ).createWriteToolDefinition;
  const createEditToolDefinition = (
    piModule as {
      createEditToolDefinition?: (
        cwd: string,
        editOptions?: { operations?: EditOperations },
      ) => unknown;
    }
  ).createEditToolDefinition;

  if (typeof createWriteToolDefinition !== 'function') {
    throw new Error('createWriteToolDefinition missing from pi-coding-agent');
  }
  if (typeof createEditToolDefinition !== 'function') {
    throw new Error('createEditToolDefinition missing from pi-coding-agent');
  }

  // Load the remembered file-write allowlist once per session. Entries here are
  // absolute paths approved by the user (Settings → remembered permissions); a
  // path-safe prefix match auto-allows without prompting. Each entry is
  // realpath'd when it exists so it compares consistently against the
  // realpath'd target paths inside the gate (e.g. macOS `/var` → `/private/var`).
  let allowlist: string[] = [];
  try {
    const raw = await getFileWriteAllowlist(
      options.projectsFilePath,
      options.projectPath ?? options.projectRoot,
    );
    allowlist = await realpathAllowlistEntries(raw);
  } catch (error) {
    // Best-effort: a missing/unreadable store simply means no remembered allows.
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[piwin] file-write allowlist unavailable: ${message}`);
  }

  // Resolve the project root through realpath once so symlinked roots (e.g.
  // macOS `/var` → `/private/var`) compare consistently against realpath'd
  // target paths inside the gate. Falls back to the literal root on ENOENT.
  let resolvedProjectRoot = options.projectRoot;
  try {
    resolvedProjectRoot = await fsRealpath(options.projectRoot);
  } catch {
    resolvedProjectRoot = options.projectRoot;
  }

  const gate = createWriteGate(options, allowlist, resolvedProjectRoot);

  const writeTool = createWriteToolDefinition(options.cwd, {
    operations: {
      writeFile: gate.gatedWriteFile,
      mkdir: gate.gatedMkdir,
    },
  });
  const editTool = createEditToolDefinition(options.cwd, {
    operations: {
      readFile: localEditOperations.readFile,
      writeFile: gate.gatedWriteFile,
      access: localEditOperations.access,
    },
  });

  return [writeTool, editTool];
}

/**
 * Realpath each allowlist entry. For existing entries, use the realpath directly.
 * For non-existent entries (remembered future writes), realpath the parent and
 * rejoin the basename so the entry is symlink-consistent with the parent-realpath
 * logic used for target paths. This ensures allowlist entries match target paths
 * even when neither exists yet (e.g. macOS `/var` → `/private/var`).
 */
async function realpathAllowlistEntries(entries: readonly string[]): Promise<string[]> {
  const results: string[] = [];
  for (const entry of entries) {
    try {
      results.push(await fsRealpath(entry));
    } catch (error) {
      if (!isNotFound(error)) throw error;
      // Entry doesn't exist yet: realpath the parent and rejoin the basename.
      try {
        const parentReal = await fsRealpath(dirname(entry));
        results.push(join(parentReal, basename(entry)));
      } catch {
        results.push(entry);
      }
    }
  }
  return results;
}

/**
 * Create the gated write operations closure. `gatePath` resolves the target to
 * an absolute path, realpaths it when it exists (catching ENOENT for new files),
 * checks the remembered allowlist, then runs the pure evaluator and prompts on
 * `ask`. Non-interactive sessions deny on `ask`.
 */
function createWriteGate(
  options: BuildGatedFileToolsOptions,
  allowlist: readonly string[],
  projectRoot: string,
): {
  gatedWriteFile: (absolutePath: string, content: string) => Promise<void>;
  gatedMkdir: (dir: string) => Promise<void>;
} {
  const { mode, rules, requestPermission } = options;

  async function gatePath(targetPath: string): Promise<void> {
    const absPath = resolve(targetPath);

    // realpath for symlink-aware checks; new files/dirs (ENOENT) realpath the
    // existing parent and rejoin the basename so the resolved path stays
    // symlink-consistent with the realpath'd project root.
    let resolvedPath = absPath;
    try {
      resolvedPath = await fsRealpath(absPath);
    } catch (error) {
      if (!isNotFound(error)) throw error;
      // New file/dir (ENOENT): realpath the existing parent and rejoin the
      // basename so the resolved path is symlink-consistent with the
      // realpath'd project root (e.g. macOS `/var` → `/private/var`).
      try {
        const parentReal = await fsRealpath(dirname(absPath));
        resolvedPath = join(parentReal, basename(absPath));
      } catch {
        resolvedPath = absPath;
      }
    }

    // Remembered approvals short-circuit before the evaluator / prompt.
    if (allowlist.length > 0 && pathInFileWriteAllowlist(resolvedPath, allowlist)) {
      return;
    }

    const evaluation = evaluateFileWritePermission({
      absPath: resolvedPath,
      projectRoot,
      mode,
      rules,
    });

    let decision: PermissionDecision = evaluation.decision;
    if (decision === 'ask') {
      if (requestPermission) {
        decision = await requestPermission({
          action: 'file-write',
          detail: resolvedPath,
          defaultDecision: 'ask',
        });
      } else {
        decision = resolveNonInteractiveDecision(evaluation);
      }
    }

    if (decision !== 'allow') {
      throw new Error(`piwin blocked file-write (${evaluation.reason}): ${resolvedPath}`);
    }
  }

  return {
    async gatedWriteFile(absolutePath, content) {
      await gatePath(absolutePath);
      await localWriteOperations.writeFile(absolutePath, content);
    },
    async gatedMkdir(dir) {
      // `mkdir -p` on an existing directory is a no-op creation: there is nothing
      // to gate, so skip the permission check when the directory already exists.
      // This also avoids re-prompting for the parent of an allowlisted file.
      let exists = false;
      try {
        await fsStat(dir);
        exists = true;
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
      if (!exists) {
        await gatePath(dir);
      }
      await localWriteOperations.mkdir(dir);
    },
  };
}
