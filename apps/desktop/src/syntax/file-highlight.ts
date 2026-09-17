import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { globalMemoryGovernor } from '../memory-governor.js';
import { getShikiTheme, normalizeLanguage, useShikiTheme } from '../syntax-highlight.js';
import { HighlightClient } from './highlight-client.js';
import { hashSource, type TokenLine } from './highlight-protocol.js';

// File previews have a separate budget from the many fences in a transcript.
export const MAX_FILE_HIGHLIGHT_CHARS = 1_048_576;
const FILE_HIGHLIGHT_TIMEOUT_MS = 30_000;
// One worker is shared across file clicks. A fresh worker re-parses Shiki and
// recompiles every grammar regex (~1s before the first color); a warm one
// tokenizes a few hundred lines in tens of milliseconds. Idle workers are
// still released so the token graph does not pin memory.
const WORKER_IDLE_MS = 120_000;
// Long files paint their first screens before the rest is tokenized. Grammar
// state only flows downward, so a prefix tokenizes exactly like the full file.
const PROGRESSIVE_MIN_LINES = 400;
const HEAD_LINES = 200;
// Reopening a recent file reuses its tokens instead of round-tripping.
const RECENT_FILE_LIMIT = 12;
const MAX_CACHED_FILE_CHARS = 256_000;

let sharedClient: HighlightClient | null = null;
let activeRequests = 0;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
const warmedLanguages = new Set<string>();
const recentFiles = new Map<string, TokenLine[]>();

function acquireClient(): HighlightClient {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  sharedClient ??= new HighlightClient({ maxInFlight: 1 });
  return sharedClient;
}

function releaseClient(): void {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  sharedClient?.dispose();
  sharedClient = null;
  warmedLanguages.clear();
}

async function runRequest<T>(work: (client: HighlightClient) => Promise<T>): Promise<T> {
  const client = acquireClient();
  activeRequests += 1;
  // Termination bounds pathological grammar work; the next request respawns.
  const timeout = setTimeout(() => {
    if (sharedClient === client) releaseClient();
  }, FILE_HIGHLIGHT_TIMEOUT_MS);
  try {
    return await work(client);
  } finally {
    clearTimeout(timeout);
    activeRequests -= 1;
    if (activeRequests === 0 && sharedClient === client) {
      idleTimer = setTimeout(releaseClient, WORKER_IDLE_MS);
    }
  }
}

function canHighlightFiles(): boolean {
  return typeof Worker !== 'undefined' && globalMemoryGovernor.getDegradationLevel() !== 'critical';
}

/**
 * Start the worker and compile `path`'s grammar ahead of a click (e.g. when a
 * file row is hovered), so the preview's first paint already has colors.
 */
export function prewarmFileHighlight(path: string): void {
  if (!canHighlightFiles()) return;
  const extension = /\.([a-zA-Z0-9]+)$/.exec(path)?.[1] ?? '';
  const language = normalizeLanguage(extension);
  if (warmedLanguages.has(language)) return;
  warmedLanguages.add(language);
  void runRequest((client) =>
    client.highlight({ code: 'const value = 1;', language, theme: getShikiTheme() }),
  ).catch(() => {
    warmedLanguages.delete(language);
  });
}

function nthLineEnd(code: string, lines: number): number {
  let index = -1;
  for (let line = 0; line < lines; line += 1) {
    index = code.indexOf('\n', index + 1);
    if (index === -1) return -1;
  }
  return index;
}

type FileHighlightResult = {
  code: string;
  language: string;
  theme: string;
  tokens: TokenLine[];
};

export function useFileHighlight(code: string, language: string): TokenLine[] | null {
  const theme = useShikiTheme();
  const pressure = useSyncExternalStore(
    globalMemoryGovernor.subscribe,
    globalMemoryGovernor.getDegradationLevel,
    () => 'normal',
  );
  const [result, setResult] = useState<FileHighlightResult | null>(null);
  const enabled = pressure !== 'critical' && code.length <= MAX_FILE_HIGHLIGHT_CHARS;
  const cacheable = code.length <= MAX_CACHED_FILE_CHARS;
  const key = useMemo(
    () => (cacheable ? `${theme}::${language}::${code.length}::${hashSource(code)}` : ''),
    [cacheable, code, language, theme],
  );
  const cached = enabled && cacheable ? recentFiles.get(key) : undefined;

  useEffect(() => {
    if (pressure === 'critical') {
      releaseClient();
      recentFiles.clear();
      setResult(null);
      return;
    }
    if (!enabled || cached || typeof Worker === 'undefined') return;
    const controller = new AbortController();
    const request = { language, theme, signal: controller.signal };
    const headEnd =
      nthLineEnd(code, PROGRESSIVE_MIN_LINES) === -1 ? -1 : nthLineEnd(code, HEAD_LINES);

    void runRequest(async (client) => {
      // The worker is single-flight, so queueing head before full paints the
      // top of the file first; the full result then replaces it.
      if (headEnd > 0) {
        void client
          .highlight({ ...request, code: code.slice(0, headEnd) })
          .then((tokens) => {
            if (controller.signal.aborted) return;
            setResult((previous) =>
              previous?.code === code &&
              previous.language === language &&
              previous.theme === theme &&
              previous.tokens.length >= tokens.length
                ? previous
                : { code, language, theme, tokens },
            );
          })
          .catch(() => undefined);
      }
      const tokens = await client.highlight({ ...request, code });
      if (controller.signal.aborted) return;
      if (cacheable) {
        recentFiles.delete(key);
        recentFiles.set(key, tokens);
        while (recentFiles.size > RECENT_FILE_LIMIT) {
          const oldest = recentFiles.keys().next().value;
          if (oldest === undefined) break;
          recentFiles.delete(oldest);
        }
      }
      setResult({ code, language, theme, tokens });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        console.warn('[file-highlight] Unable to highlight file.', error);
      }
    });
    return () => controller.abort();
  }, [cacheable, cached, code, enabled, key, language, pressure, theme]);

  if (!enabled) return null;
  if (cached) return cached;
  // A theme flip keeps the previous colors until the new tokens land, instead
  // of flashing uncolored source.
  return result?.code === code && result.language === language ? result.tokens : null;
}
