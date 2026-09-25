/**
 * Unified marketplace inventory projection (spec marketplace-capability-delivery
 * §5.2, §7). Pure: every input is a snapshot read from the owning service; the
 * result is never persisted. Status rules live here so Desktop and CLI never
 * re-derive "is it usable" from raw fields.
 */
import { createHash } from 'node:crypto';
import type {
  ExtensionDeploymentRecord,
  ExtensionSummary,
  InstalledExtensionRecord,
  MarketplaceAvailability,
  MarketplaceCapabilityKind,
  MarketplaceCatalogEntry,
  MarketplaceInstalledItem,
  MarketplaceInstalledListData,
  McpServerConfig,
  McpServerHealth,
  SkillSummary,
} from '@piwin/contracts';
import { canToggleSkill, canUninstallSkill, isExtensionBlueprintEligible } from '@piwin/contracts';
import type { LoadedExtensionRef } from '../sessions/session-runtime-controller.js';

const FAILED_DEPLOYMENT_PHASES = new Set<ExtensionDeploymentRecord['phase']>([
  'failed',
  'rolled-back',
  'restart-required',
]);

export type InventorySessionView = {
  /** Extensions the session's live runtime compiled; undefined when it is not live. */
  loadedExtensions?: readonly LoadedExtensionRef[];
  /** Most recent deployment for this session, used to surface apply failures. */
  latestDeployment?: ExtensionDeploymentRecord;
  /**
   * Pure chat conversations compile with no extensions by design (Pure Chat
   * spec §5.2), so nothing is ever "pending" for them.
   */
  conversationOnly?: boolean;
};

export type InventoryProjectionInput = {
  extensions: readonly ExtensionSummary[];
  managedRecords: readonly InstalledExtensionRecord[];
  skills: readonly SkillSummary[];
  mcpServers: Readonly<Record<string, McpServerConfig>>;
  mcpHealth: readonly McpServerHealth[];
  session?: InventorySessionView;
  matchCatalogEntry: (
    kind: MarketplaceCapabilityKind,
    capabilityId: string,
  ) => MarketplaceCatalogEntry | undefined;
};

function extensionAvailability(
  extension: ExtensionSummary,
  record: InstalledExtensionRecord | undefined,
  session: InventorySessionView | undefined,
): { availability: MarketplaceAvailability; message?: string } {
  if (record?.installationState === 'pending-removal') {
    return {
      availability: 'pending-removal',
      message: 'Removal finishes once no live session still loads it.',
    };
  }
  if (!extension.enabled) {
    return { availability: 'disabled' };
  }
  if (extension.compatibility && !isExtensionBlueprintEligible(extension.compatibility)) {
    return {
      availability: 'failed',
      message: 'Not compatible with the piwin Agent Runtime; it will not load.',
    };
  }
  if (session?.conversationOnly) {
    return {
      availability: 'installed',
      message: 'Chat conversations do not load extensions; project sessions do.',
    };
  }
  const loaded = session?.loadedExtensions;
  if (loaded === undefined) {
    // Without a live runtime we can only promise the next session loads it.
    return { availability: 'installed' };
  }
  const isLoaded = loaded.some(
    (ref) =>
      ref.resourceId === extension.id &&
      (extension.contentRevision === undefined || ref.contentRevision === extension.contentRevision),
  );
  if (isLoaded) {
    return { availability: 'available' };
  }
  const deployment = session?.latestDeployment;
  if (deployment && FAILED_DEPLOYMENT_PHASES.has(deployment.phase)) {
    return {
      availability: 'failed',
      message: deployment.error
        ? `Could not apply to this session: ${deployment.error}`
        : 'Could not apply to this session.',
    };
  }
  return { availability: 'pending-apply', message: 'Applies at the next run boundary.' };
}

function projectExtension(
  extension: ExtensionSummary,
  input: InventoryProjectionInput,
  recordsById: ReadonlyMap<string, InstalledExtensionRecord>,
): MarketplaceInstalledItem {
  const record = extension.managed ? recordsById.get(extension.id) : undefined;
  const { availability, message } = extensionAvailability(extension, record, input.session);
  const catalogEntry = input.matchCatalogEntry('extension', extension.id);
  const removal: MarketplaceInstalledItem['removal'] =
    extension.managed && record && availability !== 'pending-removal'
      ? { command: 'extensions/uninstall' }
      : extension.piPackageSource
        ? { command: 'marketplace/package-remove', packageSource: extension.piPackageSource }
        : undefined;
  return {
    installationKey: `extension:${extension.id}`,
    capabilityId: extension.id,
    kind: 'extension',
    name: extension.name,
    ...(extension.description ? { description: extension.description } : {}),
    ...(extension.version ? { version: extension.version } : {}),
    ...(catalogEntry ? { catalogEntryId: catalogEntry.entryId } : {}),
    availability,
    enabled: extension.enabled,
    source: extension.source,
    ...(message ? { message } : {}),
    canToggle: availability !== 'pending-removal',
    ...(removal ? { removal } : {}),
    ...(extension.compatibility ? { compatibilityTier: extension.compatibility.tier } : {}),
  };
}

function projectSkill(
  skill: SkillSummary,
  input: InventoryProjectionInput,
): MarketplaceInstalledItem {
  const catalogEntry = input.matchCatalogEntry('skill', skill.id);
  return {
    installationKey: `skill:${skill.id}`,
    capabilityId: skill.id,
    kind: 'skill',
    name: skill.name,
    ...(skill.description ? { description: skill.description } : {}),
    ...(catalogEntry ? { catalogEntryId: catalogEntry.entryId } : {}),
    // A scanned, enabled Skill is offered to the next prompt preparation.
    availability: skill.enabled ? 'available' : 'disabled',
    enabled: skill.enabled,
    source: skill.source,
    canToggle: canToggleSkill(skill.source),
    ...(canUninstallSkill(skill.source) ? { removal: { command: 'skills/uninstall' as const } } : {}),
  };
}

function mcpAvailability(
  config: McpServerConfig,
  health: McpServerHealth | undefined,
): { availability: MarketplaceAvailability; message?: string } {
  if (config.disabled || health?.status === 'disabled') {
    return { availability: 'disabled' };
  }
  const blankEnv = Object.entries(config.env ?? {})
    .filter(([, value]) => value.trim() === '')
    .map(([name]) => name);
  if (blankEnv.length > 0) {
    return {
      availability: 'configuration-required',
      message: `Missing value for ${blankEnv.join(', ')}`,
    };
  }
  if (health?.status === 'error') {
    return { availability: 'failed', message: health.lastError ?? 'Server failed to start.' };
  }
  if (health?.status === 'running') {
    return health.lastError
      ? { availability: 'failed', message: health.lastError }
      : { availability: 'available' };
  }
  return { availability: 'installed', message: 'Configured; starts when a session needs it.' };
}

function projectMcpServer(
  serverId: string,
  config: McpServerConfig,
  input: InventoryProjectionInput,
  healthById: ReadonlyMap<string, McpServerHealth>,
): MarketplaceInstalledItem {
  const { availability, message } = mcpAvailability(config, healthById.get(serverId));
  const catalogEntry = input.matchCatalogEntry('mcp', serverId);
  return {
    installationKey: `mcp:${serverId}`,
    capabilityId: serverId,
    kind: 'mcp',
    name: serverId,
    ...(catalogEntry ? { catalogEntryId: catalogEntry.entryId } : {}),
    availability,
    enabled: config.disabled !== true,
    source: 'mcp-config',
    ...(message ? { message } : {}),
    canToggle: false,
    removal: { command: 'mcp/remove' },
  };
}

/** Deterministic digest: the same inventory yields the same revision across restarts. */
export function computeInventoryRevision(items: readonly MarketplaceInstalledItem[]): string {
  const canonical = [...items].sort((left, right) =>
    left.installationKey.localeCompare(right.installationKey),
  );
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex').slice(0, 16);
}

export function projectMarketplaceInventory(
  input: InventoryProjectionInput,
): MarketplaceInstalledListData {
  const recordsById = new Map(input.managedRecords.map((record) => [record.id, record]));
  const healthById = new Map(input.mcpHealth.map((health) => [health.serverId, health]));
  const items: MarketplaceInstalledItem[] = [
    ...input.extensions.map((extension) => projectExtension(extension, input, recordsById)),
    ...input.skills
      .filter((skill) => skill.hidden !== true)
      .map((skill) => projectSkill(skill, input)),
    ...Object.entries(input.mcpServers).map(([serverId, config]) =>
      projectMcpServer(serverId, config, input, healthById),
    ),
  ];
  const seen = new Set<string>();
  const unique = items.filter((item) => {
    if (seen.has(item.installationKey)) return false;
    seen.add(item.installationKey);
    return true;
  });
  return { revision: computeInventoryRevision(unique), items: unique };
}
