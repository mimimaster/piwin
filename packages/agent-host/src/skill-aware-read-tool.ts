/**
 * Override Pi's builtin `read` so a guessed bundled-assets SKILL.md path
 * still opens the catalog skill (project `.agents/skills`, `.pi/skills`, …).
 *
 * Custom tools overwrite builtins by name in Pi's registry. This keeps Pi's
 * image/offset/limit behavior and only remaps the filesystem path.
 */
import { access, readFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { resolve } from 'node:path';
import { catalogSkillMarkdownPathForRead } from '@piwin/contracts';

export type SkillAwareReadCatalogEntry = {
  resourceId: string;
  path: string;
};

export async function remapSkillAwareReadPath(
  requestedPath: string,
  skills: readonly SkillAwareReadCatalogEntry[],
): Promise<string> {
  const requested = resolve(requestedPath);
  if (await isReadableFile(requested)) {
    return requested;
  }
  const catalogPath = catalogSkillMarkdownPathForRead({
    requestedPath: requested,
    skills,
  });
  if (!catalogPath) {
    return requested;
  }
  const resolvedCatalog = resolve(catalogPath);
  if (await isReadableFile(resolvedCatalog)) {
    return resolvedCatalog;
  }
  return requested;
}

export async function createSkillAwarePiReadToolDefinition(input: {
  cwd: string;
  skills: readonly SkillAwareReadCatalogEntry[];
  piModule: Record<string, unknown>;
}): Promise<unknown | null> {
  const createReadToolDefinition = input.piModule.createReadToolDefinition;
  if (typeof createReadToolDefinition !== 'function') {
    return null;
  }
  const skills = input.skills;
  const createRead = createReadToolDefinition as (
    workingDirectory: string,
    options: {
      operations: {
        readFile: (absolutePath: string) => Promise<Buffer>;
        access: (absolutePath: string) => Promise<void>;
        detectImageMimeType?: (absolutePath: string) => Promise<string | undefined>;
      };
    },
  ) => unknown;
  return createRead(input.cwd, {
    operations: {
      readFile: async (absolutePath) => readFile(await remapSkillAwareReadPath(absolutePath, skills)),
      access: async (absolutePath) =>
        access(await remapSkillAwareReadPath(absolutePath, skills), fsConstants.R_OK),
      detectImageMimeType: async (absolutePath) =>
        imageMimeFromPath(await remapSkillAwareReadPath(absolutePath, skills)),
    },
  });
}

export async function mergeSkillAwareReadTool(
  customTools: unknown[] | undefined,
  input: {
    cwd: string;
    skills: readonly SkillAwareReadCatalogEntry[];
    piModule: Record<string, unknown>;
  },
): Promise<unknown[] | undefined> {
  const skillAwareRead = await createSkillAwarePiReadToolDefinition(input);
  if (!skillAwareRead) {
    return customTools;
  }
  return [...(customTools ?? []), skillAwareRead];
}

async function isReadableFile(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function imageMimeFromPath(filePath: string): string | undefined {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.bmp')) return 'image/bmp';
  return undefined;
}
