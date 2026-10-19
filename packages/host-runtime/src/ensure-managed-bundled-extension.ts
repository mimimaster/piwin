import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { normalizeResourceId } from '@piwin/contracts';
import { createExtensionRevisionStore } from '@piwin/extensions';

/** Shipped provider packages use the same immutable store as marketplace installs. */
export async function ensureManagedBundledExtension(
  piwinRoot: string,
  sourcePath: string,
): Promise<'unmanaged' | 'installed' | 'current'> {
  let raw: string;
  try {
    raw = await readFile(join(sourcePath, 'package.json'), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'unmanaged';
    throw error;
  }
  const manifest = JSON.parse(raw) as {
    version?: unknown;
    piwin?: { managedId?: unknown; bundledFrom?: unknown; patch?: unknown };
  };
  const identity = manifest.piwin;
  if (identity?.managedId === undefined) return 'unmanaged';
  if (typeof identity.managedId !== 'string' || !identity.managedId ||
      normalizeResourceId(identity.managedId) !== identity.managedId ||
      typeof identity.bundledFrom !== 'string' || !identity.bundledFrom ||
      typeof manifest.version !== 'string' || !manifest.version) {
    throw new Error(`Invalid managed bundled extension: ${sourcePath}`);
  }
  const locator = `bundled:${identity.bundledFrom}@${manifest.version}+${String(identity.patch ?? 0)}`;
  const store = createExtensionRevisionStore(piwinRoot);
  const previous = await store.getRecord(identity.managedId);
  const selected = previous?.revisions.find((revision) => revision.contentRevision === previous.selectedRevision);
  if (selected?.sourceLocator === locator && selected.state === 'installed') return 'current';
  // Keep the marketplace ID so an existing install has one owner, one toggle,
  // and one revision selected after becoming a built-in extension.
  const staged = await store.stage({
    sourcePath, name: identity.managedId, source: 'bundled', sourceLocator: locator,
  });
  await store.selectRevision(staged.extensionId, staged.contentRevision);
  if (!previous) await store.setEnabled(staged.extensionId, true);
  return 'installed';
}
