/**
 * Unique provider config identity helpers.
 * One vendor channel may have many configs (each with its own baseUrl + key).
 */

/** Prefer the base id; if taken, allocate base-2, base-3, ... */
export function allocateUniqueProviderId(
  preferredId: string,
  existingIds: Iterable<string>,
): string {
  const baseId = preferredId.trim() || 'provider';
  const taken = new Set(
    [...existingIds]
      .map((id) => id.trim())
      .filter((id) => id.length > 0),
  );
  if (!taken.has(baseId)) {
    return baseId;
  }
  let suffix = 2;
  while (taken.has(`${baseId}-${suffix}`)) {
    suffix += 1;
  }
  return `${baseId}-${suffix}`;
}

/** Prefer the base name; if taken, allocate "Name 2", "Name 3", ... */
export function allocateUniqueProviderName(
  preferredName: string,
  existingNames: Iterable<string>,
): string {
  const baseName = preferredName.trim() || 'Provider';
  const taken = new Set(
    [...existingNames]
      .map((name) => name.trim().toLowerCase())
      .filter((name) => name.length > 0),
  );
  if (!taken.has(baseName.toLowerCase())) {
    return baseName;
  }
  let suffix = 2;
  while (taken.has(`${baseName} ${suffix}`.toLowerCase())) {
    suffix += 1;
  }
  return `${baseName} ${suffix}`;
}
