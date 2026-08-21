import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type ResolveAgentWorkerScriptOptions = {
  env?: NodeJS.ProcessEnv;
  /** Override import.meta.url so tests can point at a fixture directory. */
  importMetaUrl?: string;
};

/**
 * Worker path for standalone Host (`apps/host` / host-listen.mjs).
 * Env wins; otherwise `agent-worker.mjs` next to this entry.
 */
export function resolveAgentWorkerScript(
  options: ResolveAgentWorkerScriptOptions = {},
): string | undefined {
  const fromEnv = options.env?.PIWIN_AGENT_WORKER_SCRIPT?.trim();
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return resolve(fromEnv);
  }
  const beside = fileURLToPath(new URL('./agent-worker.mjs', options.importMetaUrl ?? import.meta.url));
  return existsSync(beside) ? beside : undefined;
}
