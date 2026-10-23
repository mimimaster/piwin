import type {
  McpRemoteServerConfig,
  McpServerConfig,
  McpStdioServerConfig,
} from '@piwin/contracts';

export type McpValidationIssue = {
  path: string;
  message: string;
};

/**
 * Validate one `mcpServers.<id>` entry. A `url` makes it a remote server,
 * otherwise `command` is required. Issues are appended; the normalized config
 * is returned only when the entry's transport fields are usable.
 */
export function validateMcpServerEntry(
  serverId: string,
  serverRecord: Record<string, unknown>,
  issues: McpValidationIssue[],
): McpServerConfig | undefined {
  const path = `mcpServers.${serverId}`;
  const hasUrl = serverRecord.url !== undefined;
  const hasCommand = serverRecord.command !== undefined;
  if (hasUrl && hasCommand) {
    issues.push({ path, message: 'set either command (stdio) or url (remote), not both' });
    return undefined;
  }
  const config = hasUrl
    ? readRemoteTransport(path, serverRecord, issues)
    : readStdioTransport(path, serverRecord, issues);
  if (config === undefined) return undefined;

  if (typeof serverRecord.disabled === 'boolean') {
    config.disabled = serverRecord.disabled;
  } else if (serverRecord.disabled !== undefined) {
    issues.push({ path: `${path}.disabled`, message: 'disabled must be a boolean' });
  }
  if (typeof serverRecord.restartOnCrash === 'boolean') {
    config.restartOnCrash = serverRecord.restartOnCrash;
  } else if (serverRecord.restartOnCrash !== undefined) {
    issues.push({ path: `${path}.restartOnCrash`, message: 'restartOnCrash must be a boolean' });
  }
  return config;
}

function readStdioTransport(
  path: string,
  serverRecord: Record<string, unknown>,
  issues: McpValidationIssue[],
): McpStdioServerConfig | undefined {
  if (typeof serverRecord.command !== 'string' || serverRecord.command.trim().length === 0) {
    issues.push({ path: `${path}.command`, message: 'command must be a non-empty string' });
    return undefined;
  }
  if (serverRecord.type !== undefined && serverRecord.type !== 'stdio') {
    issues.push({ path: `${path}.type`, message: 'a command server must have type "stdio"' });
  }
  const config: McpStdioServerConfig = { command: serverRecord.command.trim() };
  if (serverRecord.type === 'stdio') config.type = 'stdio';
  if (Array.isArray(serverRecord.args)) {
    const args = serverRecord.args.filter((item): item is string => typeof item === 'string');
    if (args.length !== serverRecord.args.length) {
      issues.push({ path: `${path}.args`, message: 'args must be an array of strings' });
    } else if (args.length > 0) {
      config.args = args;
    }
  } else if (serverRecord.args !== undefined) {
    issues.push({ path: `${path}.args`, message: 'args must be an array of strings' });
  }
  const env = readStringMap(`${path}.env`, 'env', serverRecord.env, issues);
  if (env !== undefined) config.env = env;
  if (serverRecord.headers !== undefined) {
    issues.push({ path: `${path}.headers`, message: 'headers apply only to url servers' });
  }
  return config;
}

function readRemoteTransport(
  path: string,
  serverRecord: Record<string, unknown>,
  issues: McpValidationIssue[],
): McpRemoteServerConfig | undefined {
  const rawUrl = serverRecord.url;
  if (typeof rawUrl !== 'string' || !isHttpUrl(rawUrl.trim())) {
    issues.push({ path: `${path}.url`, message: 'url must be an http or https URL' });
    return undefined;
  }
  const config: McpRemoteServerConfig = { url: rawUrl.trim() };
  // `streamable-http` is the spelling some clients (VS Code, Gemini) write.
  const type = serverRecord.type === 'streamable-http' ? 'http' : serverRecord.type;
  if (type === 'http' || type === 'sse') {
    config.type = type;
  } else if (type !== undefined) {
    issues.push({ path: `${path}.type`, message: 'type must be "http" or "sse" for url servers' });
  }
  const headers = readStringMap(`${path}.headers`, 'headers', serverRecord.headers, issues);
  if (headers !== undefined) config.headers = headers;
  for (const stdioOnly of ['args', 'env'] as const) {
    if (serverRecord[stdioOnly] !== undefined) {
      issues.push({ path: `${path}.${stdioOnly}`, message: `${stdioOnly} applies only to command servers` });
    }
  }
  return config;
}

function readStringMap(
  path: string,
  label: 'env' | 'headers',
  value: unknown,
  issues: McpValidationIssue[],
): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    issues.push({ path, message: `${label} must be a string map` });
    return undefined;
  }
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry !== 'string') {
      issues.push({ path: `${path}.${key}`, message: `${label} values must be strings` });
      return undefined;
    }
    result[key] = entry;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
