/**
 * Fullscreen artifact viewer (design.md §7.2): a fixed overlay portaled into
 * the main window, not an OS fullscreen window and not a pop-out. The frame
 * remounts in Canvas mode, so in-artifact state is not carried over. Esc or the
 * exit button closes it and focus returns to whatever opened it.
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import {
  materializeArtifact,
  type ArtifactRenderIntent,
  type ArtifactThemeVariables,
} from '@piwin/artifact';
import { ArtifactFrame } from './ArtifactFrame.js';
import { ArtifactViewerStage, ArtifactViewerToolbar } from './artifact-viewer-controls.js';
import {
  nextArtifactPreviewTheme,
  resolveArtifactPreviewTheme,
  resolveArtifactViewerKey,
  withArtifactViewerChannel,
  type ArtifactPreviewTheme,
  type ArtifactViewerLocale,
  type ArtifactViewerWidth,
} from './artifact-viewer-model.js';

export type ArtifactFullscreenOverlayProps = {
  intent: ArtifactRenderIntent;
  source: string;
  locale: ArtifactViewerLocale;
  hostTheme?: ArtifactThemeVariables;
  mediaDataUrls?: ReadonlyMap<string, string>;
  presets: boolean;
  initialWidth?: ArtifactViewerWidth;
  onClose: () => void;
};

export function ArtifactFullscreenOverlay(props: ArtifactFullscreenOverlayProps): ReactElement | null {
  const [width, setWidth] = useState<ArtifactViewerWidth>(props.initialWidth ?? 'fit');
  const [previewTheme, setPreviewTheme] = useState<ArtifactPreviewTheme>('follow');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const onClose = props.onClose;

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    rootRef.current?.focus();
    return () => {
      opener?.focus();
    };
  }, []);

  useEffect(() => {
    // Esc must always exit, even with focus on the document body.
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const theme = resolveArtifactPreviewTheme(previewTheme, props.hostTheme);
  const intent = useMemo(() => withArtifactViewerChannel(props.intent, 'fullscreen'), [props.intent]);
  const plan = useMemo(
    () =>
      materializeArtifact(intent, {
        mode: 'interactive',
        source: props.source,
        presentation: 'canvas',
        ...(props.mediaDataUrls ? { mediaDataUrls: props.mediaDataUrls } : {}),
        ...(theme ? { theme } : {}),
      }),
    [intent, props.source, props.mediaDataUrls, theme],
  );

  if (typeof document === 'undefined') return null;
  const descriptor = props.intent.descriptor;
  return createPortal(
    <div
      ref={rootRef}
      className="artifact-fullscreen-overlay"
      data-testid="artifact-fullscreen-overlay"
      data-preview-theme={previewTheme}
      role="dialog"
      aria-modal="true"
      aria-label={descriptor.title}
      tabIndex={-1}
      onKeyDown={(event) => {
        const action = resolveArtifactViewerKey(event.nativeEvent, {
          surface: 'fullscreen',
          presets: props.presets,
        });
        if (!action) return;
        event.preventDefault();
        if (action.kind === 'exit-fullscreen' || action.kind === 'toggle-fullscreen') onClose();
        else if (action.kind === 'width') setWidth(action.width);
        else if (action.kind === 'cycle-theme') setPreviewTheme(nextArtifactPreviewTheme);
      }}
    >
      <ArtifactViewerToolbar
        title={descriptor.title}
        style={descriptor.style}
        locale={props.locale}
        fullscreen
        presets={props.presets}
        width={width}
        onWidthChange={setWidth}
        themePreview={{ value: previewTheme, onChange: setPreviewTheme }}
        onToggleFullscreen={onClose}
        testIdPrefix="artifact-fullscreen"
      />
      <ArtifactViewerStage width={width} testId="artifact-fullscreen-stage">
        {plan.kind === 'render' || plan.kind === 'blocked' ? (
          <ArtifactFrame
            key={`fullscreen:${previewTheme}:${descriptor.id}`}
            plan={plan}
            presentation="canvas"
            locale={props.locale}
            initPriority={0}
          />
        ) : null}
      </ArtifactViewerStage>
    </div>,
    document.body,
  );
}
