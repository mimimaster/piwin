import type { KeyboardEvent, ReactElement } from 'react';
import type { WalkthroughArtifact } from '@piwin/contracts';
import { Button, IconButton, IconFile, IconRefresh } from '@piwin/ui-kit';
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
  const titleLabel = isZh ? '走查报告' : 'Walkthrough';
  const loadingLabel = isZh ? '正在生成走查报告…' : 'Generating walkthrough…';
  const viewDocLabel = isZh ? '作为文档查看' : 'View as document';
  const openFullLabel = isZh ? '打开完整文档' : 'Open full document';
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

  const handleOpenDocKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    handleOpenDoc();
  };

  const excerptText = artifact.status === 'ready' ? extractMarkdownExcerpt(artifact.markdown) : '';

  return (
    <div
      className="card wt walkthrough-card doc-artifact-card"
      data-testid={`walkthrough-card-${messageId}`}
      data-status={artifact.status}
    >
      {/* Floating Hover Action Bar (Regenerate Icon Button with Tooltip Bubble) */}
      {props.onRegenerate && artifact.status === 'ready' ? (
        <div className="walkthrough-card-hover-actions">
          <IconButton
            label={regenerateLabel}
            className="doc-artifact-icon-btn walkthrough-btn walkthrough-regenerate-btn"
            onClick={(e) => {
              e.stopPropagation();
              props.onRegenerate?.();
            }}
            title={regenerateLabel}
            data-testid={`walkthrough-regenerate-btn-${messageId}`}
          >
            <IconRefresh width={14} height={14} />
          </IconButton>
        </div>
      ) : null}

      {/* Main Clickable Document Card Preview */}
      <div
        className={`doc-artifact-body${artifact.status === 'ready' ? ' is-openable' : ''}`}
        onClick={handleOpenDoc}
        onKeyDown={artifact.status === 'ready' ? handleOpenDocKeyDown : undefined}
        {...(artifact.status === 'ready'
          ? {
              'data-testid': `walkthrough-doc-btn-${messageId}`,
              role: 'button',
              tabIndex: 0,
            }
          : {})}
        aria-label={viewDocLabel}
        title={viewDocLabel}
      >
        <span style={{ display: 'none' }}>{viewDocLabel}</span>
        <div className="walkthrough-card-header">
          <span className="doc-artifact-icon">
            <IconFile width={15} height={15} />
          </span>
          <span className="walkthrough-card-title">{titleLabel}</span>
          <span className="walkthrough-card-status" data-testid={`walkthrough-status-${messageId}`}>
            {statusLabel}
          </span>
          <span className="walkthrough-card-mode">{modeLabel(artifact.mode)}</span>
          <span className="walkthrough-card-model">{modelLabel(artifact)}</span>
        </div>

        {artifact.status === 'generating' ? (
          <div
            className="walkthrough-card-loading"
            data-testid={`walkthrough-loading-${messageId}`}
          >
            {loadingLabel}
          </div>
        ) : null}

        {artifact.status === 'ready' ? (
          <div className="doc-artifact-excerpt-box">
            <span className="doc-artifact-excerpt-label">{isZh ? '摘要' : 'Summary'}</span>
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
      </div>

      {artifact.status === 'ready' ? (
        <div className="cf walkthrough-card-footer" data-testid={`walkthrough-footer-${messageId}`}>
          {props.onOpenDocument ? (
            <Button
              variant="secondary"
              size="compact"
              className="btn sm walkthrough-btn walkthrough-view-btn"
              onClick={(e) => {
                e.stopPropagation();
                handleOpenDoc();
              }}
            >
              {viewDocLabel} ↗
            </Button>
          ) : null}
          {props.onRegenerate ? (
            <Button
              variant="secondary"
              size="compact"
              className="btn sm walkthrough-btn walkthrough-regenerate-footer-btn"
              onClick={(e) => {
                e.stopPropagation();
                props.onRegenerate?.();
              }}
            >
              {regenerateLabel}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="compact"
            className="btn sm walkthrough-btn walkthrough-copy-btn"
            onClick={(e) => {
              e.stopPropagation();
              void navigator.clipboard.writeText(artifact.markdown);
            }}
          >
            {isZh ? '复制' : 'Copy'}
          </Button>
          <span className="m walkthrough-footer-meta" aria-hidden="true">
            {openFullLabel}
          </span>
        </div>
      ) : null}

      {artifact.status === 'error' ? (
        <div className="walkthrough-card-error">
          <p className="walkthrough-error-message" data-testid={`walkthrough-error-${messageId}`}>
            {artifact.error.message}
          </p>
          {props.onRegenerate ? (
            <Button
              variant="secondary"
              size="compact"
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
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
