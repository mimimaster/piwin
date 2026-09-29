/**
 * `fetch` tee for native-search sub-requests. Pi adapters (OpenAI, Anthropic,
 * xAI, Azure) honour `options.fetch`; the tee hands Pi the real Response and
 * reads a clone, so both consume the same bytes. Only the last 2xx body is
 * kept because SDK retries re-issue requests.
 */

export type FetchLike = typeof globalThis.fetch;

/** Bound on buffered raw body text; larger bodies are truncated for parsing. */
export const NATIVE_SEARCH_TEE_MAX_CHARS = 4_000_000;

export type NativeSearchTee = {
  fetch: FetchLike;
  /** Body of the last successful response, or undefined when none was observed (e.g. WebSocket). */
  lastSuccessfulBody: () => Promise<string | undefined>;
};

export function createNativeSearchTee(baseFetch: FetchLike = globalThis.fetch): NativeSearchTee {
  let latest: Promise<string | undefined> | undefined;
  let sequence = 0;
  let latestSequence = 0;

  const tee: FetchLike = async (input, init) => {
    const response = await baseFetch(input, init);
    if (response.ok && response.body) {
      const mine = ++sequence;
      const reading = response
        .clone()
        .text()
        .then((text) => text.slice(0, NATIVE_SEARCH_TEE_MAX_CHARS))
        .catch(() => undefined);
      if (mine > latestSequence) {
        latestSequence = mine;
        latest = reading;
      }
    }
    return response;
  };

  return {
    fetch: tee,
    lastSuccessfulBody: async () => (latest ? await latest : undefined),
  };
}
