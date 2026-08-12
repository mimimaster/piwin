/**
 * CLI `--ref` argument → PromptContextRef (CM-18 parity).
 *
 * `piwin chat ... --ref <path>` may repeat. Paths are project-relative
 * (e.g. `src/a.ts`) or absolute; directory paths become `folder` refs,
 * files become `file` refs. Host still re-bounds and reads content — CLI
 * only carries the pointer, mirroring Desktop's context-menu pipeline.
 */
import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { PromptContextRef } from '@piwin/contracts';

export function collectRefArgs(argv: string[]): string[] {
  const refs: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--ref') {
      const value = argv[index + 1]?.trim();
      if (value) {
        refs.push(value);
        index += 1;
      }
    }
  }
  return refs;
}

/**
 * Resolve a single `--ref` value against the project root.
 * - Paths inside the root → `file` / `folder` refs with relativePath.
 * - Absolute paths outside the root → rejected (path jail mirrors host).
 * - Empty project path → rejected (CLI refs need a project scope).
 */
export async function resolveCliRef(
  projectPath: string | null | undefined,
  refValue: string,
): Promise<
  | { ok: true; ref: PromptContextRef }
  | { ok: false; reason: string }
> {
  if (!projectPath) {
    return { ok: false, reason: '--ref requires --project <path>' };
  }
  const rootAbsolute = path.resolve(projectPath);
  const inputAbsolute = path.isAbsolute(refValue)
    ? path.normalize(refValue)
    : path.resolve(rootAbsolute, refValue);

  const rootWithSep = rootAbsolute.endsWith(path.sep)
    ? rootAbsolute
    : `${rootAbsolute}${path.sep}`;
  if (inputAbsolute !== rootAbsolute && !inputAbsolute.startsWith(rootWithSep)) {
    return { ok: false, reason: `ref outside project root: ${refValue}` };
  }
  const relative = path.relative(rootAbsolute, inputAbsolute).replace(/\\/g, '/');
  if (!relative || relative.startsWith('..')) {
    return { ok: false, reason: `ref outside project root: ${refValue}` };
  }

  let isDirectory: boolean;
  try {
    const info = await stat(inputAbsolute);
    isDirectory = info.isDirectory();
  } catch {
    return { ok: false, reason: `ref does not exist: ${refValue}` };
  }

  const base = {
    projectPath: rootAbsolute,
    relativePath: relative,
    label: relative,
  } as const;
  const ref: PromptContextRef = isDirectory
    ? { kind: 'folder', ...base }
    : { kind: 'file', ...base };
  return { ok: true, ref };
}

/** Build the contextRefs payload for a prompt; rejects on any bad ref. */
export async function buildCliContextRefs(
  projectPath: string | null | undefined,
  refArgs: string[],
): Promise<{ ok: true; refs: PromptContextRef[] } | { ok: false; reason: string }> {
  const refs: PromptContextRef[] = [];
  for (const value of refArgs) {
    const resolved = await resolveCliRef(projectPath, value);
    if (!resolved.ok) {
      return resolved;
    }
    refs.push(resolved.ref);
  }
  return { ok: true, refs };
}
