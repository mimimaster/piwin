import { useEffect, useMemo, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { buildBasePhrases, buildTakingTooLongPhrases } from './run-activity-strings.js';
import type { RunActivityInput } from './run-activity-types.js';

const TAKING_TOO_LONG_MS = 15_000;
const CYCLE_INTERVAL_MS = 1800;

export type UseRunActivityPhrasesResult = {
  phrases: string[];
  currentPhrase: string;
  isTakingTooLong: boolean;
};

export function useRunActivityPhrases(input: RunActivityInput): UseRunActivityPhrasesResult {
  const reduced = useReducedMotion() ?? false;
  const base = useMemo(
    () => buildBasePhrases(input),
    [input.kind, input.activeToolName, input.planStep, input.locale],
  );
  const takingTooLong = useMemo(
    () => buildTakingTooLongPhrases(input),
    [input.kind, input.activeToolName, input.planStep, input.locale],
  );
  const [isTakingTooLong, setIsTakingTooLong] = useState(
    typeof input.elapsedMs === 'number' && input.elapsedMs >= TAKING_TOO_LONG_MS,
  );
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const elapsedMs = input.elapsedMs;
    const hasTimedOut =
      typeof elapsedMs === 'number' && elapsedMs >= TAKING_TOO_LONG_MS;
    setIsTakingTooLong(hasTimedOut);

    if (elapsedMs === undefined || hasTimedOut) {
      return;
    }
    const id = window.setTimeout(
      () => setIsTakingTooLong(true),
      TAKING_TOO_LONG_MS - elapsedMs,
    );
    return () => window.clearTimeout(id);
  }, [input.elapsedMs]);

  const phrases = isTakingTooLong ? takingTooLong : base;

  useEffect(() => {
    setIndex(0);
    if (reduced || phrases.length <= 1) return;
    const id = window.setInterval(() => setIndex((i) => (i + 1) % phrases.length), CYCLE_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [phrases, reduced]);

  return {
    phrases,
    currentPhrase: phrases[index] ?? phrases[0] ?? '',
    isTakingTooLong,
  };
}
