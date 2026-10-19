/**
 * Exact enabled managed extension revisions allowed to contribute OAuth providers.
 *
 * Any extension may claim one subscription provider through `piwin.json`
 * (`authProvider`, optional `authProviderName`). The Host treats the claim
 * generically: no provider id is special-cased here or downstream.
 */
import type { SubscriptionAuthPort } from '@piwin/agent-host';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isValidExtensionAuthProviderId, parseExtensionModelProviderClaim } from '@piwin/contracts';
import { createExtensionRevisionStore } from '@piwin/extensions';

export type SubscriptionExtensionProvider = {
  kind?: 'auth' | 'model';
  providerId: string;
  entryPath: string;
  contentRevision?: string;
  /** Manifest `authProviderName`; the auth port falls back to Pi's registration name. */
  displayName?: string;
  bundled?: boolean;
  notice?: string;
};

export async function readSubscriptionExtensionProviders(
  piwinRoot: string,
): Promise<SubscriptionExtensionProvider[]> {
  const records = await createExtensionRevisionStore(piwinRoot).listRecords();
  const providers: SubscriptionExtensionProvider[] = [];
  const ambiguous = new Set<string>();
  for (const record of records) {
    if (!record.configuredEnabled || record.installationState === 'pending-removal') continue;
    const selected = record.revisions.find((revision) =>
      revision.contentRevision === record.selectedRevision && revision.state === 'installed');
    if (!selected) continue;
    const manifest = await readPiwinManifest(selected.packageRoot);
    if (!manifest) continue;
    const publicClaim = parseExtensionModelProviderClaim(manifest);
    const claim = publicClaim === 'invalid' ? 'invalid' : publicClaim
      ? { providerId: publicClaim.id, ...(publicClaim.name ? { displayName: publicClaim.name } : {}) }
      : parseAuthProviderClaim(manifest);
    if (claim === undefined) continue;
    if (claim === 'invalid') {
      console.warn(
        `[piwin-host] extension ${record.id} declares an invalid or reserved authProvider; ignored`,
      );
      continue;
    }
    // A single provider ID may only have one owner in the auth runtime.
    if (providers.some((provider) => provider.providerId === claim.providerId)) {
      ambiguous.add(claim.providerId);
      console.warn(`[piwin-host] multiple extensions claim ${claim.providerId}; all contributions refused`);
    }
    providers.push({
      ...(publicClaim ? { kind: 'model' as const } : {}),
      providerId: claim.providerId,
      entryPath: selected.entryPath,
      ...(publicClaim ? { contentRevision: selected.contentRevision } : {}),
      ...(selected.sourceLocator?.startsWith('bundled:') ? { bundled: true } : {}),
      ...(publicClaim && publicClaim !== 'invalid' && publicClaim.notice ? { notice: publicClaim.notice } : {}),
      ...(claim.displayName !== undefined ? { displayName: claim.displayName } : {}),
    });
  }
  return providers.filter((provider) => !ambiguous.has(provider.providerId));
}

/** Missing manifest is normal (most extensions are not auth providers). */
async function readPiwinManifest(packageRoot: string): Promise<Record<string, unknown> | undefined> {
  let raw: string;
  try {
    raw = await readFile(join(packageRoot, 'piwin.json'), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`[piwin-host] cannot read ${join(packageRoot, 'piwin.json')}; ignored`, error);
    }
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    console.warn(`[piwin-host] ${join(packageRoot, 'piwin.json')} is not valid JSON; ignored`);
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  return parsed as Record<string, unknown>;
}

export function parseAuthProviderClaim(
  manifest: Record<string, unknown>,
): { providerId: string; displayName?: string } | 'invalid' | undefined {
  const providerId = manifest['authProvider'];
  if (providerId === undefined) return undefined;
  if (typeof providerId !== 'string' || !isValidExtensionAuthProviderId(providerId)) {
    return 'invalid';
  }
  const name = manifest['authProviderName'];
  const displayName = typeof name === 'string' && name.trim() ? name.trim() : undefined;
  return displayName !== undefined ? { providerId, displayName } : { providerId };
}

/** Manifest name, then the extension's own Pi registration name, then the id. */
export function extensionDisplayName(
  provider: SubscriptionExtensionProvider,
  port: Pick<SubscriptionAuthPort, 'getProviderName'>,
): string {
  return provider.displayName ?? port.getProviderName?.(provider.providerId) ?? provider.providerId;
}
