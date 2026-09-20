/**
 * Mirror lease tracking for BrowserRuntime (spec §4.1.1).
 *
 * Keeps active lease ids, tombstoned released lease ids (to prevent out-of-order
 * resurrects), and the legacy unnamed lease flag.
 */

const MAX_MIRROR_LEASE_ID_CHARS = 128;
const MAX_RELEASED_MIRROR_LEASES = 256;

export type BrowserLeaseTracker = {
  hasActiveMirrorLease(): boolean;
  mirrorLeaseCount(): number;
  hasMirrorLease(leaseId: string): boolean;
  acquireMirrorLease(leaseId?: string): boolean;
  releaseMirrorLease(leaseId?: string): boolean;
  clearLeases(): void;
};

export function createBrowserLeaseTracker(): BrowserLeaseTracker {
  let legacyMirrorLeaseActive = false;
  const activeMirrorLeaseIds = new Set<string>();
  const releasedMirrorLeaseIds = new Set<string>();

  function validateMirrorLeaseId(leaseId: string | undefined): string | undefined {
    if (leaseId === undefined) return undefined;
    if (leaseId.length === 0 || leaseId.length > MAX_MIRROR_LEASE_ID_CHARS) {
      throw new RangeError('browser mirror lease id is invalid');
    }
    return leaseId;
  }

  function rememberReleasedMirrorLease(leaseId: string): void {
    releasedMirrorLeaseIds.delete(leaseId);
    releasedMirrorLeaseIds.add(leaseId);
    while (releasedMirrorLeaseIds.size > MAX_RELEASED_MIRROR_LEASES) {
      const oldestLeaseId = releasedMirrorLeaseIds.values().next().value;
      if (typeof oldestLeaseId !== 'string') break;
      releasedMirrorLeaseIds.delete(oldestLeaseId);
    }
  }

  return {
    hasActiveMirrorLease(): boolean {
      return legacyMirrorLeaseActive || activeMirrorLeaseIds.size > 0;
    },
    mirrorLeaseCount(): number {
      return (legacyMirrorLeaseActive ? 1 : 0) + activeMirrorLeaseIds.size;
    },
    hasMirrorLease(leaseId: string): boolean {
      return activeMirrorLeaseIds.has(leaseId);
    },
    acquireMirrorLease(leaseId?: string): boolean {
      const normalizedLeaseId = validateMirrorLeaseId(leaseId);
      if (normalizedLeaseId !== undefined && releasedMirrorLeaseIds.has(normalizedLeaseId)) {
        // A cleanup that overtook its setup owns the final intent. Lease ids
        // are one-shot, so a delayed/retried start must not resurrect a panel
        // that has already unmounted.
        return false;
      }
      if (normalizedLeaseId === undefined) {
        legacyMirrorLeaseActive = true;
      } else {
        activeMirrorLeaseIds.add(normalizedLeaseId);
      }
      return true;
    },
    releaseMirrorLease(leaseId?: string): boolean {
      const normalizedLeaseId = validateMirrorLeaseId(leaseId);
      if (normalizedLeaseId === undefined) {
        legacyMirrorLeaseActive = false;
      } else {
        activeMirrorLeaseIds.delete(normalizedLeaseId);
        rememberReleasedMirrorLease(normalizedLeaseId);
      }
      return !legacyMirrorLeaseActive && activeMirrorLeaseIds.size === 0;
    },
    clearLeases(): void {
      legacyMirrorLeaseActive = false;
      activeMirrorLeaseIds.clear();
      releasedMirrorLeaseIds.clear();
    },
  };
}
