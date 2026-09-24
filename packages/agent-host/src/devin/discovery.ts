import { gunzipSync } from 'node:zlib';
import type { Api, Model } from '@earendil-works/pi-ai';
import {
  DEVIN_API,
  DEVIN_HOST,
  DEVIN_PROVIDER_ID,
  buildUserJwtRequest,
  fields,
} from './protocol.js';

const DISCOVERY_PATH = '/exa.api_server_pb.ApiServerService/GetCliModelConfigs';
export const DEFAULT_CONTEXT_WINDOW = 200_000;
export const DEFAULT_MAX_TOKENS = 64_000;
const REASONING_LABEL = /think|thinking|minimal|high|medium|low|xhigh|max|reasoning/i;
const NO_REASONING_LABEL = /\bno thinking\b/i;

export const DEVIN_FALLBACK_MODELS: Model<Api>[] = [
  {
    id: 'swe-1-7',
    name: 'SWE-1.7',
    api: DEVIN_API,
    provider: DEVIN_PROVIDER_ID,
    baseUrl: DEVIN_HOST,
    reasoning: true,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: DEFAULT_MAX_TOKENS,
  },
  {
    id: 'swe-1-6',
    name: 'SWE-1.6',
    api: DEVIN_API,
    provider: DEVIN_PROVIDER_ID,
    baseUrl: DEVIN_HOST,
    reasoning: true,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: DEFAULT_MAX_TOKENS,
  },
];

export async function discoverDevinModels(
  apiKey: string,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<Model<Api>[]> {
  const timeout = AbortSignal.timeout(5_000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await fetchImpl(`${DEVIN_HOST}${DISCOVERY_PATH}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/proto',
      'connect-protocol-version': '1',
      accept: '*/*',
    },
    body: new Uint8Array(buildUserJwtRequest(apiKey)),
    signal: combined,
  });
  if (!response.ok) {
    throw new Error(`Devin model discovery failed: ${response.status}`);
  }
  return decodeDiscoveredDevinModels(Buffer.from(await response.arrayBuffer()));
}

export function decodeDiscoveredDevinModels(payload: Uint8Array): Model<Api>[] {
  const bytes = Buffer.from(payload);
  try {
    return decodeConfigs(bytes);
  } catch {
    try {
      return decodeConfigs(gunzipSync(bytes));
    } catch {
      return [];
    }
  }
}

function decodeConfigs(bytes: Buffer): Model<Api>[] {
  return normalizeConfigs(
    fields(bytes)
      .filter((field) => field.number === 1 && field.wire === 2)
      .map((field) => (Buffer.isBuffer(field.value) ? field.value : Buffer.alloc(0))),
  );
}

function normalizeConfigs(configs: Buffer[]): Model<Api>[] {
  const models = new Map<string, Model<Api>>();
  for (const config of configs) {
    const values = new Map(fields(config).map((field) => [field.number, field]));
    const id = stringValue(values.get(22)?.value).trim();
    if (!id || numberValue(values.get(4)?.value) !== 0) continue;
    const name = stringValue(values.get(1)?.value).trim() || id;
    const contextWindow = numberValue(values.get(18)?.value) || DEFAULT_CONTEXT_WINDOW;
    models.set(id, {
      id,
      name,
      api: DEVIN_API,
      provider: DEVIN_PROVIDER_ID,
      baseUrl: DEVIN_HOST,
      reasoning: !NO_REASONING_LABEL.test(name) && REASONING_LABEL.test(name),
      input: numberValue(values.get(5)?.value) ? ['text', 'image'] : ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow,
      maxTokens: Math.min(contextWindow, DEFAULT_MAX_TOKENS),
    });
  }
  return [...models.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function stringValue(value: Buffer | bigint | undefined): string {
  return Buffer.isBuffer(value) ? value.toString('utf8') : '';
}

function numberValue(value: Buffer | bigint | undefined): number {
  return typeof value === 'bigint' ? Number(value) : 0;
}
