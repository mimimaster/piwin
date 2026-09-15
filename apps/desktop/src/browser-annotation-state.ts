/**
 * Annotation canvas model for the browser workbench (spec §4.3).
 * Strokes live only in the Desktop overlay — never in BrowserSession.
 */
export type AnnotationTool = 'pen' | 'line' | 'arrow' | 'rect' | 'ellipse' | 'text';

export type AnnotationPoint = { x: number; y: number };

export type AnnotationStroke =
  | { id: string; kind: 'pen'; points: AnnotationPoint[]; color: string; width: number }
  | { id: string; kind: 'line' | 'arrow'; from: AnnotationPoint; to: AnnotationPoint; color: string; width: number }
  | { id: string; kind: 'rect' | 'ellipse'; from: AnnotationPoint; to: AnnotationPoint; color: string; width: number }
  | { id: string; kind: 'text'; at: AnnotationPoint; text: string; color: string };

export type AnnotationState = {
  tool: AnnotationTool;
  color: string;
  width: number;
  strokes: AnnotationStroke[];
  undone: AnnotationStroke[];
};

export const ANNOTATION_COLORS = ['#e11d48', '#f59e0b', '#22c55e', '#3b82f6', '#111827', '#f8fafc'] as const;

export function createAnnotationState(): AnnotationState {
  return {
    tool: 'pen',
    color: ANNOTATION_COLORS[0],
    width: 3,
    strokes: [],
    undone: [],
  };
}

export function annotationPushStroke(state: AnnotationState, stroke: AnnotationStroke): AnnotationState {
  return { ...state, strokes: [...state.strokes, stroke], undone: [] };
}

export function annotationUndo(state: AnnotationState): AnnotationState {
  if (state.strokes.length === 0) return state;
  const strokes = state.strokes.slice(0, -1);
  const undone = [...state.undone, state.strokes[state.strokes.length - 1]!];
  return { ...state, strokes, undone };
}

export function annotationRedo(state: AnnotationState): AnnotationState {
  if (state.undone.length === 0) return state;
  const next = state.undone[state.undone.length - 1]!;
  return { ...state, strokes: [...state.strokes, next], undone: state.undone.slice(0, -1) };
}

export function annotationClear(state: AnnotationState): AnnotationState {
  if (state.strokes.length === 0) return state;
  return { ...state, strokes: [], undone: [] };
}

export function drawAnnotationStrokes(
  context: CanvasRenderingContext2D,
  strokes: readonly AnnotationStroke[],
): void {
  for (const stroke of strokes) {
    context.strokeStyle = stroke.color;
    context.fillStyle = stroke.color;
    context.lineWidth = stroke.kind === 'text' ? 1 : stroke.width;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    if (stroke.kind === 'pen') {
      if (stroke.points.length === 0) continue;
      context.beginPath();
      context.moveTo(stroke.points[0]!.x, stroke.points[0]!.y);
      for (const point of stroke.points.slice(1)) context.lineTo(point.x, point.y);
      context.stroke();
      continue;
    }
    if (stroke.kind === 'text') {
      context.font = '16px sans-serif';
      context.fillText(stroke.text, stroke.at.x, stroke.at.y);
      continue;
    }
    context.beginPath();
    if (stroke.kind === 'line' || stroke.kind === 'arrow') {
      context.moveTo(stroke.from.x, stroke.from.y);
      context.lineTo(stroke.to.x, stroke.to.y);
      context.stroke();
      if (stroke.kind === 'arrow') {
        const angle = Math.atan2(stroke.to.y - stroke.from.y, stroke.to.x - stroke.from.x);
        context.beginPath();
        context.moveTo(stroke.to.x, stroke.to.y);
        context.lineTo(
          stroke.to.x - 12 * Math.cos(angle - 0.4),
          stroke.to.y - 12 * Math.sin(angle - 0.4),
        );
        context.lineTo(
          stroke.to.x - 12 * Math.cos(angle + 0.4),
          stroke.to.y - 12 * Math.sin(angle + 0.4),
        );
        context.closePath();
        context.fill();
      }
      continue;
    }
    const x = Math.min(stroke.from.x, stroke.to.x);
    const y = Math.min(stroke.from.y, stroke.to.y);
    const width = Math.abs(stroke.to.x - stroke.from.x);
    const height = Math.abs(stroke.to.y - stroke.from.y);
    if (stroke.kind === 'rect') {
      context.strokeRect(x, y, width, height);
    } else {
      context.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
      context.stroke();
    }
  }
}
