import type { ReactElement } from 'react';
import { Button, Notice, Spinner } from '@piwin/ui-kit';
import type { KnowledgeProduceNotice } from './use-knowledge-produce.js';

export type KnowledgeProduceNoticesProps = {
  locale: 'zh-CN' | 'en';
  generating: boolean;
  notice: KnowledgeProduceNotice | null;
  onOpenWiki: () => void;
  onOpenFlashcards: () => void;
};

/** Progress and result of one distil+produce run. Lives above the section body. */
export function KnowledgeProduceNotices(props: KnowledgeProduceNoticesProps): ReactElement {
  const zh = props.locale === 'zh-CN';
  const t = (en: string, cn: string) => (zh ? cn : en);
  const notice = props.notice;

  return (
    <>
      {props.generating ? (
        <Notice tone="info" testId="knowledge-generating">
          <Spinner label={t('Generating flashcards…', '正在生成闪卡…')} />
        </Notice>
      ) : null}
      {notice ? (
        <Notice
          tone="success"
          testId="knowledge-produce-success"
          action={
            <div style={{ display: 'flex', gap: 'var(--s-2)' }}>
              {notice.concept ? (
                <Button
                  variant="secondary"
                  size="compact"
                  onClick={props.onOpenWiki}
                  data-testid="knowledge-produce-open-wiki"
                >
                  <span>{t('Open concept', '去看词条')}</span>
                </Button>
              ) : null}
              <Button variant="primary" size="compact" onClick={props.onOpenFlashcards}>
                <span>{t('Review cards', '去复习卡片')}</span>
              </Button>
            </div>
          }
        >
          {notice.concept && notice.count === 0
            ? t(
                `Distilled "${notice.concept}" from "${notice.folderName}". No flashcards were produced — see the error above.`,
                `已从「${notice.folderName}」提炼词条「${notice.concept}」；闪卡未生成，原因见上方提示。`,
              )
            : notice.concept
              ? t(
                  `Distilled "${notice.concept}" and generated ${notice.count} flashcards from "${notice.folderName}".`,
                  `已从「${notice.folderName}」提炼词条「${notice.concept}」，并生成 ${notice.count} 张闪卡。`,
                )
              : t(
                  `Generated ${notice.count} flashcards for "${notice.folderName}".`,
                  `已为「${notice.folderName}」生成 ${notice.count} 张闪卡。`,
                )}
        </Notice>
      ) : null}
    </>
  );
}
