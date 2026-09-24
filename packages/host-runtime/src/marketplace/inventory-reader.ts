/**
 * Reads the snapshots the inventory projection needs from each owning service
 * (resource scanners, extension registry, MCP config/manager, session runtime)
 * and publishes `marketplace/inventory-updated` after capability mutations.
 */
import type {
  ExtensionDeploymentRecord,
  HostCommand,
  MarketplaceCapabilityKind,
  MarketplaceInstalledListData,
} from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import { createExtensionRevisionStore } from '@piwin/extensions';
import { matchCatalogEntry } from '@piwin/marketplace';
import { loadMcpConfig } from '@piwin/mcp';
import { loadCatalogResources } from '../commands/catalog-resources.js';
import type { HostCommandContext } from '../commands/host-command-context.js';
import { getPiwinRoot } from '../paths.js';
import { projectMarketplaceInventory, type InventorySessionView } from './inventory-projection.js';

export type ReadInventoryOptions = {
  sessionId?: string;
  projectPath?: string;
};

function latestDeploymentFor(
  deployments: readonly ExtensionDeploymentRecord[],
  sessionId: string,
): ExtensionDeploymentRecord | undefined {
  return deployments
    .filter((deployment) => deployment.sessionId === sessionId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
}

export async function readMarketplaceInventory(
  context: HostCommandContext,
  options: ReadInventoryOptions = {},
): Promise<MarketplaceInstalledListData> {
  const rootDir = getPiwinRoot(context.piwinRoot);
  const store = createExtensionRevisionStore(rootDir);
  const [resources, managedRecords, mcpConfig, mcpHealth] = await Promise.all([
    loadCatalogResources(rootDir, options.projectPath),
    store.listRecords(),
    loadMcpConfig(rootDir),
    context.getMcpManager().listHealth(),
  ]);
  let session: InventorySessionView | undefined;
  if (options.sessionId) {
    const loadedExtensions = context.getLoadedExtensions?.(options.sessionId);
    const latestDeployment = latestDeploymentFor(await store.listDeployments(), options.sessionId);
    session = {
      ...(loadedExtensions ? { loadedExtensions } : {}),
      ...(latestDeployment ? { latestDeployment } : {}),
    };
  }
  return projectMarketplaceInventory({
    extensions: resources.extensions,
    managedRecords,
    skills: resources.skills,
    mcpServers: mcpConfig.mcpServers,
    mcpHealth,
    ...(session ? { session } : {}),
    matchCatalogEntry: (kind, capabilityId) => matchCatalogEntry(kind, capabilityId),
  });
}

/**
 * Catalog entries already present on this Host, by entry id. Cheap (no MCP
 * health, no session view) so agent tools can mark search results.
 */
export async function readInstalledCatalogEntryIds(piwinRoot: string): Promise<Set<string>> {
  const [resources, mcpConfig] = await Promise.all([
    loadCatalogResources(piwinRoot),
    loadMcpConfig(piwinRoot),
  ]);
  const installed = new Set<string>();
  const mark = (kind: MarketplaceCapabilityKind, capabilityId: string): void => {
    const entry = matchCatalogEntry(kind, capabilityId);
    if (entry) installed.add(entry.entryId);
  };
  for (const extension of resources.extensions) mark('extension', extension.id);
  for (const skill of resources.skills) mark('skill', skill.id);
  for (const serverId of Object.keys(mcpConfig.mcpServers)) mark('mcp', serverId);
  return installed;
}

/**
 * Finish any uninstall whose revisions no runtime holds anymore. Safe to call
 * often: it only deletes records already marked pending-removal.
 */
export async function purgeUnreferencedExtensions(context: HostCommandContext): Promise<string[]> {
  const referenced = context.listLoadedExtensionRevisions?.();
  if (referenced === undefined) {
    // Without runtime knowledge every revision might be live; keep the files.
    return [];
  }
  return createExtensionRevisionStore(getPiwinRoot(context.piwinRoot)).purgeRemoved(referenced);
}

const INVENTORY_MUTATIONS: ReadonlyMap<HostCommand['type'], MarketplaceCapabilityKind[]> = new Map<
  HostCommand['type'],
  MarketplaceCapabilityKind[]
>([
  ['extensions/install', ['extension']],
  ['extensions/set_enabled', ['extension']],
  ['extensions/uninstall', ['extension']],
  // A Pi package can ship extensions and skills together.
  ['marketplace/package-install', ['extension', 'skill']],
  ['marketplace/package-remove', ['extension', 'skill']],
  ['skills/install', ['skill']],
  ['skills/uninstall', ['skill']],
  ['skills/set_enabled', ['skill']],
  ['mcp/save', ['mcp']],
  ['mcp/start', ['mcp']],
  ['mcp/stop', ['mcp']],
  ['mcp/remove', ['mcp']],
  ['mcp/registry-install-draft', ['mcp']],
]);

export function inventoryKindsChangedBy(
  commandType: HostCommand['type'],
): readonly MarketplaceCapabilityKind[] | undefined {
  return INVENTORY_MUTATIONS.get(commandType);
}

/**
 * Broadcast the new inventory revision after a successful mutation. Failures
 * are logged, never thrown: the mutation itself already succeeded.
 */
export async function pushInventoryUpdated(
  context: HostCommandContext,
  changedKinds: readonly MarketplaceCapabilityKind[],
): Promise<void> {
  try {
    const inventory = await readMarketplaceInventory(context);
    context.push({
      type: 'marketplace/inventory-updated',
      revision: inventory.revision,
      changedKinds: [...changedKinds],
    });
  } catch (error) {
    context.push({
      type: 'host/log',
      level: 'warn',
      message: `marketplace inventory refresh failed: ${formatError(error)}`,
    });
  }
}
