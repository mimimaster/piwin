/**
 * Transcript launcher for `surface="canvas"` artifact fences.
 *
 * Full-width rectangular card in the conversation column (proto-01 `.art`
 * CANVAS block, not the 2-column `.arts` grid). Header is the fence title;
 * the recessed well holds the description. The canvas itself renders in the
 * inspector Canvas tab (ADR 0029). While the fence is still open the transcript
 * dumps source; once closed it folds to this launcher. The panel stream-previews
 * via auto-reveal.
 */

import type { ReactElement } from 'react';
import { Button, IconButton, IconDownload, IconPanelRight } from '@piwin/ui-kit';
import { artifactDownloadLabel, downloadArtifactSource } from './artifact-source-export.js';

export type ArtifactCanvasLauncherProps = {
  title: string;
  /** Raw model source for the optional source disclosure. */
  source: string;
  /** Raw fence language label (e.g. `artifact-html`). */
  rawLanguage: string;
  /** Open the Canvas shell with this fence as the active target. */
  onOpenCanvas: () => void;
  locale: 'zh-CN' | 'en';
};

type CanvasLauncherCopy = {
  badge: string;
  open: string;
  description: string;
  sourceSummary: string;
};

function canvasLauncherCopy(
  locale: 'zh-CN' | 'en',
  rawLanguage: string,
): CanvasLauncherCopy {
  const languageLabel = rawLanguage.trim() || 'html';
  if (locale === 'en') {
    return {
      badge: 'CANVAS',
      open: 'Open in Canvas',
      description:
        'Interactive canvas opens in the inspector Canvas tab. The transcript keeps this launcher and a source entry — the canvas itself is not embedded here.',
      sourceSummary: `${languageLabel} source`,
    };
  }
  return {
    badge: 'CANVAS',
    open: '在画布打开',
    description:
      '交互式画布在检视器「画布」页签打开。对话里不内嵌画布，只保留这条启动条与源码入口。',
    sourceSummary: `${languageLabel} 源码`,
  };
}

export function ArtifactCanvasLauncher(props: ArtifactCanvasLauncherProps): ReactElement {
  const copy = canvasLauncherCopy(props.locale, props.rawLanguage);
  const title = props.title.trim() || (props.locale === 'en' ? 'Canvas' : '画布');
  const canExportSource = props.source.trim().length > 0;
  const exportKind = props.rawLanguage.toLowerCase().includes('svg') ? 'svg' : 'html';
  const downloadLabel = artifactDownloadLabel(props.locale, exportKind);
  return (
    <div className="artifact-canvas-launcher" data-testid="artifact-canvas-launcher">
      <div className="artifact-canvas-launcher-head">
        <span className="artifact-canvas-launcher-title">{title}</span>
        <span className="artifact-canvas-launcher-badge">{copy.badge}</span>
        <div className="artifact-canvas-launcher-actions">
          <IconButton
            label={downloadLabel}
            title={downloadLabel}
            size="sm"
            className="artifact-canvas-download"
            data-testid="artifact-canvas-download-source"
            disabled={!canExportSource}
            onClick={() => {
              if (!canExportSource) return;
              downloadArtifactSource({
                source: props.source,
                title,
                kind: exportKind,
              });
            }}
          >
            <IconDownload size={14} />
          </IconButton>
          <Button
            variant="primary"
            size="compact"
            data-testid="artifact-canvas-open"
            onClick={props.onOpenCanvas}
          >
            {copy.open}
          </Button>
        </div>
      </div>
      <div className="artifact-canvas-launcher-body">
        <IconPanelRight size={16} className="artifact-canvas-launcher-icon" />
        <div className="artifact-canvas-launcher-copy">
          <p className="artifact-canvas-launcher-description">{copy.description}</p>
          <details className="artifact-canvas-launcher-source">
            <summary>{copy.sourceSummary}</summary>
            <pre className="md-code">
              <code>{props.source}</code>
            </pre>
          </details>
        </div>
      </div>
    </div>
  );
}
