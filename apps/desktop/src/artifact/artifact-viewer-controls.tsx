/**
 * Shared viewer chrome: the 32px Canvas toolbar body and the width stage.
 * The fullscreen overlay reuses both so the two surfaces behave alike.
 */
import type { ReactElement, ReactNode } from 'react';
import type { ArtifactStyle } from '@piwin/artifact';
import {
  Button,
  IconButton,
  IconCompress,
  IconDownload,
  IconExpand,
  IconEye,
  SegmentedControl,
} from '@piwin/ui-kit';
import {
  ARTIFACT_PREVIEW_THEMES,
  ARTIFACT_VIEWER_WIDTH_PX,
  artifactStyleLabel,
  artifactViewerCopy,
  artifactViewerFixedWidths,
  artifactViewerWidthPx,
  toggleArtifactViewerWidth,
  type ArtifactPreviewTheme,
  type ArtifactViewerLocale,
  type ArtifactViewerWidth,
} from './artifact-viewer-model.js';

export type ArtifactViewerToolbarProps = {
  title: string;
  style: ArtifactStyle | undefined;
  locale: ArtifactViewerLocale;
  fullscreen: boolean;
  /** Width (and fullscreen theme) presets; iOS shows fullscreen only (design §13). */
  presets: boolean;
  width: ArtifactViewerWidth;
  onWidthChange: (width: ArtifactViewerWidth) => void;
  /** Theme preview lives in the fullscreen overlay only; Canvas omits it. */
  themePreview?: {
    value: ArtifactPreviewTheme;
    onChange: (theme: ArtifactPreviewTheme) => void;
  };
  /** Omitted where the surrounding pane already has its own maximize. */
  onToggleFullscreen?: () => void;
  showingCode?: boolean;
  onToggleCode?: () => void;
  onDownload?: () => void;
  downloadLabel?: string;
  /** Kept stable for callers that predate the toolbar. */
  downloadTestId?: string;
  testIdPrefix: string;
};

export function ArtifactViewerToolbar(props: ArtifactViewerToolbarProps): ReactElement {
  const copy = artifactViewerCopy(props.locale);
  const { themePreview, onToggleFullscreen } = props;
  const surfaceLabel = props.fullscreen
    ? props.locale === 'en'
      ? 'Fullscreen'
      : '全屏'
    : props.locale === 'en'
      ? 'Canvas'
      : '画布';
  return (
    <div
      className="artifact-viewer-toolbar"
      data-testid={`${props.testIdPrefix}-toolbar`}
      role="toolbar"
      aria-label={props.title}
    >
      <div className="artifact-viewer-toolbar-title">
        <span className="artifact-viewer-toolbar-name" title={props.title}>
          {props.title}
        </span>
        <span className="artifact-viewer-toolbar-mode" data-testid={`${props.testIdPrefix}-mode`}>
          {surfaceLabel} · {artifactStyleLabel(props.style)}
        </span>
      </div>
      <div className="artifact-viewer-toolbar-actions">
        {props.presets ? (
          <div
            className="artifact-viewer-widths"
            role="group"
            aria-label={copy.widthGroup}
            data-testid={`${props.testIdPrefix}-width`}
          >
            {artifactViewerFixedWidths(props.fullscreen).map((width) => {
              const px = ARTIFACT_VIEWER_WIDTH_PX[width];
              return (
                <Button
                  key={width}
                  variant="ghost"
                  size="compact"
                  className="artifact-viewer-width"
                  title={copy.widthPreset(px)}
                  aria-pressed={props.width === width}
                  data-testid={`${props.testIdPrefix}-width-${width}`}
                  onClick={() => props.onWidthChange(toggleArtifactViewerWidth(props.width, width))}
                >
                  {px}
                </Button>
              );
            })}
          </div>
        ) : null}
        {props.presets && themePreview ? (
          <SegmentedControl
            size="xs"
            className="artifact-viewer-segment"
            testId={`${props.testIdPrefix}-theme`}
            aria-label={copy.themeGroup}
            value={themePreview.value}
            onChange={(value) => themePreview.onChange(value as ArtifactPreviewTheme)}
            data={ARTIFACT_PREVIEW_THEMES.map((theme) => ({
              value: theme,
              label: copy.theme[theme],
            }))}
          />
        ) : null}
        {onToggleFullscreen ? (
          <IconButton
            size="sm"
            className="artifact-viewer-button"
            label={props.fullscreen ? copy.exitFullscreen : copy.fullscreen}
            title={props.fullscreen ? copy.exitFullscreen : `${copy.fullscreen} — ${copy.remountNote}`}
            data-testid={`${props.testIdPrefix}-fullscreen`}
            onClick={(event) => {
              // WebKit does not focus buttons on pointer clicks. Capture the
              // opener explicitly before the overlay takes focus.
              event.currentTarget.focus();
              onToggleFullscreen();
            }}
          >
            {props.fullscreen ? <IconCompress size={14} /> : <IconExpand size={14} />}
          </IconButton>
        ) : null}
        {props.onToggleCode ? (
          <IconButton
            size="sm"
            className="artifact-viewer-button"
            label={props.showingCode ? copy.showPreview : copy.showCode}
            title={props.showingCode ? copy.showPreview : copy.showCode}
            aria-pressed={props.showingCode === true}
            data-testid={`${props.testIdPrefix}-code`}
            onClick={props.onToggleCode}
          >
            <IconEye size={14} />
          </IconButton>
        ) : null}
        {props.onDownload ? (
          <IconButton
            size="sm"
            className="artifact-viewer-button"
            label={props.downloadLabel ?? 'Download'}
            title={props.downloadLabel ?? 'Download'}
            data-testid={props.downloadTestId ?? `${props.testIdPrefix}-download`}
            onClick={props.onDownload}
          >
            <IconDownload size={14} />
          </IconButton>
        ) : null}
      </div>
    </div>
  );
}

/** Centers a fixed-width preview; the hatched gutter marks “outside the canvas”. */
export function ArtifactViewerStage(props: {
  width: ArtifactViewerWidth;
  children: ReactNode;
  testId?: string;
}): ReactElement {
  const px = artifactViewerWidthPx(props.width);
  return (
    <div
      className="artifact-viewer-stage"
      data-width={props.width}
      {...(props.testId ? { 'data-testid': props.testId } : {})}
    >
      <div
        className="artifact-viewer-stage-frame"
        style={px === undefined ? undefined : { width: `min(100%, ${px}px)` }}
      >
        {props.children}
      </div>
    </div>
  );
}
