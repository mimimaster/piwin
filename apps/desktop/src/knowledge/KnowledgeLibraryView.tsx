/**
 * Folder card library: gallery + export. No in-panel FSRS.
 */
import { useState, type ReactElement } from 'react';
import { Button, ConfirmDialog, IconButton } from '@piwin/ui-kit';
import type { FlashcardRecord } from '@piwin/contracts';
import { useDesktopLocale } from '../desktop-locale-context.js';
import { DocCardItem } from '../DocCardItem.js';
import {
  copyToClipboard,
  downloadFile,
  formatCardsAnkiTsv,
  formatDeckMarkdown,
} from '../knowledge-export.js';
import type { DoccardsHostRequest } from './knowledge-host-request.js';
import { IconCopy, IconDownload } from '../shell-icons.js';

export type KnowledgeLibraryViewProps = {
  folderPath: string;
  folderName: string;
  cards: FlashcardRecord[];
  request: DoccardsHostRequest;
  onBack: () => void;
  onOpenCardsPanel?: (() => void) | undefined;
  onSendToChat?: ((card: FlashcardRecord) => void) | undefined;
  onOpenSourceFile?: ((cardId: string) => void) | undefined;
  onForgot?: (() => void) | undefined;
};

export function KnowledgeLibraryView(props: KnowledgeLibraryViewProps): ReactElement {
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';
  const t = (en: string, zh: string) => (isZh ? zh : en);
  const [copiedAll, setCopiedAll] = useState(false);
  const [forgetOpen, setForgetOpen] = useState(false);
  const [forgetBusy, setForgetBusy] = useState(false);

  function handleCopyAll(): void {
    if (props.cards.length === 0) return;
    copyToClipboard(formatDeckMarkdown(props.folderName, props.cards));
    setCopiedAll(true);
    window.setTimeout(() => setCopiedAll(false), 1500);
  }

  async function confirmForget(): Promise<void> {
    setForgetBusy(true);
    try {
      await props.request({ type: 'doccards/forget-folder', folderPath: props.folderPath });
      setForgetOpen(false);
      props.onForgot?.();
    } finally {
      setForgetBusy(false);
    }
  }

  return (
    <div className="knowledge-library-view" data-testid="knowledge-library-view">
      <div className="knowledge-library-toolbar">
        <Button variant="ghost" size="compact" onClick={props.onBack} data-testid="library-back-btn">
          {t('Back', '返回')}
        </Button>
        <span className="knowledge-library-count">
          {t(`${props.cards.length} cards`, `${props.cards.length} 张卡片`)}
        </span>
        <IconButton
          label={copiedAll ? t('Copied!', '已复制') : t('Copy all as Markdown', '复制全部 Markdown')}
          onClick={handleCopyAll}
          disabled={props.cards.length === 0}
          data-testid="copy-all-cards-btn"
        >
          <IconCopy width={14} height={14} />
        </IconButton>
        <Button
          variant="secondary"
          size="compact"
          onClick={() =>
            downloadFile(`${props.folderName}-anki.tsv`, formatCardsAnkiTsv(props.cards), 'text/tab-separated-values')
          }
          disabled={props.cards.length === 0}
          data-testid="export-anki-btn"
        >
          <IconDownload width={12} height={12} />
          <span>{t('Anki TSV', '导出 Anki')}</span>
        </Button>
        <Button
          variant="secondary"
          size="compact"
          onClick={() =>
            downloadFile(`${props.folderName}-flashcards.md`, formatDeckMarkdown(props.folderName, props.cards), 'text/markdown')
          }
          disabled={props.cards.length === 0}
          data-testid="export-md-btn"
        >
          <IconDownload width={12} height={12} />
          <span>{t('Markdown', '导出 MD')}</span>
        </Button>
        {props.onOpenCardsPanel ? (
          <Button
            variant="secondary"
            size="compact"
            onClick={props.onOpenCardsPanel}
            data-testid="open-due-review-btn"
          >
            {t('Due review', '到期复习')}
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="compact"
          onClick={() => setForgetOpen(true)}
          disabled={props.cards.length === 0 || forgetBusy}
          data-testid="library-forget-btn"
        >
          {t('Forget folder cards', '遗忘此文件夹的卡片')}
        </Button>
      </div>
      {props.cards.length === 0 ? (
        <p className="muted">{t('No cards in this folder yet.', '这个文件夹还没有卡片。')}</p>
      ) : (
        <div className="knowledge-library-grid">
          {props.cards.map((card) => (
            <DocCardItem
              key={card.id}
              card={card}
              onOpenSource={props.onOpenSourceFile}
              onSendToChat={props.onSendToChat}
            />
          ))}
        </div>
      )}
      <ConfirmDialog
        open={forgetOpen}
        onOpenChange={setForgetOpen}
        title={t('Forget folder cards?', '遗忘此文件夹的闪卡？')}
        description={t(
          `This will delete all flashcards sourced from this folder. ${props.cards.length} card(s) will be removed.`,
          `这将删除所有来自此文件夹的闪卡。共有 ${props.cards.length} 张卡片将被移除。`,
        )}
        confirmLabel={t('Forget', '确认遗忘')}
        cancelLabel={t('Cancel', '取消')}
        tone="danger"
        onConfirm={() => void confirmForget()}
        testId="library-forget-confirm"
      />
    </div>
  );
}
