/**
 * Host IPC handlers: mcp.
 */
import type { HostCommand, HostResponse } from '@piwin/contracts';
import {
  getMcpConfigPath,
  loadMcpConfig,
  saveMcpConfig,
  tryValidateMcpConfig,
} from '@piwin/mcp';
import { listMcpRegistryCards, draftToServerConfig } from '@piwin/marketplace';
import { fail, ok } from '../response-helpers.js';
import { getPiwinRoot } from '../paths.js';
import type { HostCommandContext } from './host-command-context.js';


const TYPES = new Set<HostCommand['type']>([
  'mcp/get',
  'mcp/validate',
  'mcp/save',
  'mcp/list_tools',
  'mcp/status',
  'mcp/start',
  'mcp/stop',
  'mcp/registry-list',
  'mcp/registry-install-draft',
]);

export function isMcpCommand(
  command: HostCommand,
): boolean {
  return TYPES.has(command.type);
}

export async function handleMcpCommand(
  command: HostCommand,
  requestId: string | undefined,
  context: HostCommandContext,
): Promise<HostResponse | null> {
  if (!TYPES.has(command.type)) {
    return null;
  }
  switch (command.type) {
        case 'mcp/get': {
          const rootDir = getPiwinRoot(context.piwinRoot);
          const document = await loadMcpConfig(rootDir);
          return ok(requestId, 'mcp/get', {
            document,
            path: getMcpConfigPath(rootDir),
          });
        }
        case 'mcp/validate': {
          const result = tryValidateMcpConfig(command.document);
          if (result.ok) {
            return ok(requestId, 'mcp/validate', { valid: true, document: result.document });
          }
          return ok(requestId, 'mcp/validate', { valid: false, issues: result.issues });
        }
        case 'mcp/save': {
          const rootDir = getPiwinRoot(context.piwinRoot);
          const validated = tryValidateMcpConfig(command.document);
          if (!validated.ok) {
            return fail(
              requestId,
              'mcp/save',
              validated.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '),
            );
          }
          const path = await saveMcpConfig(rootDir, validated.document);
          try {
            const report = await context.getMcpManager().applyConfig(validated.document);
            return ok(requestId, 'mcp/save', { path, document: validated.document, report });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return fail(requestId, 'mcp/save', `config saved but runtime apply failed: ${message}`);
          }
        }
        case 'mcp/list_tools': {
          const tools = await context.getMcpManager().listTools(command.serverId);
          return ok(requestId, 'mcp/list_tools', { serverId: command.serverId, tools });
        }
        case 'mcp/status': {
          const servers = await context.getMcpManager().listHealth();
          return ok(requestId, 'mcp/status', { servers });
        }
        case 'mcp/start': {
          const manager = context.getMcpManager();
          let health = await manager.start(command.serverId);
          // Prime metadata cache so the next session can expose direct tools.
          if (health.status === 'running') {
            try {
              await manager.discoverTools(command.serverId);
              const refreshed = (await manager.listHealth()).find(
                (item) => item.serverId === command.serverId,
              );
              if (refreshed) {
                health = refreshed;
              }
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              health = {
                ...health,
                lastError: health.lastError
                  ? `${health.lastError}; discover: ${message}`
                  : `discover: ${message}`,
              };
            }
          }
          return ok(requestId, 'mcp/start', { health });
        }
        case 'mcp/stop': {
          const health = await context.getMcpManager().stop(command.serverId);
          return ok(requestId, 'mcp/stop', { health });
        }
        case 'mcp/registry-list': {
          const cards = await listMcpRegistryCards({
            ...(command.query ? { query: command.query } : {}),
            includeOfficial: false,
          });
          return ok(requestId, 'mcp/registry-list', { cards });
        }
        case 'mcp/registry-install-draft': {
          const rootDir = getPiwinRoot(context.piwinRoot);
          const document = await loadMcpConfig(rootDir);
          const { serverId, config } = draftToServerConfig(command.serverId, command.draft);
          document.mcpServers[serverId] = config;
          await saveMcpConfig(rootDir, document);
          const report = await context.getMcpManager().applyConfig(document);
          return ok(requestId, 'mcp/registry-install-draft', {
            serverId,
            document,
            report,
          });
        }

    default:
      return null;
  }
}
