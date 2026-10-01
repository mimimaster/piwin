import type { MarketplaceCatalogEntry } from '@piwin/contracts';

/**
 * No bundled agent adapters.
 *
 * A session backend such as Grok Build installs as an ordinary extension from
 * its own source repository. This list stays empty so the Host never offers a
 * second, bundled install path.
 */
export const AGENT_CATALOG: readonly MarketplaceCatalogEntry[] = [];
