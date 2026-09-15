/**
 * Frozen screenshot overlay for page annotation (spec §4.3).
 * Does not take the user controller. Escape and Close discard unsaved marks.
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactElement } from 'react';
import { IconButton } from '@piwin/ui-kit';
import { IconClose } from './shell-icons';
import {
  ANNOTATION_COLORS,
  annotationClear,
  annotationPushStroke,
  annotationRedo,
  annotationUndo,
  createAnnotationState,
  drawAnnotationStrokes,
  type AnnotationPoint,
  type AnnotationState,
  type AnnotationStroke,
  type AnnotationTool,
} from './browser-annotation-state';

export type BrowserAnnotationOverlayCopy = {
  close: string;
  addToChat: string;
  undo: string;
  redo: string;
  clear: string;
  pen: string;
  line: string;
  arrow: string;
  rect: string;
  ellipse: string;
  text: string;
};

export type BrowserAnnotationOverlayProps = {
  imageSrc: string;
  copy: BrowserAnnotationOverlayCopy;
  onClose: () => void;
  onAddToChat: (file: File) => void;
};

function pointFromEvent(
  canvas: HTMLCanvasElement,
  event: PointerEvent<HTMLCanvasElement>,
): AnnotationPoint {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  };
}

export function BrowserAnnotationOverlay(props: BrowserAnnotationOverlayProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [state, setState] = useState<AnnotationState>(createAnnotationState);
  const draftRef = useRef<AnnotationStroke | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const paint = useCallback((): void => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const draft = draftRef.current;
    drawAnnotationStrokes(context, draft === null ? state.strokes : [...state.strokes, draft]);
  }, [state.strokes]);

  useEffect(() => {
    const image = new Image();
    image.onload = () => {
      imageRef.current = image;
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = image.naturalWidth || 1280;
      canvas.height = image.naturalHeight || 800;
      paint();
    };
    image.src = props.imageSrc;
  }, [props.imageSrc, paint]);

  useEffect(() => {
    paint();
  }, [paint]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') props.onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props]);

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>): void => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(event.pointerId);
    const point = pointFromEvent(canvas, event);
    const current = stateRef.current;
    if (current.tool === 'text') {
      const text = window.prompt('Text') ?? '';
      if (text.length > 0) {
        setState((previous) =>
          annotationPushStroke(previous, {
            id: crypto.randomUUID(),
            kind: 'text',
            at: point,
            text,
            color: previous.color,
          }),
        );
      }
      return;
    }
    if (current.tool === 'pen') {
      draftRef.current = {
        id: crypto.randomUUID(),
        kind: 'pen',
        points: [point],
        color: current.color,
        width: current.width,
      };
    } else {
      draftRef.current = {
        id: crypto.randomUUID(),
        kind: current.tool,
        from: point,
        to: point,
        color: current.color,
        width: current.width,
      };
    }
    paint();
  };

  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>): void => {
    const canvas = canvasRef.current;
    const draft = draftRef.current;
    if (!canvas || draft === null) return;
    const point = pointFromEvent(canvas, event);
    if (draft.kind === 'pen') {
      draft.points = [...draft.points, point];
    } else if (draft.kind !== 'text') {
      draft.to = point;
    }
    paint();
  };

  const onPointerUp = (event: PointerEvent<HTMLCanvasElement>): void => {
    const canvas = canvasRef.current;
    if (canvas?.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    const draft = draftRef.current;
    draftRef.current = null;
    if (draft === null) return;
    setState((previous) => annotationPushStroke(previous, draft));
  };

  const exportPng = (): void => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      props.onAddToChat(new File([blob], 'browser-annotation.png', { type: 'image/png' }));
      props.onClose();
    }, 'image/png');
  };

  const setTool = (tool: AnnotationTool): void => setState((previous) => ({ ...previous, tool }));

  return (
    <div className="browser-annotation-overlay" data-testid="browser-annotation-overlay">
      <canvas
        ref={canvasRef}
        className="browser-annotation-canvas"
        data-testid="browser-annotation-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      <div className="browser-annotation-toolbar" data-testid="browser-annotation-toolbar">
        {(['pen', 'line', 'arrow', 'rect', 'ellipse', 'text'] as const).map((tool) => (
          <IconButton
            key={tool}
            className={`browser-session-icon-btn${state.tool === tool ? ' active' : ''}`}
            label={props.copy[tool]}
            size={28}
            aria-pressed={state.tool === tool}
            onClick={() => setTool(tool)}
          >
            <span aria-hidden="true">{tool[0]!.toUpperCase()}</span>
          </IconButton>
        ))}
        {ANNOTATION_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            className={`browser-annotation-swatch${state.color === color ? ' active' : ''}`}
            style={{ background: color }}
            aria-label={color}
            onClick={() => setState((previous) => ({ ...previous, color }))}
          />
        ))}
        <IconButton className="browser-session-icon-btn" label={props.copy.undo} size={28} onClick={() => setState(annotationUndo)}>
          <span aria-hidden="true">U</span>
        </IconButton>
        <IconButton className="browser-session-icon-btn" label={props.copy.redo} size={28} onClick={() => setState(annotationRedo)}>
          <span aria-hidden="true">R</span>
        </IconButton>
        <IconButton className="browser-session-icon-btn" label={props.copy.clear} size={28} onClick={() => setState(annotationClear)}>
          <span aria-hidden="true">X</span>
        </IconButton>
        <IconButton className="browser-session-icon-btn" label={props.copy.addToChat} size={28} onClick={exportPng}>
          <span aria-hidden="true">+</span>
        </IconButton>
        <IconButton className="browser-session-icon-btn" label={props.copy.close} size={28} onClick={props.onClose}>
          <IconClose width={15} height={15} />
        </IconButton>
      </div>
    </div>
  );
}
