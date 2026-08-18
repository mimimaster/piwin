import { useState, type ReactElement } from 'react';
import type { FlashcardItem } from '@piwin/contracts';
import { itemPreviewText } from '@piwin/flashcards/cloze';
import { formatCardMarkdown, copyToClipboard } from './knowledge-export';

export type DocCardItemProps = {
  card: FlashcardItem;
  onOpenSource?: ((cardId: string) => void) | undefined;
  onSendToChat?: ((card: FlashcardItem) => void) | undefined;
  onToast?: ((msg: string) => void) | undefined;
};

export function DocCardItem({ card, onOpenSource, onSendToChat, onToast }: DocCardItemProps): ReactElement {
  const [flipped, setFlipped] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const md = formatCardMarkdown(card);
    const ok = await copyToClipboard(md);
    if (ok && onToast) {
      onToast('已复制卡片 Markdown 到剪贴板');
    }
  };

  const handleSendChat = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onSendToChat) {
      onSendToChat(card);
    }
  };

  return (
    <article
      className={`doc-card-showcase-item ${flipped ? 'flipped' : ''}`}
      data-testid={`doc-card-item-${card.id}`}
      onClick={() => setFlipped((prev) => !prev)}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          setFlipped((prev) => !prev);
        }
      }}
      aria-label={`${flipped ? 'Back' : 'Front'}: ${itemPreviewText(card)}`}
    >
      <div className="doc-card-item-inner">
        <header className="doc-card-item-header">
          <span className="doc-card-item-tag">{card.deck || 'General'}</span>
          {card.cardType ? <span className="doc-card-item-type">{card.cardType}</span> : null}

          <div className="doc-card-item-actions">
            <button
              type="button"
              className="doc-card-action-icon-btn"
              onClick={handleCopy}
              title="复制为 Markdown"
            >
              📋
            </button>
            {onSendToChat && (
              <button
                type="button"
                className="doc-card-action-icon-btn"
                onClick={handleSendChat}
                title="发送到当前对话讨论"
              >
                💬
              </button>
            )}
            <span className="doc-card-item-flip-hint">
              {flipped ? '翻回' : '翻转'}
            </span>
          </div>
        </header>

        <div className="doc-card-item-body">
          {!flipped ? (
            <div className="doc-card-item-front">
              <span className="doc-card-side-label">Q</span>
              <p className="doc-card-text">{itemPreviewText(card)}</p>
            </div>
          ) : (
            <div className="doc-card-item-back">
              <span className="doc-card-side-label doc-card-side-answer">A</span>
              <p className="doc-card-text">{card.back ?? card.text ?? ''}</p>
            </div>
          )}
        </div>

        {card.sourceFile ? (
          <footer
            className="doc-card-item-footer"
            onClick={(event) => {
              if (onOpenSource) {
                event.stopPropagation();
                onOpenSource(card.id);
              }
            }}
          >
            <span className="doc-card-source-badge" title="点击在本地编辑器中定位源文件">
              📄 {card.sourceFile}
              {typeof card.sourceLine === 'number' ? `:${card.sourceLine}` : ''}
              <span className="doc-card-source-open-hint">↗️ 打开</span>
            </span>
          </footer>
        ) : null}
      </div>
    </article>
  );
}
