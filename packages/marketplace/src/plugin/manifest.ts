/**
 * Parse + validate a plugin manifest (`plugin.json`).
 *
 * Manifests are untrusted input — validation fails closed on unknown keys,
 * bad types, path traversal, and invalid identifiers.
 */
import type {
  PluginManifest,
  PluginMcpServerConfig,
  PluginSecretDecl,
} from '@piwin/contracts';

export type ManifestIssue = {
  path: string;
  message: string;
};

export type ManifestValidationResult =
  | { ok: true; manifest: PluginManifest }
  | { ok: false; issues: ManifestIssue[] };

const ID_PATTERN = /^[a-z0-9-]+$/;
const SERVER_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const SECRET_NAME_PATTERN = /^[A-Z0-9_]+$/;

const ALLOWED_TOP_LEVEL_KEYS = new Set([
  'id',
  'version',
  'name',
  'description',
  'skills',
  'mcpServers',
  'secrets',
]);

const ALLOWED_MCP_SERVER_KEYS = new Set([
  'command',
  'args',
  'env',
  'disabled',
  'restartOnCrash',
]);

const ALLOWED_SECRET_KEYS = new Set([
  'name',
  'displayName',
  'description',
  'required',
  'defaultEnv',
]);

/** Validate without throwing; used by UI and programmatic callers. */
export function tryValidatePluginManifest(raw: unknown): ManifestValidationResult {
  const issues: ManifestIssue[] = [];

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, issues: [{ path: '', message: 'manifest must be an object' }] };
  }

  const record = raw as Record<string, unknown>;

  // Reject unknown top-level keys (fail closed).
  for (const key of Object.keys(record)) {
    if (!ALLOWED_TOP_LEVEL_KEYS.has(key)) {
      issues.push({ path: key, message: `unknown top-level key "${key}"` });
    }
  }

  // id
  if (typeof record.id !== 'string' || !record.id.trim()) {
    issues.push({ path: 'id', message: 'id must be a non-empty string' });
  } else if (!ID_PATTERN.test(record.id)) {
    issues.push({
      path: 'id',
      message: 'id must match ^[a-z0-9-]+$ (lowercase kebab)',
    });
  }

  // version
  if (typeof record.version !== 'string' || !record.version.trim()) {
    issues.push({ path: 'version', message: 'version must be a non-empty string' });
  }

  // name
  if (typeof record.name !== 'string' || !record.name.trim()) {
    issues.push({ path: 'name', message: 'name must be a non-empty string' });
  }

  // description (optional)
  if (
    record.description !== undefined &&
    (typeof record.description !== 'string' || !record.description.trim())
  ) {
    issues.push({ path: 'description', message: 'description must be a non-empty string if present' });
  }

  // skills (optional)
  let skills: string[] | undefined;
  if (record.skills !== undefined) {
    if (!Array.isArray(record.skills)) {
      issues.push({ path: 'skills', message: 'skills must be an array of strings' });
    } else {
      skills = [];
      for (let i = 0; i < record.skills.length; i++) {
        const entry = record.skills[i];
        if (typeof entry !== 'string' || !entry.trim()) {
          issues.push({ path: `skills[${i}]`, message: 'skill path must be a non-empty string' });
          continue;
        }
        const pathError = validateRelativePath(entry);
        if (pathError) {
          issues.push({ path: `skills[${i}]`, message: pathError });
          continue;
        }
        skills.push(entry.trim());
      }
    }
  }

  // mcpServers (optional)
  let mcpServers: Record<string, PluginMcpServerConfig> | undefined;
  if (record.mcpServers !== undefined) {
    if (!record.mcpServers || typeof record.mcpServers !== 'object' || Array.isArray(record.mcpServers)) {
      issues.push({ path: 'mcpServers', message: 'mcpServers must be an object map' });
    } else {
      mcpServers = {};
      for (const [serverId, serverValue] of Object.entries(record.mcpServers)) {
        if (!serverId.trim()) {
          issues.push({ path: 'mcpServers', message: 'server id must be non-empty' });
          continue;
        }
        if (!SERVER_ID_PATTERN.test(serverId)) {
          issues.push({
            path: `mcpServers.${serverId}`,
            message: 'server id must match ^[a-zA-Z0-9_-]+$',
          });
          continue;
        }
        const serverResult = validateMcpServer(serverValue, `mcpServers.${serverId}`);
        if (serverResult.ok) {
          mcpServers[serverId] = serverResult.config;
        } else {
          issues.push(...serverResult.issues);
        }
      }
    }
  }

  // secrets (optional)
  let secrets: PluginSecretDecl[] | undefined;
  if (record.secrets !== undefined) {
    if (!Array.isArray(record.secrets)) {
      issues.push({ path: 'secrets', message: 'secrets must be an array' });
    } else {
      secrets = [];
      for (let i = 0; i < record.secrets.length; i++) {
        const entry = record.secrets[i];
        const secretResult = validateSecretDecl(entry, `secrets[${i}]`);
        if (secretResult.ok) {
          secrets.push(secretResult.decl);
        } else {
          issues.push(...secretResult.issues);
        }
      }
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  const manifest: PluginManifest = {
    id: record.id as string,
    version: record.version as string,
    name: record.name as string,
  };
  if (record.description !== undefined) {
    manifest.description = record.description as string;
  }
  if (skills !== undefined) {
    manifest.skills = skills;
  }
  if (mcpServers !== undefined) {
    manifest.mcpServers = mcpServers;
  }
  if (secrets !== undefined) {
    manifest.secrets = secrets;
  }

  return { ok: true, manifest };
}

/** Parse + validate, throwing on invalid. Used by install pipeline. */
export function parsePluginManifest(raw: unknown): PluginManifest {
  const result = tryValidatePluginManifest(raw);
  if (!result.ok) {
    const messages = result.issues.map((i) => `${i.path}: ${i.message}`).join('; ');
    throw new Error(`Invalid plugin manifest: ${messages}`);
  }
  return result.manifest;
}

function validateRelativePath(path: string): string | null {
  if (path.startsWith('/')) {
    return 'skill path must be relative, not absolute';
  }
  if (path.includes('..')) {
    return 'skill path must not contain ".." (path traversal)';
  }
  if (path.startsWith('~')) {
    return 'skill path must not start with "~"';
  }
  return null;
}

type McpServerValidation =
  | { ok: true; config: PluginMcpServerConfig }
  | { ok: false; issues: ManifestIssue[] };

function validateMcpServer(value: unknown, basePath: string): McpServerValidation {
  const issues: ManifestIssue[] = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, issues: [{ path: basePath, message: 'server config must be an object' }] };
  }
  const record = value as Record<string, unknown>;

  for (const key of Object.keys(record)) {
    if (!ALLOWED_MCP_SERVER_KEYS.has(key)) {
      issues.push({ path: `${basePath}.${key}`, message: `unknown key "${key}"` });
    }
  }

  if (typeof record.command !== 'string' || !record.command.trim()) {
    issues.push({ path: `${basePath}.command`, message: 'command must be a non-empty string' });
  }

  let args: string[] | undefined;
  if (record.args !== undefined) {
    if (!Array.isArray(record.args)) {
      issues.push({ path: `${basePath}.args`, message: 'args must be an array of strings' });
    } else {
      const validArgs: string[] = [];
      for (let i = 0; i < record.args.length; i++) {
        if (typeof record.args[i] !== 'string') {
          issues.push({ path: `${basePath}.args[${i}]`, message: 'arg must be a string' });
        } else {
          validArgs.push(record.args[i] as string);
        }
      }
      if (validArgs.length > 0) {
        args = validArgs;
      }
    }
  }

  let env: Record<string, string> | undefined;
  if (record.env !== undefined) {
    if (!record.env || typeof record.env !== 'object' || Array.isArray(record.env)) {
      issues.push({ path: `${basePath}.env`, message: 'env must be a string map' });
    } else {
      env = {};
      for (const [envKey, envValue] of Object.entries(record.env)) {
        if (typeof envValue !== 'string') {
          issues.push({ path: `${basePath}.env.${envKey}`, message: 'env value must be a string' });
        } else {
          env[envKey] = envValue;
        }
      }
      if (Object.keys(env).length === 0) {
        env = undefined;
      }
    }
  }

  let disabled: boolean | undefined;
  if (record.disabled !== undefined) {
    if (typeof record.disabled !== 'boolean') {
      issues.push({ path: `${basePath}.disabled`, message: 'disabled must be a boolean' });
    } else {
      disabled = record.disabled;
    }
  }

  let restartOnCrash: boolean | undefined;
  if (record.restartOnCrash !== undefined) {
    if (typeof record.restartOnCrash !== 'boolean') {
      issues.push({ path: `${basePath}.restartOnCrash`, message: 'restartOnCrash must be a boolean' });
    } else {
      restartOnCrash = record.restartOnCrash;
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  const config: PluginMcpServerConfig = {
    command: record.command as string,
  };
  if (args !== undefined) {
    config.args = args;
  }
  if (env !== undefined) {
    config.env = env;
  }
  if (disabled !== undefined) {
    config.disabled = disabled;
  }
  if (restartOnCrash !== undefined) {
    config.restartOnCrash = restartOnCrash;
  }

  return { ok: true, config };
}

type SecretValidation =
  | { ok: true; decl: PluginSecretDecl }
  | { ok: false; issues: ManifestIssue[] };

function validateSecretDecl(value: unknown, basePath: string): SecretValidation {
  const issues: ManifestIssue[] = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, issues: [{ path: basePath, message: 'secret declaration must be an object' }] };
  }
  const record = value as Record<string, unknown>;

  for (const key of Object.keys(record)) {
    if (!ALLOWED_SECRET_KEYS.has(key)) {
      issues.push({ path: `${basePath}.${key}`, message: `unknown key "${key}"` });
    }
  }

  if (typeof record.name !== 'string' || !record.name.trim()) {
    issues.push({ path: `${basePath}.name`, message: 'name must be a non-empty string' });
  } else if (!SECRET_NAME_PATTERN.test(record.name)) {
    issues.push({
      path: `${basePath}.name`,
      message: 'name must match ^[A-Z0-9_]+$ (env-var-safe)',
    });
  }

  if (
    record.displayName !== undefined &&
    (typeof record.displayName !== 'string' || !record.displayName.trim())
  ) {
    issues.push({ path: `${basePath}.displayName`, message: 'displayName must be a non-empty string if present' });
  }

  if (
    record.description !== undefined &&
    (typeof record.description !== 'string' || !record.description.trim())
  ) {
    issues.push({ path: `${basePath}.description`, message: 'description must be a non-empty string if present' });
  }

  if (record.required !== undefined && typeof record.required !== 'boolean') {
    issues.push({ path: `${basePath}.required`, message: 'required must be a boolean' });
  }

  if (
    record.defaultEnv !== undefined &&
    (typeof record.defaultEnv !== 'string' || !record.defaultEnv.trim())
  ) {
    issues.push({ path: `${basePath}.defaultEnv`, message: 'defaultEnv must be a non-empty string if present' });
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  const decl: PluginSecretDecl = {
    name: record.name as string,
  };
  if (typeof record.displayName === 'string') {
    decl.displayName = record.displayName;
  }
  if (typeof record.description === 'string') {
    decl.description = record.description;
  }
  if (typeof record.required === 'boolean') {
    decl.required = record.required;
  }
  if (typeof record.defaultEnv === 'string') {
    decl.defaultEnv = record.defaultEnv;
  }

  return { ok: true, decl };
}
