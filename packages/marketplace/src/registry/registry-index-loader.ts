/**
 * Fetch and cache the extension registry index. One loader per Host keeps
 * repeated searches from refetching Pages on every keystroke.
 */
import type { ExtensionRegistryIndex } from '@piwin/contracts';
import { parseRegistryIndex } from './parse-registry-index.js';

export type RegistryIndexLoaderOptions = {
  url: string;
  fetch?: typeof fetch;
  /** Cache lifetime of a successful load. Default 5 minutes. */
  ttlMs?: number;
  now?: () => number;
  /** Receives dropped-entry diagnostics; the Host logs them. */
  onDiagnostics?: (diagnostics: string[]) => void;
};

export type RegistryIndexLoader = {
  readonly url: string;
  load(signal?: AbortSignal): Promise<ExtensionRegistryIndex>;
};

const DEFAULT_TTL_MS = 5 * 60_000;
/** The index is a small JSON document; anything larger is not ours. */
const MAX_INDEX_BYTES = 5 * 1024 * 1024;

export function createRegistryIndexLoader(options: RegistryIndexLoaderOptions): RegistryIndexLoader {
  const fetchIndex = options.fetch ?? fetch;
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const now = options.now ?? Date.now;
  let cached: { index: ExtensionRegistryIndex; loadedAt: number } | undefined;
  let inflight: Promise<ExtensionRegistryIndex> | undefined;

  async function fetchAndParse(signal?: AbortSignal): Promise<ExtensionRegistryIndex> {
    const response = await fetchIndex(options.url, {
      headers: { accept: 'application/json' },
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) {
      throw new Error(`extension registry fetch failed: HTTP ${response.status}`);
    }
    const text = await response.text();
    if (text.length > MAX_INDEX_BYTES) {
      throw new Error('extension registry index is larger than 5 MB');
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new Error('extension registry index is not valid JSON');
    }
    const parsed = parseRegistryIndex(raw);
    if (parsed.diagnostics.length > 0) options.onDiagnostics?.(parsed.diagnostics);
    cached = { index: parsed.index, loadedAt: now() };
    return parsed.index;
  }

  return {
    url: options.url,
    load(signal) {
      if (cached && now() - cached.loadedAt < ttlMs) return Promise.resolve(cached.index);
      inflight ??= fetchAndParse(signal).finally(() => {
        inflight = undefined;
      });
      return inflight;
    },
  };
}
