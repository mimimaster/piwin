/**
 * Host IPC: remove a Host-managed extension or an MCP server. Each removal
 * fails closed — the UI only hears "removed" once the owning store agrees.
 */
import { rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type {
  ExtensionsUninstallData,
  HostCommand,
  HostResponse,
  McpRemoveData,
} from '@piwin/contracts';
import { formatError, normalizeResourceId } from '@piwin/contracts';
import { createExtensionRevisionStore } from '@piwin/extensions';
import { loadMcpConfig, saveMcpConfig } from '@piwin/mcp';
import { purgeUnreferencedExtensions } from '../marketplace/inventory-reader.js';
import { getPiwinExtensionsDir, getPiwinRoot } from '../paths.js';
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
  let record = await store.getRecord(command.extensionId);
  if (!record) {
    const candidateId = normalizeResourceId(command.extensionId);
    const allRecords = await store.listRecords();
    record = allRecords.find(
      (r) =>
        r.id === candidateId ||
        r.name === command.extensionId ||
        r.id === candidateId.replace(/^piwin-/, '') ||
        `piwin-${r.id}` === candidateId ||
        r.name.replace(/^piwin-/, '') === candidateId.replace(/^piwin-/, ''),
    );
  }
  if (!record) {
    // Check if this is an unmanaged user extension in ~/.piwin/extensions/
    const extensionsDir = resolve(getPiwinExtensionsDir(rootDir));
    const normalizedInput = command.extensionId.replace(/^piwin-/, '');
    const candidates = [
      join(extensionsDir, command.extensionId),
      join(extensionsDir, `${command.extensionId}.ts`),
      join(extensionsDir, normalizedInput),
      join(extensionsDir, `${normalizedInput}.ts`),
    ];
    let unmanagedTarget: string | undefined;
    for (const cand of candidates) {
      try {
        await stat(cand);
        if (resolve(cand).startsWith(extensionsDir) && resolve(cand) !== extensionsDir) {
          unmanagedTarget = cand;
          break;
        }
      } catch {
        // stat miss: this candidate spelling does not exist; try the next one.
      }
    }
    if (unmanagedTarget) {
      await rm(unmanagedTarget, { recursive: true, force: true });
      await pushExtensionCatalog(context, rootDir, 'unmanaged-removed');
      const data: ExtensionsUninstallData = {
        extensionId: command.extensionId,
        state: 'removed',
      };
      return ok(requestId, command.type, data);
    }
    return fail(
      requestId,
      command.type,
      'Only Host-managed extensions can be uninstalled here; disable it, or remove the Pi package it came from.',
    );
  }

  // `force` means delete now, even if a live runtime still names the revision.
  // Mark pending first: purge only drops records already in that state.
  if (command.force && record.installationState !== 'pending-removal') {
    await store.markPendingRemoval(record.id);
  }
  if (record.installationState === 'pending-removal' || command.force) {
    await store.purgeRemoved(new Set());
    await pushExtensionCatalog(context, rootDir, 'purged');
    const data: ExtensionsUninstallData = {
      extensionId: record.id,
      state: 'removed',
    };
    return ok(requestId, command.type, data);
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
