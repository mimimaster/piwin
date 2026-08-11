/** Scan local pet packages before the user chooses one or more to import. */
import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import type { PetLocalImportCandidate, PetLocalImportPreview } from '@piwin/contracts';
import { validatePetManifest } from './validate-manifest.js';

type LocalPackageInspection = {
  hasManifest: boolean;
  candidate: PetLocalImportCandidate | null;
};

function hasErrorCode(error: unknown, code: string): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  return (error as { code?: unknown }).code === code;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Resolve an input path while accepting the common `~/...` form. */
export function normalizeLocalPetPath(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  if (trimmed === '~') return homedir();
  if (trimmed.startsWith(`~${sep}`) || trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return resolve(join(homedir(), trimmed.slice(2)));
  }
  return resolve(trimmed);
}

async function inspectLocalPetPackage(packagePath: string): Promise<LocalPackageInspection> {
  const absolute = normalizeLocalPetPath(packagePath);
  const fallbackName = basename(absolute) || absolute;
  let raw: string;
  try {
    raw = await readFile(join(absolute, 'pet.json'), 'utf8');
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      return { hasManifest: false, candidate: null };
    }
    return {
      hasManifest: true,
      candidate: {
        sourcePath: absolute,
        displayName: fallbackName,
        valid: false,
        issues: [`pet.json: ${formatError(error)}`],
      },
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    return {
      hasManifest: true,
      candidate: {
        sourcePath: absolute,
        displayName: fallbackName,
        valid: false,
        issues: [`pet.json: invalid JSON (${formatError(error)})`],
      },
    };
  }

  const validated = validatePetManifest(parsed);
  if (!validated.ok) {
    return {
      hasManifest: true,
      candidate: {
        sourcePath: absolute,
        displayName: fallbackName,
        valid: false,
        issues: validated.issues.map((issue) => `${issue.path}: ${issue.message}`),
      },
    };
  }

  const issues: string[] = [];
  try {
    const sheet = await stat(join(absolute, validated.manifest.spritesheetPath));
    if (!sheet.isFile()) {
      issues.push(`spritesheet is not a file: ${validated.manifest.spritesheetPath}`);
    }
  } catch {
    issues.push(`missing spritesheet: ${validated.manifest.spritesheetPath}`);
  }

  const candidate: PetLocalImportCandidate = {
    sourcePath: absolute,
    petId: validated.manifest.id,
    displayName: validated.manifest.displayName,
    valid: issues.length === 0,
    issues,
  };
  if (validated.manifest.description) candidate.description = validated.manifest.description;
  if (validated.manifest.version) candidate.version = validated.manifest.version;
  return { hasManifest: true, candidate };
}

/**
 * Scan either one package directory or a directory containing package
 * subdirectories. Directories without pet.json are ignored.
 */
export async function scanLocalPetPackages(sourcePath: string): Promise<PetLocalImportPreview> {
  const absolute = normalizeLocalPetPath(sourcePath);
  if (!absolute) throw new Error('sourcePath required');

  let sourceStat;
  try {
    sourceStat = await stat(absolute);
  } catch {
    throw new Error(`local import directory not found: ${absolute}`);
  }
  if (!sourceStat.isDirectory()) {
    throw new Error(`local import path is not a directory: ${absolute}`);
  }

  const rootInspection = await inspectLocalPetPackage(absolute);
  if (rootInspection.hasManifest && rootInspection.candidate) {
    return { sourcePath: absolute, candidates: [rootInspection.candidate] };
  }

  const candidates: PetLocalImportCandidate[] = [];
  const entries = await readdir(absolute);
  for (const entry of entries) {
    const childPath = join(absolute, entry);
    try {
      if (!(await stat(childPath)).isDirectory()) continue;
    } catch {
      continue;
    }
    const inspection = await inspectLocalPetPackage(childPath);
    if (inspection.candidate) candidates.push(inspection.candidate);
  }
  candidates.sort(
    (left, right) =>
      left.displayName.localeCompare(right.displayName) ||
      left.sourcePath.localeCompare(right.sourcePath),
  );
  return { sourcePath: absolute, candidates };
}
