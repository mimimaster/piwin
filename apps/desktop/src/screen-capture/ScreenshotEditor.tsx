/**
 * QQ-style capture editor (spec 2026-10-25 §12.6). Step 1: drag out a region
 * (a click takes the whole screen). Step 2: the toolbar appears beside the
 * region; adjust it, draw on it, then ✓ / Enter / double-click inside / a
 * click on the dimmed area outside to finish.
 * Right-click goes back to step 1, Esc leaves.
 *
 * Runs full-window on the capture overlay (macOS, Windows) and inside a
 * full-screen modal on Linux, where the OS already picked the region.
 */
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from 'react';
import type { DesktopLocale } from '../i18n/desktop-locale.js';
import { exportAnnotatedPng } from './annotation-export.js';
import {
  addAnnotationShape,
  annotationStyle,
  canUndoAnnotation,
  createAnnotationHistory,
  fitViewTransform,
  imageToViewPoint,
  imageToViewRect,
  redoAnnotation,
  undoAnnotation,
  viewToImagePoint,
  type AnnotationHistory,
  type AnnotationShape,
  type AnnotationTool,
  type ImagePoint,
  type ImageRect,
  type ImageSize,
} from './annotation-model.js';
import {
  AnnotationShapesSvg,
  MosaicLayerSvg,
  SelectionLayerSvg,
} from './annotation-shapes-svg.js';
import { AnnotationToolbar } from './annotation-toolbar.js';
import { AnnotationTextField, SelectHint, SizeBadge } from './screenshot-editor-chrome.js';
import {
  beginGesture,
  cursorForPoint,
  finishGesture,
  gestureDraft,
  gestureSelection,
  previewShape,
  selectionContains,
  updateGesture,
  type GestureContext,
  type ScreenshotGesture,
} from './screenshot-gesture.js';
import {
  moveSelection,
  placeSizeBadge,
  placeToolbar,
  type ViewBox,
} from './selection-geometry.js';
import { useScreenshotEditorKeys } from './use-screenshot-editor-keys.js';
import { useMosaicPreview, useStageMeasurement } from './use-screenshot-editor-surface.js';

export type ScreenshotEditorProps = {
  imageUrl: string;
  image: ImageSize;
  /** Region to start from; `null` starts at step 1 (pick a region). */
  initialSelection: ImageRect | null;
  locale: DesktopLocale;
  /** Tooltip for ✓, naming where the image goes. */
  doneLabel: string;
  onCancel: () => void;
  onDone: (png: Blob) => void;
  onExportFailed: (error: unknown) => void;
};

type TextDraft = { at: ImagePoint; value: string };

const TOOLBAR_GAP = 8;
const SIZE_BADGE_HEIGHT = 22;
/** Handle grab radius and freehand sampling step, in view pixels. */
const HANDLE_TOLERANCE_VIEW_PX = 8;
const STROKE_STEP_VIEW_PX = 1.5;

export function ScreenshotEditor(props: ScreenshotEditorProps): ReactElement {
  const { image, locale, onCancel, onDone, onExportFailed } = props;
  const [history, setHistory] = useState(() => createAnnotationHistory(image));
  const [selection, setSelection] = useState<ImageRect | null>(props.initialSelection);
  const [tool, setTool] = useState<AnnotationTool | null>(null);
  const [gesture, setGesture] = useState<ScreenshotGesture | null>(null);
  const [textDraft, setTextDraft] = useState<TextDraft | null>(null);
  const [hoverCursor, setHoverCursor] = useState('crosshair');
  const [exporting, setExporting] = useState(false);
  const [toolbarSize, setToolbarSize] = useState<ImageSize | null>(null);
  const { stageRef, attachStage, stageSize } = useStageMeasurement();
  const imageRef = useRef<HTMLImageElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);

  const style = useMemo(() => annotationStyle(image), [image]);
  const transform = useMemo(() => fitViewTransform(image, stageSize), [image, stageSize]);
  const context: GestureContext = {
    image,
    selection,
    tool,
    hasMarks: history.present.shapes.length > 0,
    handleTolerance: HANDLE_TOLERANCE_VIEW_PX / transform.scale,
    minStrokeDistance: STROKE_STEP_VIEW_PX / transform.scale,
  };

  const mosaicUrl = useMosaicPreview({
    wanted: tool === 'mosaic',
    imageRef,
    image,
    blockSize: style.mosaicBlockSize,
    viewScale: transform.scale,
  });

  const toImagePoint = useCallback(
    (event: { clientX: number; clientY: number }): ImagePoint => {
      const bounds = stageRef.current?.getBoundingClientRect();
      const local = bounds
        ? { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
        : { x: 0, y: 0 };
      return viewToImagePoint(local, transform);
    },
    [stageRef, transform],
  );

  /** History with any open text field folded in, computed synchronously. */
  const withCommittedText = useCallback(
    (current: AnnotationHistory): AnnotationHistory =>
      textDraft === null
        ? current
        : addAnnotationShape(current, { kind: 'text', at: textDraft.at, text: textDraft.value }),
    [textDraft],
  );

  const commitText = useCallback((): void => {
    if (textDraft === null) {
      return;
    }
    setTextDraft(null);
    setHistory(withCommittedText);
  }, [textDraft, withCommittedText]);

  const finish = useCallback((): void => {
    const element = imageRef.current;
    if (exporting || element === null || selection === null) {
      return;
    }
    const finalHistory = withCommittedText(history);
    setTextDraft(null);
    setHistory(finalHistory);
    setExporting(true);
    exportAnnotatedPng(element, finalHistory.present, selection)
      .then(onDone)
      .catch(onExportFailed)
      .finally(() => setExporting(false));
  }, [exporting, history, onDone, onExportFailed, selection, withCommittedText]);

  const backToStepOne = useCallback((): void => {
    setSelection(null);
    setTool(null);
    setTextDraft(null);
    setGesture(null);
    setHistory(createAnnotationHistory(image));
  }, [image]);

  const chooseTool = useCallback(
    (next: AnnotationTool): void => {
      if (selection === null) {
        return;
      }
      commitText();
      setTool((current) => (current === next ? null : next));
    },
    [commitText, selection],
  );

  useScreenshotEditorKeys({
    onUndo: () => setHistory(undoAnnotation),
    onRedo: () => setHistory(redoAnnotation),
    onTool: chooseTool,
    onFinish: finish,
    onEscape: onCancel,
    onNudge: (dx, dy) => {
      if (selection === null || tool !== null) return;
      setSelection(
        moveSelection(
          selection,
          { x: Math.round(dx / transform.scale), y: Math.round(dy / transform.scale) },
          image,
        ),
      );
    },
  });

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) {
      return;
    }
    if (textDraft !== null) {
      // Clicking away from the text field commits it; the next press draws.
      commitText();
      return;
    }
    const start = beginGesture(context, toImagePoint(event));
    if (start.kind === 'text') {
      event.preventDefault();
      setTextDraft({ at: start.at, value: '' });
    } else if (start.kind === 'gesture') {
      event.currentTarget.setPointerCapture(event.pointerId);
      setGesture(start.gesture);
    }
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const point = toImagePoint(event);
    if (gesture !== null) {
      setGesture(updateGesture(gesture, point, context));
      return;
    }
    const cursor = cursorForPoint(context, point);
    if (cursor !== hoverCursor) setHoverCursor(cursor);
  };

  const handlePointerUp = (): void => {
    if (gesture === null) {
      return;
    }
    const end = finishGesture(gesture, image);
    setGesture(null);
    if (end.kind === 'selection') {
      setSelection(end.selection);
    } else if (end.kind === 'finish') {
      finish();
    } else if (end.kind === 'mark') {
      setHistory((current) => addAnnotationShape(current, end.draft));
    }
  };

  const handleDoubleClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (tool !== 'text' && selectionContains(selection, toImagePoint(event))) {
      finish();
    }
  };

  const handleContextMenu = (event: ReactMouseEvent<HTMLDivElement>): void => {
    event.preventDefault();
    if (textDraft !== null) {
      setTextDraft(null);
    } else if (selection !== null && props.initialSelection === null) {
      backToStepOne();
    } else {
      onCancel();
    }
  };

  const shownSelection = gestureSelection(gesture, selection, image);
  const adjustingRegion =
    gesture !== null &&
    (gesture.kind === 'select' ||
      gesture.kind === 'move' ||
      gesture.kind === 'resize' ||
      (gesture.kind === 'outside' && shownSelection !== selection));
  const draft = previewShape(gestureDraft(gesture, image));
  const draftShapes: AnnotationShape[] = draft === null ? [] : [draft];
  const markShapes = [...history.present.shapes, ...draftShapes];
  const imageBox = {
    left: transform.offsetX,
    top: transform.offsetY,
    width: image.width * transform.scale,
    height: image.height * transform.scale,
  };
  const selectionView: ViewBox | null =
    shownSelection === null ? null : toViewBox(imageToViewRect(shownSelection, transform));
  const showToolbar = selection !== null && !adjustingRegion;

  useLayoutEffect(() => {
    const element = toolbarRef.current;
    if (!showToolbar || element === null) {
      return;
    }
    const measured = { width: element.offsetWidth, height: element.offsetHeight };
    setToolbarSize((current) =>
      current?.width === measured.width && current.height === measured.height ? current : measured,
    );
  }, [showToolbar]);

  const toolbarPosition =
    selectionView !== null && toolbarSize !== null
      ? placeToolbar(selectionView, toolbarSize, stageSize, TOOLBAR_GAP)
      : null;
  const badgePosition =
    selectionView === null ? null : placeSizeBadge(selectionView, SIZE_BADGE_HEIGHT, 4);
  const textAnchor = textDraft === null ? null : imageToViewPoint(textDraft.at, transform);
  const isZh = locale === 'zh-CN';
  const cursor = gesture?.kind === 'move' ? 'move' : hoverCursor;

  return (
    <div
      ref={attachStage}
      className="screen-capture-stage"
      data-step={selection === null ? 'select' : 'edit'}
      role="application"
      aria-label={isZh ? '截图' : 'Screenshot'}
      style={{ cursor }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => setGesture(null)}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
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
        <MosaicLayerSvg shapes={markShapes} image={image} sourceUrl={mosaicUrl} style={style} />
        <AnnotationShapesSvg shapes={markShapes} style={style} />
        <SelectionLayerSvg
          selection={shownSelection}
          image={image}
          viewScale={transform.scale}
          showHandles={tool === null && history.present.shapes.length === 0}
        />
      </svg>
      {selection === null && gesture === null ? <SelectHint locale={locale} /> : null}
      {shownSelection !== null && badgePosition !== null ? (
        <SizeBadge selection={shownSelection} position={badgePosition} />
      ) : null}
      {textDraft !== null && textAnchor !== null ? (
        <AnnotationTextField
          locale={locale}
          value={textDraft.value}
          anchor={textAnchor}
          fontSize={style.fontSize * transform.scale}
          color={style.color}
          onChange={(value) => setTextDraft({ ...textDraft, value })}
          onCommit={commitText}
          onDiscard={() => setTextDraft(null)}
        />
      ) : null}
      {showToolbar ? (
        <AnnotationToolbar
          ref={toolbarRef}
          style={{
            left: toolbarPosition?.left ?? 0,
            top: toolbarPosition?.top ?? 0,
            visibility: toolbarPosition === null ? 'hidden' : 'visible',
          }}
          locale={locale}
          tool={tool}
          onToolChange={chooseTool}
          canUndo={canUndoAnnotation(history)}
          onUndo={() => setHistory(undoAnnotation)}
          exporting={exporting}
          doneLabel={props.doneLabel}
          onCancel={onCancel}
          onDone={finish}
        />
      ) : null}
    </div>
  );
}

function toViewBox(rect: ImageRect): ViewBox {
  return { left: rect.x, top: rect.y, width: rect.width, height: rect.height };
}
