import type { ReactElement } from 'react';
import type { ArtifactContrastMessage, ArtifactErrorMessage } from '@piwin/artifact';
import { MAX_ARTIFACT_DOCUMENT_BYTES } from '@piwin/contracts';
import { Button } from '@piwin/ui-kit';
import type { ArtifactDocumentPublication } from './artifact-document-publication.js';
import { resolveArtifactDocumentByteLimit } from './artifact-document.js';
import { artifactOverflowHintCopy } from './artifact-overflow-hint.js';
import { artifactScriptErrorCopy } from './artifact-script-error-copy.js';
import { ArtifactLayoutBadge } from './artifact-layout-badge.js';
import { ArtifactContrastBadge, type ArtifactStyleOverride } from './artifact-style-override.js';

/** Publication errors are document failures; height recovery cannot repair them. */
export function ArtifactSandboxNotices(props: {
  locale: 'zh-CN' | 'en';
  publication: ArtifactDocumentPublication;
  overflowHint: boolean;
  scriptError: ArtifactErrorMessage | null;
  contrastIssue: ArtifactContrastMessage | null;
  shatteredText: number;
  styleOverride?: ArtifactStyleOverride;
  onComposerProposal?: (payload: { text: string; label?: string }) => void;
  heightRecovery: boolean;
  retryMeasurement: () => void;
}): ReactElement | null {
  const chinese = props.locale === 'zh-CN';
  if (props.publication.error !== null) {
    const tooLarge = props.publication.error === 'too-large';
    const limitMiB = MAX_ARTIFACT_DOCUMENT_BYTES / (1024 * 1024);
    const browserCapacity = resolveArtifactDocumentByteLimit() < MAX_ARTIFACT_DOCUMENT_BYTES;
    return (
      <div className="artifact-height-recovery" data-testid="artifact-document-error" role="alert">
        <span>
          {tooLarge && browserCapacity
            ? chinese
              ? '预览仍超出浏览器可用容量，请拆分内容。'
              : 'The preview still exceeds browser capacity. Split the content.'
            : tooLarge
              ? chinese
                ? `预览内容（含图片）超过 ${limitMiB} MiB，无法加载。请减少图片或缩小内容。`
                : `Preview content, including images, exceeds ${limitMiB} MiB. Reduce the images or content.`
              : chinese
                ? '预览文档未能加载，请重试。'
                : 'The preview document could not be loaded. Please try again.'}
        </span>
        {!tooLarge ? (
          <Button size="compact" onClick={props.publication.retry}>
            {chinese ? '重新加载预览' : 'Reload preview'}
          </Button>
        ) : null}
      </div>
    );
  }
  if (props.publication.status !== 'ready') return null;
  return (
    <>
      {props.overflowHint ? (
        <p
          className="artifact-overflow-hint"
          data-testid="artifact-overflow-hint"
          role="status"
          aria-live="polite"
        >
          {artifactOverflowHintCopy(props.locale)}
        </p>
      ) : null}
      <ArtifactContrastBadge
        issue={props.contrastIssue}
        override={props.styleOverride}
        locale={props.locale}
      />
      <ArtifactLayoutBadge
        shatteredText={props.shatteredText}
        locale={props.locale}
        onComposerProposal={props.onComposerProposal}
      />
      {props.scriptError ? (
        <p
          className="artifact-script-error"
          data-testid="artifact-script-error"
          role="status"
          aria-live="polite"
        >
          {artifactScriptErrorCopy(props.scriptError, props.locale)}
        </p>
      ) : null}
      {props.heightRecovery ? (
        <div
          className="artifact-height-recovery"
          data-testid="artifact-height-recovery"
          role="status"
        >
          <span>
            {chinese
              ? '预览高度仍在恢复，内容可在框内滚动。'
              : 'Preview height is still recovering; content remains scrollable.'}
          </span>
          <Button size="compact" onClick={props.retryMeasurement}>
            {chinese ? '重新测量' : 'Measure again'}
          </Button>
        </div>
      ) : null}
    </>
  );
}
