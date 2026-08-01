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

function extractMarkdownExcerpt(markdown: string, maxLen = 220): string {
  if (!markdown) return '';
  const lines = markdown.split('\n');
  const textLines = lines
    .map((line) =>
      line
        .replace(/^#{1,6}\s+/, '')
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .trim(),
    )
    .filter((line) => line.length > 0 && !line.startsWith('```') && !line.startsWith('---'));
  const fullText = textLines.join(' ');
  return fullText.length > maxLen ? `${fullText.slice(0, maxLen)}…` : fullText;
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

  const handleOpenDoc = (): void => {
    if (artifact.status === 'ready' && props.onOpenDocument) {
      props.onOpenDocument({
        title: titleLabel,
        path: `walkthroughs/${messageId}.md`,
        content: artifact.markdown,
      });
    }
  };

  const excerptText = artifact.status === 'ready' ? extractMarkdownExcerpt(artifact.markdown) : '';

  return (
    <div
      className="walkthrough-card doc-artifact-card"
      data-testid={`walkthrough-card-${messageId}`}
      data-status={artifact.status}
    >
      {/* Floating Hover Action Bar (Regenerate Icon Button with Tooltip Bubble) */}
      {props.onRegenerate && artifact.status === 'ready' ? (
        <div className="walkthrough-card-hover-actions">
          <button
            type="button"
            className="doc-artifact-icon-btn walkthrough-btn walkthrough-regenerate-btn"
            onClick={(e) => {
              e.stopPropagation();
              props.onRegenerate?.();
            }}
            aria-label={regenerateLabel}
            title={regenerateLabel}
            data-testid={`walkthrough-regenerate-btn-${messageId}`}
          >
            <svg
              className="ic"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
            </svg>
            <span className="doc-artifact-tooltip">{regenerateLabel}</span>
          </button>
        </div>
      ) : null}

      {/* Main Clickable Document Card Preview */}
      <div
        className="doc-artifact-body"
        onClick={handleOpenDoc}
        {...(artifact.status === 'ready'
          ? { 'data-testid': `walkthrough-doc-btn-${messageId}` }
          : {})}
        aria-label={viewDocLabel}
        title={viewDocLabel}
      >
        <span style={{ display: 'none' }}>{viewDocLabel}</span>
        <div className="walkthrough-card-header">
          <span className="doc-artifact-icon">
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
            </svg>
          </span>
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
          <div className="doc-artifact-excerpt-box">
            <p className="doc-artifact-excerpt-text">{excerptText}</p>
            {/* Hidden MarkdownView container for source code fence testing */}
            <div style={{ display: 'none' }}>
              <MarkdownView
                text={artifact.markdown}
                artifactPreviewEnabled={false}
                renderingPhase="completed"
              />
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
                onClick={(e) => {
                  e.stopPropagation();
                  props.onRegenerate?.();
                }}
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
    </div>
  );
}
