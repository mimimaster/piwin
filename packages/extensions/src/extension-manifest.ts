/**
 * Read an extension's `piwin.json` manifest from a staged revision.
 *
 * `@piwin/extensions` owns manifest normalization (ADR 0047), so the reader
 * lives here and the Host consumes it. Reading is pure data access: it never
 * imports, evaluates or spawns the declared artifact.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  ExtensionSessionBackendDeclaration,
  ExtensionSessionBackendFailureCode,
} from '@piwin/contracts';
import { parseExtensionSessionBackend } from '@piwin/contracts';

export const PIWIN_MANIFEST_FILENAME = 'piwin.json';

export type ExtensionBackendRead =
  /** Normal case: a tool, hook or OAuth-provider extension. */
  | { kind: 'not-a-backend' }
  | { kind: 'backend'; declaration: ExtensionSessionBackendDeclaration }
  /** A `sessionBackend` key exists but is malformed; surfaced, never ignored. */
  | { kind: 'invalid-backend'; code: ExtensionSessionBackendFailureCode; detail: string };

/**
 * A `piwin.json` that is absent or not valid JSON declares no backend.
 *
 * That matches the tolerant auth-provider reader: most extensions have no
 * manifest at all, and a broken manifest must not turn discovery into a throw.
 * An author who *intended* a backend still fails loudly at staging, because the
 * directory then has no `index.ts` either.
 */
export async function readExtensionBackend(packageRoot: string): Promise<ExtensionBackendRead> {
  let raw: string;
  try {
    raw = await readFile(join(packageRoot, PIWIN_MANIFEST_FILENAME), 'utf8');
  } catch {
    return { kind: 'not-a-backend' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return { kind: 'not-a-backend' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { kind: 'not-a-backend' };
  }
  const result = parseExtensionSessionBackend((parsed as Record<string, unknown>)['sessionBackend']);
  if (result === undefined) return { kind: 'not-a-backend' };
  if (!result.ok) return { kind: 'invalid-backend', code: result.code, detail: result.detail };
  return { kind: 'backend', declaration: result.declaration };
}

/**
 * Absolute path of the declared artifact inside one staged revision.
 *
 * The declaration validator already rejects absolute paths and `.`/`..`
 * segments, so this cannot escape `packageRoot`.
 */
export function resolveBackendArtifactPath(packageRoot: string, entrypoint: string): string {
  return join(packageRoot, ...entrypoint.split('/'));
}
