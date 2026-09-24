/**
 * Capability marketplace: curated catalog entries and the Host inventory
 * projection. The catalog says what *can* be installed; the inventory is
 * computed live from the owning services and says what *is* installed and
 * whether it is usable. The two never share state (spec
 * marketplace-capability-delivery §5).
 */

import type { ExtensionCompatibilityTier } from './extension-compatibility.js';
import type { InstallSource, McpServerConfig } from './mcp.js';
import type { MarketplacePiPackageSource } from './marketplace-search.js';

/** Plugin bundles stay out of the market until the owner re-scopes them (2026-09-14). */
export type MarketplaceCapabilityKind = 'extension' | 'skill' | 'mcp';

export const MARKETPLACE_CAPABILITY_KINDS: readonly MarketplaceCapabilityKind[] = [
  'extension',
  'skill',
  'mcp',
];

export type MarketplaceCategory =
  | 'code-development'
  | 'design-content'
  | 'docs-research'
  | 'external-service';

export const MARKETPLACE_CATEGORIES: readonly MarketplaceCategory[] = [
  'code-development',
  'design-content',
  'docs-research',
  'external-service',
];

export type MarketplaceLocalizedText = {
  en: string;
  zhCN: string;
};

export type MarketplaceRequirement = {
  kind: 'host-os' | 'command' | 'account' | 'subscription' | 'environment';
  value: string;
  required: boolean;
  description: MarketplaceLocalizedText;
};

/**
 * Evidence is bound to an exact version. `piwin-tested` must carry the full
 * environment tuple; anything less may only claim author/static evidence.
 */
export type MarketplaceVerification =
  | { level: 'author-declared'; notes?: MarketplaceLocalizedText }
  | { level: 'static-scan'; testedVersion: string; notes?: MarketplaceLocalizedText }
  | {
      level: 'piwin-tested';
      testedVersion: string;
      piwinVersion: string;
      piVersion: string;
      hostOs: 'macos' | 'windows' | 'linux';
      backend: 'sdk' | 'rpc';
      testedAt: string;
      notes?: MarketplaceLocalizedText;
    };

/**
 * How a catalog entry installs. Each variant maps to exactly one existing
 * domain command; there is deliberately no generic `marketplace/install`.
 */
export type MarketplaceInstallDescriptor =
  /** Pi package through Pi's PackageManager → `marketplace/package-install`. */
  | { kind: 'pi-package'; source: MarketplacePiPackageSource }
  /** Host-managed immutable extension revision → `extensions/install`. */
  | { kind: 'managed-extension'; source: InstallSource; name?: string }
  | { kind: 'skill'; source: InstallSource; name?: string }
  | { kind: 'mcp'; serverId: string; draft: McpServerConfig };

export type MarketplaceExample = {
  title: MarketplaceLocalizedText;
  prompt: MarketplaceLocalizedText;
  expectedResult?: MarketplaceLocalizedText;
};

export type MarketplaceCatalogEntry = {
  /** `<kind>:<stable-id>`; never derived from the display name. */
  entryId: string;
  /**
   * Resource id the owning service reports once installed (extension id,
   * skill id, MCP server id). Pi packages with several extensions report
   * `<capabilityId>-<entry>` ids, which still match this namespace.
   */
  capabilityId: string;
  kind: MarketplaceCapabilityKind;
  category: MarketplaceCategory;
  name: MarketplaceLocalizedText;
  summary: MarketplaceLocalizedText;
  description: MarketplaceLocalizedText;
  /** Exact version, npm version or git commit — never a moving branch. */
  version: string;
  author: string;
  homepage?: string;
  sourceLabel: string;
  install: MarketplaceInstallDescriptor;
  requirements: MarketplaceRequirement[];
  examples: MarketplaceExample[];
  verification: MarketplaceVerification[];
  featured: boolean;
  withdrawn?: { reason: MarketplaceLocalizedText; replacementEntryId?: string };
};

export type MarketplaceAvailability =
  | 'installed'
  | 'configuration-required'
  | 'pending-apply'
  | 'available'
  | 'disabled'
  | 'failed'
  | 'pending-removal';

/**
 * Host-decided removal path for one installed item. Clients send the named
 * command; they never infer removability from the source label.
 */
export type MarketplaceRemovalRoute =
  | { command: 'extensions/uninstall' }
  | { command: 'marketplace/package-remove'; packageSource: string }
  | { command: 'skills/uninstall' }
  | { command: 'mcp/remove' };

export type MarketplaceInstalledItem = {
  /** `<kind>:<capabilityId>`; unique inside one inventory. */
  installationKey: string;
  capabilityId: string;
  kind: MarketplaceCapabilityKind;
  name: string;
  description?: string;
  version?: string;
  catalogEntryId?: string;
  availability: MarketplaceAvailability;
  enabled: boolean;
  /** Owning source label (`bundled`, `user`, `pi-native`, `project`, `mcp-config`, …). */
  source: string;
  /** Short user-facing reason; stack traces stay in diagnostics. */
  message?: string;
  canToggle: boolean;
  removal?: MarketplaceRemovalRoute;
  compatibilityTier?: ExtensionCompatibilityTier;
};

export type MarketplaceCatalogListData = { entries: MarketplaceCatalogEntry[] };
export type MarketplaceCatalogGetData = { entry: MarketplaceCatalogEntry };

export type MarketplaceInstalledListData = {
  /** Stable digest of the normalized inventory; equal inventories → equal revision. */
  revision: string;
  items: MarketplaceInstalledItem[];
};

export type ExtensionsUninstallData = {
  extensionId: string;
  /** `pending-removal` while a live runtime still references the revision. */
  state: 'removed' | 'pending-removal';
};

export type MarketplacePackageRemoveData = { packageSource: string };

export type McpRemoveData = { serverId: string };
