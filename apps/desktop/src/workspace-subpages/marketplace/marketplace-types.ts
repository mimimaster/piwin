/**
 * View-state types for the capability marketplace. Catalog and inventory
 * shapes come from `@piwin/contracts`; nothing here restates Host truth.
 */
import type { MarketplaceCapabilityKind, MarketplaceCategory } from '@piwin/contracts';

export type MarketTab = 'discover' | 'installed';

export type MarketKindFilter = 'all' | MarketplaceCapabilityKind | 'piwin-extension';

export type MarketCategoryFilter = 'all' | MarketplaceCategory;

/** Community results order; `popular` keeps the source ranking. */
export type CommunitySort = 'popular' | 'recent';

/**
 * A Host request that is in flight for one catalog entry or installed item.
 * Only real request phases — no simulated percentages.
 */
export type MarketOperation =
  'installing' | 'updating' | 'enabling' | 'applying' | 'starting' | 'removing' | 'toggling';

export type MarketplaceToast = {
  text: string;
  title?: string | undefined;
  type: 'info' | 'success' | 'warning' | 'error';
  /** One follow-up, e.g. "Try it" after an install. */
  action?: { label: string; onClick: () => void } | undefined;
};
