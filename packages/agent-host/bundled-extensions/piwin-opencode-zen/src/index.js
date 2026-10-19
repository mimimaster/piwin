/** OpenCode Zen provider. Derived from ZhiAo1120/pi-opencode-zen (MIT). */
import { streamZen } from './zen-stream.js';
import { ZEN_API, ZEN_BASE_URL } from './zen-request.js';
import { discoverZenModels } from './zen-catalog.js';

/** @param {Pick<import('@earendil-works/pi-coding-agent').ExtensionAPI, 'registerProvider'>} pi */
export default function registerZen(pi) {
  pi.registerProvider('opencode-zen', {
    baseUrl: ZEN_BASE_URL, apiKey: 'public', api: ZEN_API, streamSimple: streamZen,
    models: [],
    async refreshModels(context) {
      // Session runtimes share only previously fetched results, never a bundled seed.
      if (!context.allowNetwork) return context.stored?.models.filter((model) =>
        model.provider === 'opencode-zen' && model.api === ZEN_API && model.baseUrl === ZEN_BASE_URL) ?? [];
      /** @type {import('./zen-catalog.js').ZenCatalogModel[]} */
      let models = [];
      try {
        models = await discoverZenModels({ signal: context.signal });
      } catch (error) {
        console.warn('[piwin-opencode-zen] model discovery failed; publishing an empty catalog', error);
      }
      // A failed check explicitly replaces success, including the offline session snapshot.
      await context.publish({ persist: { models: models.map((model) => ({
        ...model, provider: 'opencode-zen', api: ZEN_API, baseUrl: ZEN_BASE_URL,
      })), checkedAt: Date.now() } });
      return models;
    },
  });
}
