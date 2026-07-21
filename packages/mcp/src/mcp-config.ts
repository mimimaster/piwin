import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { McpConfigDocument, McpServerConfig } from '@piwin/contracts';

export function createEmptyMcpConfig(): McpConfigDocument {
  return { mcpServers: {} };
}

export function getMcpConfigPath(piwinRoot: string): string {
  return join(piwinRoot, 'mcp.json');
}

export async function loadMcpConfig(piwinRoot: string): Promise<McpConfigDocument> {
  const configPath = getMcpConfigPath(piwinRoot);
  try {
    const raw = await readFile(configPath, 'utf8');
    return validateMcpConfig(JSON.parse(raw));
  } catch (error) {
    if (isNotFound(error)) {
      return createEmptyMcpConfig();
    }
    throw error;
  }
}

export async function saveMcpConfig(
  piwinRoot: string,
  document: McpConfigDocument,
): Promise<string> {
  const validated = validateMcpConfig(document);
  const configPath = getMcpConfigPath(piwinRoot);
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(validated, null, 2)}\n`, 'utf8');
  return configPath;
}

export type McpValidationIssue = {
  path: string;
  message: string;
};

export type McpValidationResult =
  | { ok: true; document: McpConfigDocument }
  | { ok: false; issues: McpValidationIssue[] };

/** Validate without throwing; used by CLI `mcp validate`. */
export function tryValidateMcpConfig(value: unknown): McpValidationResult {
  const issues: McpValidationIssue[] = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, issues: [{ path: '', message: 'root must be an object' }] };
  }
  const record = value as Record<string, unknown>;
  if (!('mcpServers' in record)) {
    return {
      ok: false,
      issues: [{ path: 'mcpServers', message: 'missing required field mcpServers' }],
    };
  }
  if (!record.mcpServers || typeof record.mcpServers !== 'object' || Array.isArray(record.mcpServers)) {
    return {
      ok: false,
      issues: [{ path: 'mcpServers', message: 'mcpServers must be an object map' }],
    };
  }
  const servers = record.mcpServers as Record<string, unknown>;
  const normalized: Record<string, McpServerConfig> = {};
  for (const [serverId, serverValue] of Object.entries(servers)) {
    if (!serverId.trim()) {
      issues.push({ path: 'mcpServers', message: 'server id must be non-empty' });
      continue;
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(serverId)) {
      issues.push({
        path: `mcpServers.${serverId}`,
        message: 'server id must match [a-zA-Z0-9_-]+',
      });
      continue;
    }
    if (!serverValue || typeof serverValue !== 'object' || Array.isArray(serverValue)) {
      issues.push({
        path: `mcpServers.${serverId}`,
        message: 'server config must be an object',
      });
      continue;
    }
    const serverRecord = serverValue as Record<string, unknown>;
    if (typeof serverRecord.command !== 'string' || serverRecord.command.trim().length === 0) {
      issues.push({
        path: `mcpServers.${serverId}.command`,
        message: 'command must be a non-empty string',
      });
      continue;
    }
    const config: McpServerConfig = {
      command: serverRecord.command.trim(),
    };
    if (Array.isArray(serverRecord.args)) {
      const args = serverRecord.args.filter((item): item is string => typeof item === 'string');
      if (args.length !== serverRecord.args.length) {
        issues.push({
          path: `mcpServers.${serverId}.args`,
          message: 'args must be an array of strings',
        });
      } else if (args.length > 0) {
        config.args = args;
      }
    } else if (serverRecord.args !== undefined) {
      issues.push({
        path: `mcpServers.${serverId}.args`,
        message: 'args must be an array of strings',
      });
    }
    if (serverRecord.env !== undefined) {
      if (!serverRecord.env || typeof serverRecord.env !== 'object' || Array.isArray(serverRecord.env)) {
        issues.push({
          path: `mcpServers.${serverId}.env`,
          message: 'env must be a string map',
        });
      } else {
        const env: Record<string, string> = {};
        let envOk = true;
        for (const [envKey, envValue] of Object.entries(serverRecord.env as Record<string, unknown>)) {
          if (typeof envValue !== 'string') {
            issues.push({
              path: `mcpServers.${serverId}.env.${envKey}`,
              message: 'env values must be strings',
            });
            envOk = false;
            break;
          }
          env[envKey] = envValue;
        }
        if (envOk && Object.keys(env).length > 0) {
          config.env = env;
        }
      }
    }
    if (typeof serverRecord.disabled === 'boolean') {
      config.disabled = serverRecord.disabled;
    } else if (serverRecord.disabled !== undefined) {
      issues.push({
        path: `mcpServers.${serverId}.disabled`,
        message: 'disabled must be a boolean',
      });
    }
    if (typeof serverRecord.restartOnCrash === 'boolean') {
      config.restartOnCrash = serverRecord.restartOnCrash;
    } else if (serverRecord.restartOnCrash !== undefined) {
      issues.push({
        path: `mcpServers.${serverId}.restartOnCrash`,
        message: 'restartOnCrash must be a boolean',
      });
    }
    normalized[serverId] = config;
  }
  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return { ok: true, document: { mcpServers: normalized } };
}

export function validateMcpConfig(value: unknown): McpConfigDocument {
  const result = tryValidateMcpConfig(value);
  if (!result.ok) {
    const summary = result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ');
    throw new Error(`Invalid mcp.json: ${summary}`);
  }
  return result.document;
}

/** Expand ${VAR} references in env values from process.env. */
export function expandEnvMap(
  envMap: Record<string, string> | undefined,
  envSource: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  if (!envMap) {
    return {};
  }
  const expanded: Record<string, string> = {};
  for (const [key, value] of Object.entries(envMap)) {
    expanded[key] = value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => {
      return envSource[name] ?? '';
    });
  }
  return expanded;
}

export function listEnabledServers(
  document: McpConfigDocument,
): Array<{ id: string; config: McpServerConfig }> {
  return Object.entries(document.mcpServers)
    .filter(([, config]) => config.disabled !== true)
    .map(([id, config]) => ({ id, config }));
}

function isNotFound(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === 'ENOENT',
  );
}
