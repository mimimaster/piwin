/**
 * Host IPC: remove a Host-managed extension or an MCP server. Each removal
 * fails closed — the UI only hears "removed" once the owning store agrees.
 */
import type {
  ExtensionsUninstallData,
  HostCommand,
  HostResponse,
  McpRemoveData,
} from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import { createExtensionRevisionStore } from '@piwin/extensions';
import { loadMcpConfig, saveMcpConfig } from '@piwin/mcp';
import { purgeUnreferencedExtensions } from '../marketplace/inventory-reader.js';
import { getPiwinRoot } from '../paths.js';
import { fail, ok } from '../response-helpers.js';
import { pushExtensionCatalog } from './catalog-resources.js';
import type { HostCommandContext } from './host-command-context.js';

const TYPES = new Set<HostCommand['type']>(['extensions/uninstall', 'mcp/remove']);

async function uninstallExtension(
  command: Extract<HostCommand, { type: 'extensions/uninstall' }>,
  requestId: string | undefined,
  context: HostCommandContext,
): Promise<HostResponse> {
  const rootDir = getPiwinRoot(context.piwinRoot);
  const store = createExtensionRevisionStore(rootDir);
  const record = await store.getRecord(command.extensionId);
  if (!record) {
    return fail(
      requestId,
      command.type,
      'Only Host-managed extensions can be uninstalled here; disable it, or remove the Pi package it came from.',
    );
  }
  const registry = await store.markPendingRemoval(record.id);
  const removed = await purgeUnreferencedExtensions(context);
  await pushExtensionCatalog(context, rootDir, registry.revision);
  const data: ExtensionsUninstallData = {
    extensionId: record.id,
    state: removed.includes(record.id) ? 'removed' : 'pending-removal',
  };
  return ok(requestId, command.type, data);
}

async function removeMcpServer(
  command: Extract<HostCommand, { type: 'mcp/remove' }>,
  requestId: string | undefined,
  context: HostCommandContext,
): Promise<HostResponse> {
  const rootDir = getPiwinRoot(context.piwinRoot);
  const document = await loadMcpConfig(rootDir);
  if (!(command.serverId in document.mcpServers)) {
    return fail(requestId, command.type, `MCP server not configured: ${command.serverId}`);
  }
  const manager = context.getMcpManager();
  const health = await manager.stop(command.serverId);
  if (health.status !== 'stopped' && health.status !== 'disabled') {
    // Keep the config: deleting it would orphan a still-running process.
    return fail(
      requestId,
      command.type,
      `MCP server did not stop (${health.status}); configuration kept.`,
    );
  }
  delete document.mcpServers[command.serverId];
  await saveMcpConfig(rootDir, document);
  await manager.applyConfig(document);
  const data: McpRemoveData = { serverId: command.serverId };
  return ok(requestId, command.type, data);
}

export async function handleCapabilityRemovalCommand(
  command: HostCommand,
  requestId: string | undefined,
  context: HostCommandContext,
): Promise<HostResponse | null> {
  if (!TYPES.has(command.type)) {
    return null;
  }
  try {
    if (command.type === 'extensions/uninstall') {
      return await uninstallExtension(command, requestId, context);
    }
    if (command.type === 'mcp/remove') {
      return await removeMcpServer(command, requestId, context);
    }
    return null;
  } catch (error) {
    return fail(requestId, command.type, formatError(error));
  }
}
