/** Pure compiled-owner checks. Product manifests are never read by agent-host. */
import { isAbsolute, relative, resolve, sep } from 'node:path';

export type ExtensionProviderOwner = { path: string; modelProviderId?: string };

/** A managed owner may be a flat module or an immutable package directory. */
export function registrationBelongsToOwner(owner: string, entry: string): boolean {
  if (!owner.trim() || !entry.trim()) return false;
  const difference = relative(resolve(owner), resolve(entry));
  return difference === '' || (!isAbsolute(difference) && difference !== '..' && !difference.startsWith(`..${sep}`));
}

/** Protect channel registrations, and prevent a provider package claiming another id. */
export function canRegisterExtensionProvider(
  providerId: string,
  extensionPath: string | undefined,
  owners: readonly ExtensionProviderOwner[],
  channelProviderIds: ReadonlySet<string> = new Set(),
): boolean {
  if (!providerId.trim() || channelProviderIds.has(providerId)) return false;
  const matchesId = owners.filter((owner) => owner.modelProviderId === providerId);
  const matchesPath = extensionPath
    ? owners.filter((owner) => owner.modelProviderId && registrationBelongsToOwner(owner.path, extensionPath))
    : [];
  // Reject ambiguous compiled owners rather than allowing ordering to choose one.
  if (new Set(matchesId.map((owner) => resolve(owner.path))).size > 1) return false;
  if (matchesId.length > 0 && (!extensionPath || !matchesId.some((owner) => registrationBelongsToOwner(owner.path, extensionPath)))) {
    return false;
  }
  return matchesPath.every((owner) => owner.modelProviderId === providerId);
}

export function nativeRegistrationId(provider: unknown): string | undefined {
  if (!provider || typeof provider !== 'object') return undefined;
  const record = provider as Record<string, unknown>;
  return typeof record.id === 'string' && record.id.trim() ? record.id.trim() : undefined;
}

export function compiledChannelProviderIds(
  providers: readonly { providerId: string; auth: { kind: string } }[] = [],
): Set<string> {
  return new Set(providers.filter((provider) => provider.auth.kind !== 'oauth' && provider.auth.kind !== 'extension').map((provider) => provider.providerId));
}
