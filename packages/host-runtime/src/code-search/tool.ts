/**
 * The `code_search` Host tool — a first-class peer of `grep`/`read`/`bash`.
 *
 * Only two parameters are model-visible, matching the verified Devin contract
 * (`docs/research/2026-09-19-devin-code-search-verified.md` §2). Everything
 * else — rounds, batch size, snippet policy, backend, model — comes from
 * `PiwinConfig.codeSearch` so the main agent cannot retune the subagent.
 *
 * Deliberate piwin restriction: the search root must sit inside the session
 * workspace. Devin accepts any absolute folder; keeping the tool inside the
 * workspace makes its read surface identical to the other workspace tools
 * instead of granting an unlimited filesystem read.
 */
import type {
  CodeSearchConfig,
  HostToolRegistration,
  ModelProviderConfig,
  ModelRef,
} from '@piwin/contracts';
import { checkSearchFolder, isInsideRoot } from './codebase-paths.js';
import {
  createModelCompletionPort,
  describeCodeSearchModelProviderIssue,
} from './backends/model-backend.js';
import { createWindsurfCompletionPort } from './backends/windsurf-backend.js';
import type { CodeSearchCompletionPort } from './completion-port.js';
import { buildCodeSearchRepoMap } from './repo-map.js';
import { runCodeSearchLoop } from './search-loop.js';
import type { CodeSearchLineReader } from './result-format.js';

/**
 * Verbatim from the Devin binary, with the tool name interpolated where the
 * binary leaves a gap. The trailing parallelism rule is Devin's own wording.
 */
export const CODE_SEARCH_TOOL_DESCRIPTION =
  "A search subagent the user refers to as 'Fast Context' that is ideal for exploring the codebase based on a request. This tool invokes a subagent that runs parallel grep and readfile calls over multiple turns to locate line ranges and files which might be relevant to the request. The search term should be a targeted natural language query based on what you are trying to accomplish, like 'Find where authentication requests are handled in the Express routes' or 'Fix the bug where the user gets redirected from the /feed page'. Fill out extra details that you as a smart model can infer in the question if necessary. Prefer English for semantic matching; add local-language business terms when useful. You should always use this tool to start your search when the task requires exploring the codebase and does not already name a single file or function. Note: The files and line ranges returned by this tool may be some of the ones needed to complete the user's request, but you should be careful in evaluating the relevance of the results, since the subagent might make mistakes. You should consider using classical search tools (grep/glob/read) afterwards to locate the rest if necessary. IMPORTANT: YOU CANNOT CALL THIS TOOL IN PARALLEL.";

export type CodeSearchModelTarget = {
  provider: ModelProviderConfig;
  modelId: string;
};

export type BuildCodeSearchToolOptions = {
  /** Session working directory: the outer bound of what may be searched. */
  cwd: string;
  config: CodeSearchConfig | undefined;
  /** Resolve `config.model` against the session's configured providers. */
  /** Look up a Models-page row. Omit `ref` to use the configured default. */
  resolveModel?: (ref?: ModelRef) => CodeSearchModelTarget | undefined;
  /** Injected port for tests; otherwise built from the configured backend. */
  completionPort?: CodeSearchCompletionPort;
  readLines?: CodeSearchLineReader;
  readSecretByRef?: (ref: string) => Promise<string | null>;
  fetch?: typeof globalThis.fetch;
  env?: NodeJS.ProcessEnv;
  piwinRoot?: string;
};

/** Status of the configured backend, used for diagnostics and the tool gate. */
export type CodeSearchReadiness =
  | { ready: true; port: CodeSearchCompletionPort }
  | { ready: false; reason: string };

/**
 * Build the completion port for the configured backend, or explain why the
 * feature cannot run. Never falls back to the other backend: the two have
 * different quota and privacy boundaries.
 */
export function resolveCodeSearchBackend(
  options: BuildCodeSearchToolOptions,
): CodeSearchReadiness {
  if (options.completionPort) {
    return { ready: true, port: options.completionPort };
  }
  const config = options.config;
  if (!config?.enabled) {
    return { ready: false, reason: 'code_search is disabled' };
  }
  if (config.backend === 'windsurf') {
    // Host-only: an empty windsurf config reuses the Devin OAuth account.
    // Explicit apiKeyRef / apiKeyEnv still win. Contracts stay strict — empty
    // refs are not-ready until this layer fills `oauth:devin`.
    const apiKeyRef = config.apiKeyRef?.trim() || undefined;
    const apiKeyEnv = config.apiKeyEnv?.trim() || undefined;
    const resolvedApiKeyRef = apiKeyRef ?? (apiKeyEnv ? undefined : 'oauth:devin');
    return {
      ready: true,
      port: createWindsurfCompletionPort({
        ...(resolvedApiKeyRef ? { apiKeyRef: resolvedApiKeyRef } : {}),
        ...(apiKeyEnv ? { apiKeyEnv } : {}),
        ...(options.readSecretByRef ? { readSecretByRef: options.readSecretByRef } : {}),
        ...(options.fetch ? { fetch: options.fetch } : {}),
        ...(options.env ? { env: options.env } : {}),
      }),
    };
  }
  const target = options.resolveModel?.(config.model);
  if (!target) {
    return {
      ready: false,
      reason: config.model
        ? `code_search model ${config.model.providerId}/${config.model.modelId} is not configured`
        : 'code_search backend is model but no chat model is configured (Settings → Models)',
    };
  }
  const providerIssue = describeCodeSearchModelProviderIssue(target.provider);
  if (providerIssue) {
    return { ready: false, reason: providerIssue };
  }
  return {
    ready: true,
    port: createModelCompletionPort(target, {
      ...(options.fetch ? { fetch: options.fetch } : {}),
      ...(options.piwinRoot !== undefined ? { piwinRoot: options.piwinRoot } : {}),
    }),
  };
}

/**
 * Build the tool registration, or `undefined` when the feature is off or its
 * backend cannot run. Returning nothing (rather than a tool that always errors)
 * keeps a half-configured feature out of the prompt entirely; the caller reports
 * the reason through composition diagnostics.
 */
export function buildCodeSearchTool(
  options: BuildCodeSearchToolOptions,
): HostToolRegistration | undefined {
  if (!options.config?.enabled) {
    return undefined;
  }
  const readiness = resolveCodeSearchBackend(options);
  if (!readiness.ready) {
    return undefined;
  }
  const port = readiness.port;
  const config = options.config;
  const root = options.cwd;

  return {
    descriptor: {
      name: 'code_search',
      description: CODE_SEARCH_TOOL_DESCRIPTION,
      parameters: {
        type: 'object',
        properties: {
          search_term: {
            type: 'string',
            description:
              'Search problem statement that this subagent is supposed to research for.',
          },
          search_folder_absolute_uri: {
            type: 'string',
            description:
              'The absolute path of the folder where the search should be performed. Must be inside the session workspace. In multi-repo workspaces pass the specific subfolder to search in.',
          },
        },
        required: ['search_term', 'search_folder_absolute_uri'],
      },
    },
    family: 'filesystem-read',
    permissionSpec: {
      action: 'filesystem:read',
      risk: 'unknown',
      rememberable: false,
      readOnly: true,
    },
    fileEffect: { kind: 'none' },
    async execute(args, signal) {
      const query = typeof args.search_term === 'string' ? args.search_term.trim() : '';
      if (!query) {
        return {
          ok: false,
          code: 'invalid-input',
          message:
            'search_term cannot be empty; pass a natural-language description of what to find',
        };
      }
      const folder = checkSearchFolder(args.search_folder_absolute_uri);
      if (!folder.ok) {
        return { ok: false, code: 'invalid-input', message: folder.message };
      }
      if (!isInsideRoot(root, folder.absolutePath)) {
        return {
          ok: false,
          code: 'invalid-input',
          message: `search_folder_absolute_uri must stay inside the session workspace: ${folder.absolutePath}`,
        };
      }

      const repoMap = await buildCodeSearchRepoMap({
        root: folder.absolutePath,
        depth: config.treeDepth ?? 0,
        excludePaths: config.excludePaths ?? [],
      });

      const outcome = await runCodeSearchLoop({
        root: folder.absolutePath,
        query,
        repoMap: repoMap.text,
        repoMapDepth: repoMap.depth,
        budget: {
          maxTurns: config.maxTurns ?? 3,
          maxCommands: config.maxCommands ?? 8,
          maxResults: config.maxResults ?? 10,
          includeSnippets: config.includeSnippets ?? true,
          lineMaxChars: config.lineMaxChars ?? 250,
          resultMaxLines: config.resultMaxLines ?? 50,
          excludePaths: config.excludePaths ?? [],
          timeoutMs: config.timeoutMs ?? 30_000,
        },
        complete: port,
        ...(options.readLines ? { readLines: options.readLines } : {}),
        signal,
      });

      if (outcome.status === 'error') {
        return {
          ok: false,
          code: outcome.message.includes('cancel') ? 'aborted' : 'execution-failed',
          message: outcome.output,
        };
      }
      return {
        ok: true,
        output: outcome.output,
        details: {
          codeSearch: {
            status: outcome.status,
            rounds: outcome.rounds,
            durationMs: outcome.durationMs,
            ...(outcome.status === 'ok' ? { fileCount: outcome.fileCount } : {}),
          },
        },
      };
    },
  };
}
