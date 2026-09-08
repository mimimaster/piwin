/** Ask the transcript virtualizer to re-read mounted turn body heights. */
export const TRANSCRIPT_TURN_MEASURE_EVENT = 'piwin:transcript-turn-measure';

export type TranscriptTurnMeasureDetail = {
  element?: HTMLElement;
};

/** Fire after local expand/collapse that is invisible to turnsStructureKey. */
export function requestTranscriptTurnMeasure(element?: HTMLElement | null): void {
  if (typeof document === 'undefined') {
    return;
  }
  const detail: TranscriptTurnMeasureDetail = {};
  if (element) {
    detail.element = element;
  }
  document.dispatchEvent(new CustomEvent(TRANSCRIPT_TURN_MEASURE_EVENT, { detail }));
}
