/**
 * Screenshot annotation editor (spec 2026-10-25 §6): box, arrow, text, crop,
 * undo/redo. State is the pure model; this file only maps pointer and key
 * input onto it and shows the result over a scaled image.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from 'react';
import { Modal } from '@piwin/ui-kit';
import type { DesktopLocale } from '../i18n/desktop-locale.js';
import {
  ANNOTATION_FONT_FAMILY,
  ANNOTATION_FONT_WEIGHT,
  exportAnnotatedPng,
} from './annotation-export.js';
import {
  annotationStyle,
  applyAnnotationAction,
  canRedoAnnotation,
  canUndoAnnotation,
  clampPointToImage,
  createAnnotationHistory,
  fitViewTransform,
  imageToViewPoint,
  normalizeCropRect,
  rectFromPoints,
  redoAnnotation,
  undoAnnotation,
  viewToImagePoint,
  type AnnotationHistory,
  type AnnotationShape,
  type AnnotationTool,
  type ImagePoint,
  type ImageSize,
} from './annotation-model.js';
import { AnnotationShapesSvg, CropMaskSvg } from './annotation-shapes-svg.js';
import { AnnotationToolbar } from './annotation-toolbar.js';

export type AnnotationEditorProps = {
  imageUrl: string;
  image: ImageSize;
  initialTool: AnnotationTool;
  locale: DesktopLocale;
  onCancel: () => void;
  onConfirm: (png: Blob) => void;
  onExportFailed: (error: unknown) => void;
};

type Drag = { tool: Exclude<AnnotationTool, 'text'>; from: ImagePoint; to: ImagePoint };
type TextDraft = { at: ImagePoint; value: string };

const TOOL_KEYS: Record<string, AnnotationTool> = { r: 'rect', a: 'arrow', t: 'text', c: 'crop' };

export function AnnotationEditor(props: AnnotationEditorProps): ReactElement {
  const { image, locale, onCancel, onConfirm, onExportFailed } = props;
  const [history, setHistory] = useState(() => createAnnotationHistory(image));
  const [tool, setTool] = useState<AnnotationTool>(props.initialTool);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [textDraft, setTextDraft] = useState<TextDraft | null>(null);
  const [stageSize, setStageSize] = useState<ImageSize>({ width: 0, height: 0 });
  const [exporting, setExporting] = useState(false);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);

  const style = useMemo(() => annotationStyle(image), [image]);
  const transform = useMemo(() => fitViewTransform(image, stageSize), [image, stageSize]);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (stage === null) {
      return undefined;
    }
    const measure = (): void => {
      setStageSize({ width: stage.clientWidth, height: stage.clientHeight });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  const toImagePoint = useCallback(
    (event: { clientX: number; clientY: number }): ImagePoint => {
      const bounds = stageRef.current?.getBoundingClientRect();
      const local = bounds
        ? { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
        : { x: 0, y: 0 };
      return clampPointToImage(viewToImagePoint(local, transform), image);
    },
    [image, transform],
  );

  /** History with any open text field folded in, computed synchronously. */
  const withCommittedText = useCallback(
    (current: AnnotationHistory): AnnotationHistory =>
      textDraft === null
        ? current
        : applyAnnotationAction(current, {
            type: 'add-shape',
            shape: { kind: 'text', at: textDraft.at, text: textDraft.value },
          }),
    [textDraft],
  );

  const commitText = useCallback((): void => {
    if (textDraft === null) {
      return;
    }
    setTextDraft(null);
    setHistory(withCommittedText);
  }, [textDraft, withCommittedText]);

  const confirm = useCallback((): void => {
    const element = imageRef.current;
    if (exporting || element === null) {
      return;
    }
    const finalHistory = withCommittedText(history);
    setTextDraft(null);
    setHistory(finalHistory);
    setExporting(true);
    exportAnnotatedPng(element, finalHistory.present)
      .then(onConfirm)
      .catch(onExportFailed)
      .finally(() => setExporting(false));
  }, [exporting, history, onConfirm, onExportFailed, withCommittedText]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent): void => {
      // The inline text field handles its own Enter / Escape.
      if (event.target instanceof HTMLInputElement) {
        return;
      }
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && key === 'z') {
        event.preventDefault();
        event.stopPropagation();
        setHistory((current) =>
          event.shiftKey ? redoAnnotation(current) : undoAnnotation(current),
        );
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const nextTool = TOOL_KEYS[key];
      if (nextTool !== undefined) {
        event.preventDefault();
        setTool(nextTool);
      } else if (key === 'enter') {
        event.preventDefault();
        confirm();
      } else if (key === 'escape') {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, [confirm, onCancel]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) {
      return;
    }
    if (textDraft !== null) {
      // Clicking away from the text field commits it; the next click draws.
      commitText();
      return;
    }
    const point = toImagePoint(event);
    if (tool === 'text') {
      event.preventDefault();
      setTextDraft({ at: point, value: '' });
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ tool, from: point, to: point });
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (drag !== null) {
      setDrag({ ...drag, to: toImagePoint(event) });
    }
  };

  const handlePointerUp = (): void => {
    if (drag === null) {
      return;
    }
    const finished = drag;
    setDrag(null);
    setHistory((current) => {
      if (finished.tool === 'crop') {
        return applyAnnotationAction(current, {
          type: 'set-crop',
          crop: rectFromPoints(finished.from, finished.to, image),
        });
      }
      if (finished.tool === 'arrow') {
        return applyAnnotationAction(current, {
          type: 'add-shape',
          shape: { kind: 'arrow', from: finished.from, to: finished.to },
        });
      }
      return applyAnnotationAction(current, {
        type: 'add-shape',
        shape: { kind: 'rect', rect: rectFromPoints(finished.from, finished.to, image) },
      });
    });
  };

  const handleTextKey = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault();
      commitText();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setTextDraft(null);
    }
  };

  const draftShapes: AnnotationShape[] = [];
  if (drag?.tool === 'rect') {
    draftShapes.push({
      kind: 'rect',
      id: 'draft',
      rect: rectFromPoints(drag.from, drag.to, image),
    });
  } else if (drag?.tool === 'arrow') {
    draftShapes.push({ kind: 'arrow', id: 'draft', from: drag.from, to: drag.to });
  }
  const visibleCrop =
    drag?.tool === 'crop'
      ? normalizeCropRect(rectFromPoints(drag.from, drag.to, image), image)
      : history.present.crop;

  const imageBox = {
    left: transform.offsetX,
    top: transform.offsetY,
    width: image.width * transform.scale,
    height: image.height * transform.scale,
  };
  const textAnchor = textDraft === null ? null : imageToViewPoint(textDraft.at, transform);
  const isZh = locale === 'zh-CN';

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      title={isZh ? '标注截图' : 'Annotate screenshot'}
      size="calc(100vw - 48px)"
      className="screen-capture-editor"
      testId="screen-capture-editor"
      closeOnClickOutside={false}
      closeOnEscape={false}
    >
      <div
        ref={stageRef}
        className={`screen-capture-stage screen-capture-stage--${tool}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => setDrag(null)}
      >
        <img
          ref={imageRef}
          src={props.imageUrl}
          alt=""
          draggable={false}
          className="screen-capture-image"
          style={imageBox}
        />
        <svg
          className="screen-capture-overlay"
          style={imageBox}
          viewBox={`0 0 ${image.width} ${image.height}`}
          aria-hidden
        >
          <AnnotationShapesSvg shapes={history.present.shapes} style={style} />
          <AnnotationShapesSvg shapes={draftShapes} style={style} />
          {visibleCrop !== null ? <CropMaskSvg crop={visibleCrop} image={image} /> : null}
        </svg>
        {textDraft !== null && textAnchor !== null ? (
          // Inline on-canvas field, not a form control, so ui-kit TextInput does not fit.
          <input
            autoFocus
            className="screen-capture-text-input"
            value={textDraft.value}
            placeholder={isZh ? '输入文字，回车确认' : 'Type, then Enter'}
            onChange={(event) => setTextDraft({ ...textDraft, value: event.target.value })}
            onKeyDown={handleTextKey}
            onPointerDown={(event) => event.stopPropagation()}
            style={{
              left: textAnchor.x,
              top: textAnchor.y,
              fontSize: style.fontSize * transform.scale,
              fontFamily: ANNOTATION_FONT_FAMILY,
              fontWeight: ANNOTATION_FONT_WEIGHT,
              color: style.color,
            }}
          />
        ) : null}
      </div>
      <AnnotationToolbar
        locale={locale}
        tool={tool}
        onToolChange={(next) => {
          commitText();
          setTool(next);
        }}
        canUndo={canUndoAnnotation(history)}
        canRedo={canRedoAnnotation(history)}
        onUndo={() => setHistory(undoAnnotation)}
        onRedo={() => setHistory(redoAnnotation)}
        exporting={exporting}
        onCancel={onCancel}
        onConfirm={confirm}
      />
    </Modal>
  );
}
