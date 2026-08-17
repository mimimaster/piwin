import { type ReactElement } from 'react';
import { Button } from '@piwin/ui-kit';
import type { KnowledgeLoopView } from './knowledge-loop-state.js';
import { useDesktopLocale } from '../desktop-locale-context.js';

export type KnowledgeResultViewProps = {
  resultKind: Exclude<KnowledgeLoopView['resultKind'], 'none'>;
  created: number;
  skipped: number | undefined;
  sessionId: string | undefined;
  error: string | undefined;
  onOpenSession: ((sessionId: string) => void) | undefined;
  onGenerateAgain: () => void;
  onDismiss: () => void;
  onBrowseLibrary?: (() => void) | undefined;
};

export function KnowledgeResultView(props: KnowledgeResultViewProps): ReactElement {
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';
  const t = (en: string, zh: string) => (isZh ? zh : en);

  const isZero = props.resultKind === 'zero';
  const isFailed = props.resultKind === 'failed';
  const showOpen = props.resultKind === 'created' && Boolean(props.sessionId);

  let body: string;
  if (props.resultKind === 'created') {
    body = t(`Created ${props.created} cards.`, `已创建 ${props.created} 张卡片。`);
  } else if (isZero) {
    body = t(
      'No new cards (they may already exist for this folder).',
      '没有新卡片（这个文件夹里可能都是重复的）。',
    );
  } else if (props.resultKind === 'degraded') {
    body = t(
      `Saved ${props.created} cards, but the review session could not be opened.`,
      `已保存 ${props.created} 张卡片，但复习会话没有打开。`,
    );
  } else if (props.resultKind === 'canceled') {
    body = t('Generation was canceled.', '生成已取消。');
  } else {
    body = props.error ?? t('Generation failed.', '生成失败。');
  }

  return (
    <div className="knowledge-result-view" data-testid="knowledge-result-view">
      <p role={isFailed ? 'alert' : isZero ? 'status' : undefined}>{body}</p>
      {typeof props.skipped === 'number' && props.skipped > 0 ? (
        <p className="muted">{t(`Skipped ${props.skipped} duplicates.`, `跳过 ${props.skipped} 张重复卡片。`)}</p>
      ) : null}
      <div className="knowledge-result-actions">
        {showOpen && props.sessionId ? (
          <Button
            variant="primary"
            size="compact"
            data-testid="open-review-session-btn"
            onClick={() => props.onOpenSession?.(props.sessionId!)}
          >
            {t('Open review session', '打开复习会话')}
          </Button>
        ) : null}
        <Button variant="secondary" size="compact" onClick={props.onGenerateAgain} data-testid="generate-again-btn">
          {t('Generate again', '再生成')}
        </Button>
        <Button variant="ghost" size="compact" onClick={props.onDismiss} data-testid="dismiss-result-btn">
          {t('Stay in this folder', '留在此文件夹')}
        </Button>
        {props.onBrowseLibrary ? (
          <Button
            variant="secondary"
            size="compact"
            onClick={props.onBrowseLibrary}
            data-testid="browse-library-btn"
          >
            {t('Browse card library', '浏览卡片库')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
