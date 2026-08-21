/**
 * Trust-aware permission rule file loader (ADR 0019 §2).
 *
 * Reads `permissions.json` from three layers (user global, project shared,
 * project local), validates them, and merges them with the bundled defaults.
 *
 * Security invariant: project-layer **allow** rules are only loaded when the
 * project is **trusted**. An untrusted repo cannot grant itself allow
 * permissions; its deny/ask rules still apply (a repo can only make the agent
 * *more* cautious, not less).
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type {
  PermissionRule,
  PermissionRuleSet,
  PermissionRulesFile,
} from '@piwin/contracts';
import { createEmptyRuleSet, mergeRuleSets } from '@piwin/contracts';
import { createBundledRuleSet } from './permission-defaults.js';

/** Input for {@link loadMergedPermissionRules}. */
export type LoadMergedPermissionRulesInput = {
  /** Root directory of the piwin config (`~/.piwin`); overrides `os.homedir()`. */
  piwinRoot: string;
  /** Optional project root (`<project>`); when omitted, only user-global loads. */
  projectPath?: string;
  /**
   * Whether `projectPath` is trusted. Defaults to `false` when `projectPath`
   * is set but trust is unknown — untrusted projects cannot grant allow rules.
   */
  projectTrusted?: boolean;
};

const FILE_VERSION = 1;
const USER_RULES_FILE = 'permissions.json';

export function userPermissionRulesPath(piwinRoot: string): string {
  return join(piwinRoot, USER_RULES_FILE);
}

/** Read the operator-editable user-global rules file. Missing file → empty v1. */
export async function readUserPermissionRulesFile(
  piwinRoot: string,
): Promise<PermissionRulesFile> {
  try {
    const raw = await readFile(userPermissionRulesPath(piwinRoot), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return asRulesFile(parsed) ?? { version: 1 };
  } catch (error) {
    if (isNotFound(error)) {
      return { version: 1 };
    }
    throw error;
  }
}

/** Host writes its own `permissions.json`. The shell only sends the document. */
export async function writeUserPermissionRulesFile(
  piwinRoot: string,
  rules: PermissionRulesFile,
): Promise<void> {
  if (rules.version !== FILE_VERSION) {
    throw new Error(`permissions.json version must be ${FILE_VERSION}`);
  }
  await mkdir(piwinRoot, { recursive: true });
  await writeFile(
    userPermissionRulesPath(piwinRoot),
    `${JSON.stringify(rules, null, 2)}\n`,
    'utf8',
  );
}

/**
 * Load, validate, and merge permission rules from all configured layers.
 *
 * Layer order (later layers win on evaluation only via tier order; arrays are
 * concatenated): bundled defaults → user global → project shared → project
 * local. Project shared/local `allow` arrays are dropped when the project is
 * not trusted.
 */
export async function loadMergedPermissionRules(
  input: LoadMergedPermissionRulesInput,
): Promise<PermissionRuleSet> {
  const bundled = createBundledRuleSet();
  const userGlobal = await loadLayer(join(input.piwinRoot, 'permissions.json'));

  let projectShared = createEmptyRuleSet();
  let projectLocal = createEmptyRuleSet();
  if (input.projectPath) {
    const trusted = input.projectTrusted === true;
    projectShared = await loadLayer(
      join(input.projectPath, '.piwin', 'permissions.json'),
    );
    projectLocal = await loadLayer(
      join(input.projectPath, '.piwin', 'permissions.local.json'),
    );
    if (!trusted) {
      projectShared = stripAllow(projectShared);
      projectLocal = stripAllow(projectLocal);
    }
  }

  return mergeRuleSets(bundled, userGlobal, projectShared, projectLocal);
}

/**
 * Load and validate a single `permissions.json` layer.
 *
 * Missing file → empty contribution (no warning). Invalid JSON, unknown
 * version, or malformed rules → warn and contribute only the valid subset
 * (or an empty set if the whole file is unusable).
 */
async function loadLayer(filePath: string): Promise<PermissionRuleSet> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (error) {
    if (isNotFound(error)) {
      return createEmptyRuleSet();
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn(`[permissions] invalid JSON in ${filePath}; skipping`);
    return createEmptyRuleSet();
  }

  const file = asRulesFile(parsed);
  if (!file) {
    console.warn(
      `[permissions] ${filePath} has missing or unknown version; expected version ${FILE_VERSION}; skipping`,
    );
    return createEmptyRuleSet();
  }

  return materializeRuleSet(file, filePath);
}

/**
 * Narrow an unknown parsed value to a {@link PermissionRulesFile} with the
 * expected `version: 1`. Returns `undefined` for any other shape.
 */
function asRulesFile(value: unknown): PermissionRulesFile | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (record.version !== FILE_VERSION) {
    return undefined;
  }
  return record as unknown as PermissionRulesFile;
}

/**
 * Convert a validated on-disk file into an in-memory rule set, dropping and
 * warning about any invalid rules. Expands `~` in `file-write` pathGlobs to
 * `os.homedir()` so the pure matcher only ever sees absolute patterns.
 */
function materializeRuleSet(file: PermissionRulesFile, filePath: string): PermissionRuleSet {
  const result = createEmptyRuleSet();
  const buckets: ReadonlyArray<['deny' | 'ask' | 'allow', PermissionRule[] | undefined]> = [
    ['deny', file.deny],
    ['ask', file.ask],
    ['allow', file.allow],
  ];
  for (const [bucket, rules] of buckets) {
    if (!Array.isArray(rules)) {
      continue;
    }
    for (const rule of rules) {
      const sanitized = sanitizeRule(rule, bucket, filePath);
      if (sanitized) {
        result[bucket].push(sanitized);
      }
    }
  }
  return result;
}

/**
 * Validate a single rule against its expected bucket. Returns the rule with
 * `~` expanded in `file-write` pathGlobs, or `undefined` if the rule is
 * malformed (with a warning logged to the console).
 */
function sanitizeRule(
  rule: unknown,
  bucket: 'deny' | 'ask' | 'allow',
  filePath: string,
): PermissionRule | undefined {
  if (!rule || typeof rule !== 'object') {
    console.warn(`[permissions] ${filePath}: rule in ${bucket} is not an object; dropping`);
    return undefined;
  }
  const record = rule as Record<string, unknown>;
  const target = record.target;
  if (!target || typeof target !== 'object') {
    console.warn(`[permissions] ${filePath}: rule missing target; dropping`);
    return undefined;
  }
  const targetRecord = target as Record<string, unknown>;
  if (typeof targetRecord.kind !== 'string') {
    console.warn(`[permissions] ${filePath}: rule missing target.kind; dropping`);
    return undefined;
  }
  if (record.decision !== bucket) {
    console.warn(
      `[permissions] ${filePath}: rule decision "${String(record.decision)}" !== bucket "${bucket}"; dropping`,
    );
    return undefined;
  }
  if (typeof record.reason !== 'string') {
    console.warn(`[permissions] ${filePath}: rule missing reason; dropping`);
    return undefined;
  }

  const normalized = normalizeTarget(targetRecord);
  if (!normalized) {
    console.warn(
      `[permissions] ${filePath}: rule has invalid target shape for kind "${targetRecord.kind}"; dropping`,
    );
    return undefined;
  }

  return {
    target: normalized,
    decision: bucket,
    reason: record.reason,
  };
}

/**
 * Narrow a target record into a typed {@link PermissionRuleTarget}, expanding
 * `~` in `file-write` pathGlobs. Legacy MCP targets return `undefined` because
 * MCP is configuration-trusted and no longer has a permission rule surface.
 */
function normalizeTarget(
  target: Record<string, unknown>,
): PermissionRule['target'] | undefined {
  switch (target.kind) {
    case 'bash':
    case 'git':
      if (typeof target.pattern === 'string') {
        return { kind: target.kind, pattern: target.pattern } as PermissionRule['target'];
      }
      return undefined;
    case 'file-write':
      if (typeof target.pathGlob === 'string') {
        return {
          kind: 'file-write',
          pathGlob: expandHomeDir(target.pathGlob),
        };
      }
      return undefined;
    case 'web-fetch':
      if (typeof target.hostGlob === 'string') {
        return { kind: 'web-fetch', hostGlob: target.hostGlob };
      }
      return undefined;
    case 'web-search':
      return { kind: 'web-search' };
    case 'mcp':
      // MCP is configuration-trusted and no longer has a permission rule
      // surface. Keep parsing old files tolerant, but drop legacy MCP rules.
      return undefined;
    case 'process':
      return { kind: 'process' };
    case 'notes-mutate':
      return { kind: 'notes-mutate' };
    default:
      return undefined;
  }
}

/** Expand a leading `~/` to the user's home directory. */
function expandHomeDir(pathGlob: string): string {
  if (pathGlob.startsWith('~/')) {
    return homedir() + pathGlob.slice(1);
  }
  return pathGlob;
}

/** Return a copy of `set` with the `allow` bucket emptied. */
function stripAllow(set: PermissionRuleSet): PermissionRuleSet {
  return { deny: set.deny, ask: set.ask, allow: [] };
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}
