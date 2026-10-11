/**
 * Shared viewer chrome: the 32px Canvas toolbar body and the width stage.
 * The fullscreen overlay reuses both so the two surfaces behave alike.
 */
import type { ReactElement, ReactNode } from 'react';
import type { ArtifactStyle } from '@piwin/artifact';
import {
  IconButton,
  IconCode,
  IconCompress,
  IconDownload,
  IconExpand,
  IconEye,
  SegmentedControl,
} from '@piwin/ui-kit';
import {
  ARTIFACT_PREVIEW_THEMES,
  artifactStyleLabel,
  artifactViewerCopy,
  artifactViewerWidthPx,
  artifactViewerWidths,
  type ArtifactPreviewTheme,
  type ArtifactViewerLocale,
  type ArtifactViewerWidth,
} from './artifact-viewer-model.js';

export type ArtifactViewerToolbarProps = {
  title: string;
  style: ArtifactStyle | undefined;
  locale: ArtifactViewerLocale;
  fullscreen: boolean;
  /** Width and theme presets; iOS shows fullscreen only (design §13). */
  presets: boolean;
  width: ArtifactViewerWidth;
  onWidthChange: (width: ArtifactViewerWidth) => void;
  previewTheme: ArtifactPreviewTheme;
  onPreviewThemeChange: (theme: ArtifactPreviewTheme) => void;
  onToggleFullscreen: () => void;
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
          <>
            <SegmentedControl
              size="xs"
              className="artifact-viewer-segment"
              testId={`${props.testIdPrefix}-width`}
              aria-label={copy.widthGroup}
              value={props.width}
              onChange={(value) => props.onWidthChange(value as ArtifactViewerWidth)}
              data={artifactViewerWidths(props.fullscreen).map((width) => ({
                value: width,
                label: copy.width[width],
              }))}
            />
            <SegmentedControl
              size="xs"
              className="artifact-viewer-segment"
              testId={`${props.testIdPrefix}-theme`}
              aria-label={copy.themeGroup}
              value={props.previewTheme}
              onChange={(value) => props.onPreviewThemeChange(value as ArtifactPreviewTheme)}
              data={ARTIFACT_PREVIEW_THEMES.map((theme) => ({
                value: theme,
                label: copy.theme[theme],
              }))}
            />
          </>
        ) : null}
        <IconButton
          size="sm"
          className="artifact-viewer-button"
          label={props.fullscreen ? copy.exitFullscreen : copy.fullscreen}
          title={props.fullscreen ? copy.exitFullscreen : `${copy.fullscreen} — ${copy.remountNote}`}
          data-testid={`${props.testIdPrefix}-fullscreen`}
          onClick={props.onToggleFullscreen}
        >
          {props.fullscreen ? <IconCompress size={14} /> : <IconExpand size={14} />}
        </IconButton>
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
            {props.showingCode ? <IconEye size={14} /> : <IconCode size={14} />}
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
