/**
 * Built-in `code_search` config (Devin Fast Context-aligned).
 *
 * `code_search` is a first-class Host tool alongside `grep`/`read`/`bash`, not
 * a subsystem: it is registered per session under `PiwinConfig.codeSearch`.
 *
 * Contract evidence: docs/research/2026-09-19-devin-code-search-verified.md
 * Implementation plan: docs/plans/2026-09-19-builtin-code-search.md
 */
import type { ModelRef } from './host.js';

/**
 * Reasoning backend for the search subagent loop. Local command execution
 * (`rg`/`readfile`/… under the `/codebase` sandbox) is identical either way;
 * only who plans the next round changes.
 */
export type CodeSearchBackend = 'model' | 'windsurf';

/** Search rounds the subagent may run. */
export const DEFAULT_CODE_SEARCH_MAX_TURNS = 3;

/** Restricted commands allowed in one round. */
export const DEFAULT_CODE_SEARCH_MAX_COMMANDS = 8;

/** Files the subagent may return in its final answer. */
export const DEFAULT_CODE_SEARCH_MAX_RESULTS = 10;

/** Repo-map tree depth; `0` means auto. */
export const DEFAULT_CODE_SEARCH_TREE_DEPTH = 3;

/** Per-command output cap (lines). */
export const DEFAULT_CODE_SEARCH_RESULT_MAX_LINES = 50;

/** Per-line character cap. */
export const DEFAULT_CODE_SEARCH_LINE_MAX_CHARS = 250;

/** Timeout for one completion round (ms). */
export const DEFAULT_CODE_SEARCH_TIMEOUT_MS = 30_000;

/**
 * Snippets are on by default: Devin's verified tool result frames files as
 * `<file path=… total_lines=N>` with `LINE|TEXT` bodies, not path lists.
 */
export const DEFAULT_CODE_SEARCH_INCLUDE_SNIPPETS = true;

/** Default backend: an already-configured piwin model, no cloud account needed. */
export const DEFAULT_CODE_SEARCH_BACKEND: CodeSearchBackend = 'model';

/**
 * Noise paths the search subagent never walks. Shared by `rg --glob !…` and
 * the repo-map tree so both exclude the same set.
 */
export const DEFAULT_CODE_SEARCH_EXCLUDE_PATHS: readonly string[] = [
  'node_modules',
  'vendor',
  '.venv',
  'venv',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'build',
  'out',
  'target',
  '.next',
  '.nuxt',
  '.output',
  '__pycache__',
  '.cache',
  '.pytest_cache',
  '*.min.*',
  'coverage',
  '.idea',
  '.vscode',
];

/**
 * Persisted shape under `PiwinConfig.codeSearch`. Only `enabled` is always
 * written; everything else is optional and filled by
 * {@link resolveCodeSearchConfig}.
 */
export type CodeSearchConfig = {
  /** When false the tool and its pre-flight guidance never reach a session. */
  enabled: boolean;
  /** Default {@link DEFAULT_CODE_SEARCH_BACKEND}. */
  backend?: CodeSearchBackend;
  /** `backend: 'model'` — configured chat model used for the search loop. */
  model?: ModelRef;
  /**
   * `backend: 'windsurf'` — secret ref holding the Windsurf/Devin token.
   * Preferred over {@link apiKeyEnv}: raw secrets never enter config files.
   *
   * Accepted forms (type stays `string`):
   * - `keychain:<service>` — existing Host keychain lookup
   * - `oauth:<providerId>` — Host resolves from `~/.piwin/pi-agent/auth.json`
   *   (see {@link OAUTH_SECRET_REF_PREFIX}). Host-runtime may auto-fill
   *   `oauth:devin` later; this field is still required here.
   */
  apiKeyRef?: string;
  /** `backend: 'windsurf'` — env var name fallback for the token. */
  apiKeyEnv?: string;
  /** Default {@link DEFAULT_CODE_SEARCH_MAX_TURNS}. */
  maxTurns?: number;
  /** Default {@link DEFAULT_CODE_SEARCH_MAX_COMMANDS}. */
  maxCommands?: number;
  /** Default {@link DEFAULT_CODE_SEARCH_MAX_RESULTS}. */
  maxResults?: number;
  /** Default {@link DEFAULT_CODE_SEARCH_TREE_DEPTH}. */
  treeDepth?: number;
  /** Default {@link DEFAULT_CODE_SEARCH_INCLUDE_SNIPPETS}. */
  includeSnippets?: boolean;
  /** Default {@link DEFAULT_CODE_SEARCH_EXCLUDE_PATHS}. */
  excludePaths?: string[];
  /** Default {@link DEFAULT_CODE_SEARCH_RESULT_MAX_LINES}. */
  resultMaxLines?: number;
  /** Default {@link DEFAULT_CODE_SEARCH_LINE_MAX_CHARS}. */
  lineMaxChars?: number;
  /** Default {@link DEFAULT_CODE_SEARCH_TIMEOUT_MS}. */
  timeoutMs?: number;
};

/**
 * Defaulted view the executor and loop consume. Selected model / cloud
 * credentials stay optional because they depend on the active backend.
 */
export type ResolvedCodeSearchConfig = {
  enabled: boolean;
  backend: CodeSearchBackend;
  model?: ModelRef;
  apiKeyRef?: string;
  apiKeyEnv?: string;
  maxTurns: number;
  maxCommands: number;
  maxResults: number;
  treeDepth: number;
  includeSnippets: boolean;
  excludePaths: string[];
  resultMaxLines: number;
  lineMaxChars: number;
  timeoutMs: number;
};

/** Fully-populated defaults; matches `createDefaultWebConfig` style. */
export function createDefaultCodeSearchConfig(): CodeSearchConfig {
  return {
    enabled: false,
    backend: DEFAULT_CODE_SEARCH_BACKEND,
    maxTurns: DEFAULT_CODE_SEARCH_MAX_TURNS,
    maxCommands: DEFAULT_CODE_SEARCH_MAX_COMMANDS,
    maxResults: DEFAULT_CODE_SEARCH_MAX_RESULTS,
    treeDepth: DEFAULT_CODE_SEARCH_TREE_DEPTH,
    includeSnippets: DEFAULT_CODE_SEARCH_INCLUDE_SNIPPETS,
    excludePaths: [...DEFAULT_CODE_SEARCH_EXCLUDE_PATHS],
    resultMaxLines: DEFAULT_CODE_SEARCH_RESULT_MAX_LINES,
    lineMaxChars: DEFAULT_CODE_SEARCH_LINE_MAX_CHARS,
    timeoutMs: DEFAULT_CODE_SEARCH_TIMEOUT_MS,
  };
}

/**
 * Fill defaults over a persisted (partial) config. Pure; never throws.
 *
 * `excludePaths` is copied so callers cannot mutate the shared default list.
 * A stored empty array is honored as "exclude nothing" rather than being
 * replaced by the defaults.
 */
export function resolveCodeSearchConfig(
  config?: CodeSearchConfig | undefined,
): ResolvedCodeSearchConfig {
  const defaults = createDefaultCodeSearchConfig();
  const resolved: ResolvedCodeSearchConfig = {
    enabled: config?.enabled ?? defaults.enabled,
    backend: config?.backend ?? DEFAULT_CODE_SEARCH_BACKEND,
    maxTurns: config?.maxTurns ?? DEFAULT_CODE_SEARCH_MAX_TURNS,
    maxCommands: config?.maxCommands ?? DEFAULT_CODE_SEARCH_MAX_COMMANDS,
    maxResults: config?.maxResults ?? DEFAULT_CODE_SEARCH_MAX_RESULTS,
    treeDepth: config?.treeDepth ?? DEFAULT_CODE_SEARCH_TREE_DEPTH,
    includeSnippets: config?.includeSnippets ?? DEFAULT_CODE_SEARCH_INCLUDE_SNIPPETS,
    excludePaths: [...(config?.excludePaths ?? DEFAULT_CODE_SEARCH_EXCLUDE_PATHS)],
    resultMaxLines: config?.resultMaxLines ?? DEFAULT_CODE_SEARCH_RESULT_MAX_LINES,
    lineMaxChars: config?.lineMaxChars ?? DEFAULT_CODE_SEARCH_LINE_MAX_CHARS,
    timeoutMs: config?.timeoutMs ?? DEFAULT_CODE_SEARCH_TIMEOUT_MS,
  };
  if (config?.model) {
    resolved.model = config.model;
  }
  if (config?.apiKeyRef) {
    resolved.apiKeyRef = config.apiKeyRef;
  }
  if (config?.apiKeyEnv) {
    resolved.apiKeyEnv = config.apiKeyEnv;
  }
  return resolved;
}

/**
 * Prefix for `apiKeyRef` values resolved from Pi `auth.json`, e.g. `oauth:devin`.
 * Distinct from `keychain:<service>`. Host-runtime resolves the token; contracts
 * only parse the ref.
 */
export const OAUTH_SECRET_REF_PREFIX = 'oauth:' as const;

export function isOauthSecretRef(ref: string): boolean {
  return ref.startsWith(OAUTH_SECRET_REF_PREFIX) && ref.length > OAUTH_SECRET_REF_PREFIX.length;
}

/** Provider id after `oauth:`, or `undefined` when the ref is not that form. */
export function oauthSecretRefProviderId(ref: string): string | undefined {
  if (!isOauthSecretRef(ref)) {
    return undefined;
  }
  const providerId = ref.slice(OAUTH_SECRET_REF_PREFIX.length);
  return providerId.length > 0 ? providerId : undefined;
}

/**
 * Whether the configured backend has everything it needs to run. Used by
 * Settings and the tool registration path so a half-configured feature
 * reports itself instead of failing at call time.
 *
 * Windsurf is ready only when `apiKeyRef` or `apiKeyEnv` is set. An
 * `oauth:devin` ref counts once present; empty refs stay not-ready even if a
 * later Host layer can resolve the Devin OAuth account.
 */
export function isCodeSearchBackendReady(config: ResolvedCodeSearchConfig): boolean {
  if (config.backend === 'windsurf') {
    return Boolean(config.apiKeyRef || config.apiKeyEnv);
  }
  return Boolean(config.model);
}
