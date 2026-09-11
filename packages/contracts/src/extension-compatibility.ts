/**
 * Static compatibility of a Pi extension for the Agent Runtime.
 * Listing never executes the module.
 */
export type ExtensionCompatibilityTier =
  | 'compatible'
  | 'degraded'
  | 'incompatible'
  | 'unverified';

export type ExtensionCompatibility = {
  tier: ExtensionCompatibilityTier;
};

/** Only compatible extensions are loaded into a Blueprint by default. */
export function isExtensionBlueprintEligible(
  compatibility: ExtensionCompatibility | undefined,
): boolean {
  return compatibility?.tier === 'compatible';
}
