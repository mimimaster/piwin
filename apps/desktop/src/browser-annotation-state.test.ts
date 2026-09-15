import { describe, expect, it } from 'vitest';
import {
  annotationClear,
  annotationPushStroke,
  annotationRedo,
  annotationUndo,
  createAnnotationState,
} from './browser-annotation-state';

describe('annotation state', () => {
  it('undoes and redoes the last stroke', () => {
    const stroke = {
      id: '1',
      kind: 'line' as const,
      from: { x: 0, y: 0 },
      to: { x: 4, y: 4 },
      color: '#e11d48',
      width: 3,
    };
    let state = annotationPushStroke(createAnnotationState(), stroke);
    expect(state.strokes).toHaveLength(1);
    state = annotationUndo(state);
    expect(state.strokes).toHaveLength(0);
    state = annotationRedo(state);
    expect(state.strokes).toHaveLength(1);
    state = annotationClear(state);
    expect(state.strokes).toHaveLength(0);
  });
});
