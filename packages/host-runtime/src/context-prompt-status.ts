import type { ContextManifest, ExtensionUiSurfaceUpdate } from '@piwin/contracts';
import type { SystemPromptSurfaceSummary } from './system-prompts-compile.js';

export const CONTEXT_PROMPT_META_KEY = 'meta:context-prompt';
export const CONTEXT_SYSTEM_PATH_META_KEY = 'meta:context-sys-path';
export const CONTEXT_APPEND_PATH_META_KEY = 'meta:context-app-path';

/**
 * Project compiled `ContextManifest` system-prompt paths into `meta:*`
 * Extension UI surface updates so SessionStatusPanel can display active
 * `SYSTEM.md` / `APPEND_SYSTEM.md` paths and custom presets even when `pi-purge` is off.
 */
export function buildContextPromptSurfaceUpdates(
  manifest: ContextManifest,
  systemPromptSummary?: SystemPromptSurfaceSummary,
): ExtensionUiSurfaceUpdate[] {
  const summary: {
    sysSrc?: 'project' | 'pi-native';
    appSrc?: 'project' | 'pi-native';
    agents: number;
    presetId?: string;
    presetName?: string;
    presetMode?: 'append' | 'replace';
    promptSource?: string;
    builtinMod?: boolean;
  } = {
    ...(manifest.systemPrompt !== undefined ? { sysSrc: manifest.systemPrompt.source } : {}),
    ...(manifest.appendSystemPrompt !== undefined
      ? { appSrc: manifest.appendSystemPrompt.source }
      : {}),
    agents: manifest.agentsFiles.length,
    ...(systemPromptSummary?.presetId ? { presetId: systemPromptSummary.presetId } : {}),
    ...(systemPromptSummary?.presetName ? { presetName: systemPromptSummary.presetName } : {}),
    ...(systemPromptSummary?.presetMode ? { presetMode: systemPromptSummary.presetMode } : {}),
    ...(systemPromptSummary?.sourceKind ? { promptSource: systemPromptSummary.sourceKind } : {}),
    ...(systemPromptSummary?.builtinModified ? { builtinMod: true } : {}),
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
