import type { ContextManifest, ExtensionUiSurfaceUpdate } from '@piwin/contracts';

export const CONTEXT_PROMPT_META_KEY = 'meta:context-prompt';
export const CONTEXT_SYSTEM_PATH_META_KEY = 'meta:context-sys-path';
export const CONTEXT_APPEND_PATH_META_KEY = 'meta:context-app-path';

/**
 * Project compiled `ContextManifest` system-prompt paths into `meta:*`
 * Extension UI surface updates so SessionStatusPanel can display active
 * `SYSTEM.md` / `APPEND_SYSTEM.md` paths even when `pi-purge` is off.
 */
export function buildContextPromptSurfaceUpdates(
  manifest: ContextManifest,
): ExtensionUiSurfaceUpdate[] {
  const summary: {
    sysSrc?: 'project' | 'pi-native';
    appSrc?: 'project' | 'pi-native';
    agents: number;
  } = {
    ...(manifest.systemPrompt !== undefined ? { sysSrc: manifest.systemPrompt.source } : {}),
    ...(manifest.appendSystemPrompt !== undefined
      ? { appSrc: manifest.appendSystemPrompt.source }
      : {}),
    agents: manifest.agentsFiles.length,
  };

  const updates: ExtensionUiSurfaceUpdate[] = [
    { kind: 'status', key: CONTEXT_PROMPT_META_KEY, text: JSON.stringify(summary) },
  ];
  updates.push(
    manifest.systemPrompt !== undefined
      ? {
          kind: 'status',
          key: CONTEXT_SYSTEM_PATH_META_KEY,
          text: manifest.systemPrompt.absolutePath,
        }
      : { kind: 'status', key: CONTEXT_SYSTEM_PATH_META_KEY },
  );
  updates.push(
    manifest.appendSystemPrompt !== undefined
      ? {
          kind: 'status',
          key: CONTEXT_APPEND_PATH_META_KEY,
          text: manifest.appendSystemPrompt.absolutePath,
        }
      : { kind: 'status', key: CONTEXT_APPEND_PATH_META_KEY },
  );
  return updates;
}
