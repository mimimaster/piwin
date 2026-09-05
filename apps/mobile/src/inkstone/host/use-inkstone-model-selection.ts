import { useCallback, useEffect, useState } from 'react';
import { toModelRef, type ConfiguredChatModel, type ThinkingLevel } from '@piwin/contracts';
import {
  commitMobileComposerProfile,
  createMobileComposerProfileRequest,
} from '../../mobile-composer-profile.js';
import type { InkstoneHost, InkstoneModelSelection } from './inkstone-host-context.js';

/** Tracks the selected model/thinking level and persists it to the Host like the Deck picker. */
export function useInkstoneModelSelection(host: InkstoneHost): InkstoneModelSelection {
  const [providerId, setProviderId] = useState<string | undefined>();
  const [modelId, setModelId] = useState<string | undefined>();
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel | undefined>();

  useEffect(() => {
    if (host.configuredModels.length === 0) {
      return;
    }
    const selected = host.configuredModels.find(
      (model) => model.providerId === providerId && model.modelId === modelId,
    );
    if (selected !== undefined) {
      return;
    }
    const fallback =
      host.configuredModels.find(
        (model) =>
          model.providerId === host.defaultProviderId && model.modelId === host.defaultModelId,
      ) ?? host.configuredModels[0];
    if (fallback === undefined) {
      return;
    }
    setProviderId(fallback.providerId);
    setModelId(fallback.modelId);
    setThinkingLevel(fallback.thinkingLevel);
  }, [host, providerId, modelId]);

  const commit = useCallback(
    async (model: ConfiguredChatModel | undefined, level: ThinkingLevel | undefined) => {
      const client = host.client;
      const result = await commitMobileComposerProfile({
        request: createMobileComposerProfileRequest(
          client === undefined ? undefined : (command) => client.request(command),
        ),
        sessionId: host.activeSessionId,
        ...(model === undefined
          ? {}
          : {
              model: toModelRef({
                providerId: model.providerId,
                modelId: model.modelId,
                ...(model.protocol !== undefined ? { protocol: model.protocol } : {}),
                ...(model.source !== undefined ? { source: model.source } : {}),
              }),
            }),
        ...(level === undefined ? {} : { thinkingLevel: level }),
      });
      if (!result.ok) {
        host.setErrorMessage(result.error);
      }
    },
    [host],
  );

  const select = useCallback(
    (nextProviderId: string | undefined, nextModelId: string | undefined) => {
      const next = host.configuredModels.find(
        (model) => model.providerId === nextProviderId && model.modelId === nextModelId,
      );
      if (next === undefined) {
        return;
      }
      setProviderId(next.providerId);
      setModelId(next.modelId);
      setThinkingLevel(next.thinkingLevel);
      void commit(next, next.thinkingLevel);
    },
    [commit, host.configuredModels],
  );

  const selectThinking = useCallback(
    (level: ThinkingLevel) => {
      setThinkingLevel(level);
      if (providerId !== undefined && modelId !== undefined) {
        void commit(
          host.configuredModels.find(
            (model) => model.providerId === providerId && model.modelId === modelId,
          ),
          level,
        );
      }
    },
    [commit, host.configuredModels, modelId, providerId],
  );

  return { providerId, modelId, thinkingLevel, select, selectThinking };
}
