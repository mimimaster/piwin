/**
 * Per-render plan for the segment layer of one turn's open 已工作 fold:
 * which segments are in the window, which are open, and where each segment's
 * block lands in the turn's row list.
 */
import type { ReactElement } from 'react';
import type { TurnWorkDisclosureProjection } from './turn-work-disclosure-model.js';
import {
  buildTurnWorkSegments,
  indexSegmentsByItem,
  resolveSegmentDefaultOpen,
  type TurnWorkSegment,
} from './turn-work-segments.js';
import type { TranscriptTurn } from './transcript-turns.js';

/** Segment headers mounted before "显示更早的 N 段". */
export const TURN_WORK_SEGMENT_WINDOW = 40;

export type TurnWorkSegmentSlot = {
  /** Index in the turn's rendered row list reserved for the segment block. */
  at: number;
  /** The segment's narration: rendered whether the segment is open or not. */
  prose: ReactElement[];
  /** The segment's tool rows: built only while it is open. */
  rows: ReactElement[];
};

export type TurnWorkSegmentPlan = {
  segments: readonly TurnWorkSegment[];
  byItem: ReadonlyMap<number, TurnWorkSegment>;
  /** Older segments left out of the window. */
  hiddenCount: number;
  isVisible: (segment: TurnWorkSegment) => boolean;
  isOpen: (segment: TurnWorkSegment) => boolean;
  /** Filled while the turn's rows are built; one entry per visible segment. */
  slots: Map<string, TurnWorkSegmentSlot>;
};

export type PlanTurnWorkSegmentsInput = {
  turn: TranscriptTurn;
  projection: TurnWorkDisclosureProjection;
  /** 总是展开 / 详细: every segment starts open. */
  expandAll: boolean;
  /** Headers to mount, newest first; grows with "显示更早". */
  windowSize: number;
  /** Reader overrides by segment id. */
  openOverrides: Readonly<Record<string, boolean>>;
};

export function planTurnWorkSegments(input: PlanTurnWorkSegmentsInput): TurnWorkSegmentPlan {
  const segments = buildTurnWorkSegments(
    input.turn,
    input.projection.startIndex,
    input.projection.endIndex,
  );
  const hiddenCount = Math.max(0, segments.length - Math.max(1, input.windowSize));
  const lastOrdinal = segments.length;
  return {
    segments,
    byItem: indexSegmentsByItem(segments),
    hiddenCount,
    isVisible: (segment) => segment.ordinal > hiddenCount,
    isOpen: (segment) =>
      input.openOverrides[segment.id] ??
      resolveSegmentDefaultOpen(segment, {
        isLast: segment.ordinal === lastOrdinal,
        expandAll: input.expandAll,
      }),
    slots: new Map(),
  };
}
