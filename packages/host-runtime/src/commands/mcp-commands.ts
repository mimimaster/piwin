/**
 * Host IPC handlers: mcp.
 */
import type { HostCommand, HostResponse } from '@piwin/contracts'
import { formatError } from '@piwin/contracts';;
import {
  getMcpConfigPath,
  loadMcpConfig,
  saveMcpConfig,
  tryValidateMcpConfig,
} from '@piwin/mcp';
import { listMcpRegistryCards } from '@piwin/marketplace';
import {
  McpServerConflictError,
  saveMcpServerDraft,
  startMcpServerWithDiscovery,
} from '../marketplace/mcp-install.js';
import { fail, ok } from '../response-helpers.js';
import { getSessionRecord, upsertSessionRecord } from '@piwin/session';
import { getPiwinRoot, getPiwinSessionIndexPath } from '../paths.js';
import { normalizeSessionMcpServerIds } from '../session-mcp-overrides.js';
import { sessionIndexUpdatedPush } from '../session-index-push.js';
import { indexRecordToSummary } from '../session-summary-map.js';
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
  'session/set-mcp-servers',
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
            const message = formatError(error);
            return fail(requestId, 'mcp/save', `config saved but runtime apply failed: ${message}`);
          }
        }
        case 'mcp/list_tools': {
          const tools = await context.getMcpManager().listTools(command.serverId);
          return ok(requestId, 'mcp/list_tools', { serverId: command.serverId, tools });
        }
        case 'session/set-mcp-servers': {
          const indexPath = getPiwinSessionIndexPath(getPiwinRoot(context.piwinRoot));
          const record = await getSessionRecord(indexPath, command.sessionId);
          if (!record) {
            return fail(requestId, command.type, `Unknown session: ${command.sessionId}`);
          }
          const disabledServerIds = normalizeSessionMcpServerIds(command.disabledServerIds);
          if (disabledServerIds.length > 0) {
            record.disabledMcpServerIds = disabledServerIds;
          } else {
            delete record.disabledMcpServerIds;
          }
          record.updatedAt = new Date().toISOString();
          await upsertSessionRecord(indexPath, record);
          // The live generation keeps its frozen MCP surface; the next prompt
          // sees the changed override key and rebuilds before it runs.
          context.push(
            sessionIndexUpdatedPush({
              op: 'updated',
              sessionId: command.sessionId,
              session: indexRecordToSummary(record),
            }),
          );
          return ok(requestId, command.type, { sessionId: command.sessionId, disabledServerIds });
        }
        case 'mcp/status': {
          const servers = await context.getMcpManager().listHealth();
          return ok(requestId, 'mcp/status', { servers });
        }
        case 'mcp/start': {
          const health = await startMcpServerWithDiscovery(context.getMcpManager(), command.serverId);
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
          try {
            const result = await saveMcpServerDraft(
              getPiwinRoot(context.piwinRoot),
              context.getMcpManager(),
              command.serverId,
              command.draft,
            );
            return ok(requestId, 'mcp/registry-install-draft', result);
          } catch (error) {
            if (error instanceof McpServerConflictError) {
              return fail(requestId, 'mcp/registry-install-draft', error.message);
            }
            throw error;
          }
        }

    default:
      return null;
  }
}
