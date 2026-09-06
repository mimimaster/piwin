import { useEffect, useState, useSyncExternalStore } from 'react';
import { globalMemoryGovernor } from '../memory-governor.js';
import { useShikiTheme } from '../syntax-highlight.js';
import { HighlightClient } from './highlight-client.js';
import type { TokenLine } from './highlight-protocol.js';

// File previews have a separate budget from the many fences in a transcript.
export const MAX_FILE_HIGHLIGHT_CHARS = 1_048_576;
const FILE_HIGHLIGHT_TIMEOUT_MS = 30_000;

export function useFileHighlight(code: string, language: string): TokenLine[] | null {
  const theme = useShikiTheme();
  const pressure = useSyncExternalStore(
    globalMemoryGovernor.subscribe,
    globalMemoryGovernor.getDegradationLevel,
    () => 'normal',
  );
  const [result, setResult] = useState<{
    code: string;
    language: string;
    tokens: TokenLine[];
  } | null>(null);
  const enabled = pressure !== 'critical' && code.length <= MAX_FILE_HIGHLIGHT_CHARS;

  useEffect(() => {
    setResult(null);
    if (!enabled || typeof Worker === 'undefined') return;
    const client = new HighlightClient({ maxInFlight: 1 });
    let cancelled = false;
    // Termination also bounds pathological grammar work and releases the
    // worker's full token graph after transferring the compact result.
    const timeout = setTimeout(() => client.dispose(), FILE_HIGHLIGHT_TIMEOUT_MS);
    void client
      .highlight({ code, language, theme })
      .then((tokens) => {
        if (!cancelled) setResult({ code, language, tokens });
      })
      .catch((error: unknown) => {
        if (!cancelled) console.warn('[file-highlight] Unable to highlight file.', error);
      })
      .finally(() => {
        clearTimeout(timeout);
        client.dispose();
      });
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      client.dispose();
    };
  }, [code, enabled, language, theme]);

  return enabled && result?.code === code && result.language === language ? result.tokens : null;
}
