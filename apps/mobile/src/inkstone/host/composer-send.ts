import { toModelRef, type ModelRef, type ThinkingLevel } from '@piwin/contracts';
import type { InkstoneHostContextValue } from './inkstone-host-context.js';

type ConfiguredModel = InkstoneHostContextValue['host']['configuredModels'][number];

export function findSelectedModel(hostCtx: InkstoneHostContextValue): ConfiguredModel | undefined {
  const { providerId, modelId } = hostCtx.modelSelection;
  return hostCtx.host.configuredModels.find(
    (model) => model.providerId === providerId && model.modelId === modelId,
  );
}

/** The model and thinking level the slab currently shows, as a send turn. */
export function composerTurnOptions(hostCtx: InkstoneHostContextValue): {
  model?: ModelRef;
  thinkingLevel?: ThinkingLevel;
} {
  const selected = findSelectedModel(hostCtx);
  const level = hostCtx.modelSelection.thinkingLevel;
  return {
    ...(selected === undefined
      ? {}
      : {
          model: toModelRef({
            providerId: selected.providerId,
            modelId: selected.modelId,
            ...(selected.protocol === undefined ? {} : { protocol: selected.protocol }),
            ...(selected.source === undefined ? {} : { source: selected.source }),
          }),
        }),
    ...(level === undefined ? {} : { thinkingLevel: level }),
  };
}

/**
 * Send the slab's text to the active session. While a run is going the Host
 * queues it behind that run instead of starting a second one.
 */
export function sendComposerText(hostCtx: InkstoneHostContextValue): Promise<void> {
  const { host } = hostCtx;
  const running = host.activeRunId !== undefined;
  return host.handleSend(
    { text: host.composerText, ...composerTurnOptions(hostCtx) },
    undefined,
    running ? host.activeRunId : undefined,
  );
}
