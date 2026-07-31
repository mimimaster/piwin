/**
 * Speech bubble that floats above the pet sprite, showing a rotating phrase
 * describing what the agent is currently doing ("Running read_file…",
 * "规划下一步", etc.).
 *
 * Phrase generation reuses the existing run-activity-strings layer so the
 * wording stays consistent with the chat placeholder splash. The bubble
 * hides entirely when the pet is idle.
 */
import { useEffect, useMemo, useState } from 'react';
import type { PetRuntimeSnapshot } from '@piwin/contracts';
import { buildActivityPhrases } from '../run-activity-strings.js';
import { petToActivityInput } from '../pet-activity-mapper.js';
import './pet-bubble.css';

export type PetBubbleProps = {
  pet: PetRuntimeSnapshot;
  /** Locale for phrase generation; defaults to zh-CN. */
  locale?: 'zh-CN' | 'en';
};

const CYCLE_INTERVAL_MS = 2000;

export function PetBubble({ pet, locale = 'zh-CN' }: PetBubbleProps) {
  const input = useMemo(() => petToActivityInput(pet, locale), [pet, locale]);

  const phrases = useMemo(() => {
    if (!input) return [] as string[];
    return buildActivityPhrases(input);
  }, [input, locale]);

  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
  }, [phrases]);

  useEffect(() => {
    if (phrases.length <= 1) return;
    const id = window.setInterval(
      () => setIndex((i) => (i + 1) % phrases.length),
      CYCLE_INTERVAL_MS,
    );
    return () => window.clearInterval(id);
  }, [phrases]);

  if (!input || phrases.length === 0) return null;

  return (
    <div className="pet-bubble" role="status" aria-live="polite">
      <span className="pet-bubble-text">{phrases[index] ?? phrases[0]}</span>
    </div>
  );
}
