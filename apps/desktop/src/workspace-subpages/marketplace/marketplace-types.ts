/**
 * View-state types for the capability marketplace. Catalog and inventory
 * shapes come from `@piwin/contracts`; nothing here restates Host truth.
 */
import type { MarketplaceCapabilityKind } from '@piwin/contracts';

export type MarketTab = 'discover' | 'installed';

export type MarketKindFilter = 'all' | MarketplaceCapabilityKind;

/**
 * A Host request that is in flight for one catalog entry or installed item.
 * Only real request phases — no simulated percentages.
 */
export type MarketOperation =
  | 'installing'
  | 'enabling'
  | 'applying'
  | 'starting'
  | 'removing'
  | 'toggling';

export type MarketplaceToast = {
  text: string;
  title?: string | undefined;
  type: 'info' | 'success' | 'warning' | 'error';
};
