/**
 * Walkthrough card (spec §5.3): renders the artifact state below the owning
 * Assistant message. Markdown is source-only — Artifact iframe preview is
 * always disabled (§5.3, §16.8).
 */
import type { ReactElement } from 'react';
import type { WalkthroughArtifact } from '@piwin/contracts';
import { MarkdownView } from './MarkdownView';

export type WalkthroughCardProps = {
  artifact: WalkthroughArtifact;
  messageId: string;
  /** Locale for user-facing strings (defaults to English when omitted). */
  locale?: 'zh-CN' | 'en';
  onOpenDocument?: ((doc: { title: string; path?: string; content?: string }) => void) | undefined;
  onRegenerate?: (() => void) | undefined;
  onCancel?: ((messageId: string, generationId?: string) => void | Promise<void>) | undefined;
};

function modeLabel(mode: 'default' | 'custom'): string {
  return mode === 'custom' ? 'Custom' : 'Default';
}

function modelLabel(artifact: WalkthroughArtifact): string {
  if (artifact.status === 'ready' && artifact.model) {
    return `${artifact.model.providerId}/${artifact.model.modelId}`;
  }
  if (artifact.model) {
    return `${artifact.model.providerId}/${artifact.model.modelId}`;
  }
  return '—';
}

export function WalkthroughCard(props: WalkthroughCardProps): ReactElement {
  const { artifact, messageId, locale } = props;
  const isZh = locale === 'zh-CN';
  const statusLabel =
    artifact.status === 'generating'
      ? isZh
        ? '生成中'
        : 'Generating'
      : artifact.status === 'ready'
        ? isZh
          ? '就绪'
          : 'Ready'
        : isZh
          ? '错误'
          : 'Error';
  const titleLabel = isZh ? '演练' : 'Walkthrough';
  const loadingLabel = isZh ? '正在生成演练…' : 'Generating walkthrough…';
  const viewDocLabel = isZh ? '作为文档查看' : 'View as document';
  const regenerateLabel = isZh ? '重新生成' : 'Regenerate';
  const retryLabel = isZh ? '重试' : 'Retry';

  return (
    <div
      className="walkthrough-card"
      data-testid={`walkthrough-card-${messageId}`}
      data-status={artifact.status}
    >
      <div className="walkthrough-card-header">
        <span className="walkthrough-card-title">{titleLabel}</span>
        <span className="walkthrough-card-status" data-testid={`walkthrough-status-${messageId}`}>
          {statusLabel}
        </span>
        <span className="walkthrough-card-mode">{modeLabel(artifact.mode)}</span>
        <span className="walkthrough-card-model">{modelLabel(artifact)}</span>
      </div>

      {artifact.status === 'generating' ? (
        <div className="walkthrough-card-loading" data-testid={`walkthrough-loading-${messageId}`}>
          {loadingLabel}
        </div>
      ) : null}

      {artifact.status === 'ready' ? (
        <div className="walkthrough-card-content">
          <MarkdownView
            text={artifact.markdown}
            // §5.3: Walkthrough markdown is source-only. Never enable Artifact iframe.
            artifactPreviewEnabled={false}
            renderingPhase="completed"
          />
          <div className="walkthrough-card-actions">
            {props.onOpenDocument ? (
              <button
                type="button"
                className="walkthrough-btn walkthrough-view-btn"
                onClick={() =>
                  props.onOpenDocument?.({
                    title: titleLabel,
                    path: `walkthroughs/${messageId}.md`,
                    content: artifact.markdown,
                  })
                }
                aria-label={viewDocLabel}
                title={viewDocLabel}
                data-testid={`walkthrough-doc-btn-${messageId}`}
              >
                {viewDocLabel}
              </button>
            ) : null}
            {props.onRegenerate ? (
              <button
                type="button"
                className="walkthrough-btn walkthrough-regenerate-btn"
                onClick={() => props.onRegenerate?.()}
                aria-label={regenerateLabel}
                title={regenerateLabel}
                data-testid={`walkthrough-regenerate-btn-${messageId}`}
              >
                {regenerateLabel}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {artifact.status === 'error' ? (
        <div className="walkthrough-card-error">
          <p className="walkthrough-error-message" data-testid={`walkthrough-error-${messageId}`}>
            {artifact.error.message}
          </p>
          {props.onRegenerate ? (
            <button
              type="button"
              className="walkthrough-btn walkthrough-retry-btn"
              onClick={() => props.onRegenerate?.()}
              aria-label={retryLabel}
              title={retryLabel}
              data-testid={`walkthrough-retry-btn-${messageId}`}
            >
              {retryLabel}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
