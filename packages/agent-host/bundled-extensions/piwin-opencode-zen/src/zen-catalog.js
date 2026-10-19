import { ZEN_BASE_URL } from './zen-request.js';
/** @typedef {Pick<import('@earendil-works/pi-ai').Model<import('@earendil-works/pi-ai').Api>, 'id' | 'name' | 'reasoning' | 'input' | 'contextWindow' | 'maxTokens' | 'cost'>} ZenCatalogModel */
const METADATA_URL = 'https://models.dev/api.json';
const CATALOG_TIMEOUT_MS = 6_000;

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
/** @param {unknown} value @returns {value is number} */
function isPositiveInteger(value) { return typeof value === 'number' && Number.isSafeInteger(value) && value > 0; }

/** Only the intersection of live IDs and explicit, current free metadata is usable.
 * @param {unknown} live @param {unknown} metadata
 * @returns {ZenCatalogModel[]}
 */
export function parseZenModels(live, metadata) {
  if (!isRecord(live) || !Array.isArray(live.data)) throw new Error('Invalid Zen model catalog');
  if (!isRecord(metadata) || !isRecord(metadata.opencode) || !isRecord(metadata.opencode.models)) throw new Error('Invalid OpenCode model metadata');
  const provider = metadata.opencode;
  const entries = metadata.opencode.models;
  /** @type {Map<string, ZenCatalogModel>} */
  const models = new Map();
  for (const item of live.data) {
    if (!isRecord(item) || typeof item.id !== 'string' || !item.id.trim()) continue;
    const model = entries[item.id];
    if (!isRecord(model) || model.status === 'deprecated') continue;
    const transport = isRecord(model.provider) ? model.provider.npm ?? provider.npm : provider.npm;
    if (transport !== '@ai-sdk/openai-compatible') continue;
    const cost = model.cost;
    if (!isRecord(cost) || cost.input !== 0 || cost.output !== 0) continue;
    if ([cost.cache_read, cost.cache_write].some((value) => value !== undefined && value !== 0)) continue;
    const modalities = model.modalities;
    if (model.tool_call !== true || !isRecord(modalities) || !Array.isArray(modalities.input) || !modalities.input.includes('text') || !Array.isArray(modalities.output) || !modalities.output.includes('text')) continue;
    const limit = model.limit;
    if (!isRecord(limit) || !isPositiveInteger(limit.context) || !isPositiveInteger(limit.output)) continue;
    models.set(item.id, {
      id: item.id, name: typeof model.name === 'string' && model.name.trim() ? model.name : item.id,
      reasoning: model.reasoning === true,
      input: modalities.input.includes('image') ? ['text', 'image'] : ['text'],
      contextWindow: limit.context, maxTokens: limit.output,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    });
  }
  return [...models.values()].sort((left, right) => left.id.localeCompare(right.id));
}

/** @param {{ signal: AbortSignal, fetch?: typeof globalThis.fetch }} options */
export async function discoverZenModels(options) {
  options.signal.throwIfAborted();
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(CATALOG_TIMEOUT_MS)]);
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const payloads = await Promise.all([`${ZEN_BASE_URL}/models`, METADATA_URL].map(async (url) => {
    const response = await fetchImplementation(url, { signal, headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`Model catalog request failed (${response.status})`);
    return /** @type {unknown} */ (await response.json());
  }));
  return parseZenModels(payloads[0], payloads[1]);
}
