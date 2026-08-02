/**
 * Codex-style status bubble above the pet.
 *
 * Shows a stable live status chip + work headline/detail that updates only
 * when the host activity changes — no rotating ambient phrases.
 */
import { useMemo } from 'react';
import type { PetRuntimeSnapshot } from '@piwin/contracts';
import { buildPetBubbleView } from '../pet-bubble-view.js';
import './pet-bubble.css';

export type PetBubbleProps = {
  pet: PetRuntimeSnapshot;
  /** Locale for phrase generation; defaults to zh-CN. */
  locale?: 'zh-CN' | 'en';
};

export function PetBubble({ pet, locale = 'zh-CN' }: PetBubbleProps) {
  const view = useMemo(() => buildPetBubbleView(pet, locale), [pet, locale]);

  if (!view) return null;

  return (
    <div
      className={`pet-bubble pet-bubble--${view.statusKind}`}
      role="status"
      aria-live="polite"
      data-testid="pet-bubble"
      data-status={view.statusKind}
    >
      <div className="pet-bubble-status">
        <span className="pet-bubble-pulse" aria-hidden="true" />
        <span className="pet-bubble-status-label">{view.statusLabel}</span>
      </div>
      <div className="pet-bubble-body">
        <span className="pet-bubble-text">{view.headline}</span>
        {view.detail ? (
          <span className="pet-bubble-detail" title={view.detail}>
            {view.detail}
          </span>
        ) : null}
      </div>
    </div>
  );
}
