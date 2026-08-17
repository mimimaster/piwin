import { type ReactElement } from 'react';
import { Button, TextInput } from '@piwin/ui-kit';
import { useDesktopLocale } from '../desktop-locale-context.js';
import { IconCards } from '../shell-icons.js';

export type KnowledgeReadyViewProps = {
  folderName: string;
  topic: string;
  onTopicChange: (topic: string) => void;
  onGenerate: () => void;
  generateEnabled: boolean;
  disabledReason: string | null;
  busy: boolean;
  retrievalLine: string | null;
  onBrowseLibrary?: (() => void) | undefined;
};

export function KnowledgeReadyView(props: KnowledgeReadyViewProps): ReactElement {
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';
  const t = (en: string, zh: string) => (isZh ? zh : en);

  return (
    <div className="knowledge-ready-view" data-testid="knowledge-ready-view">
      <h3 className="knowledge-ready-title">
        {t(`Generate cards from ${props.folderName}`, `从「${props.folderName}」生成闪卡`)}
      </h3>
      {props.retrievalLine ? (
        <p className="muted knowledge-ready-retrieval">{props.retrievalLine}</p>
      ) : null}
      <div className="knowledge-ready-row">
        <TextInput
          placeholder={t('Topic (optional)', '主题（选填）')}
          value={props.topic}
          onChange={(event) => props.onTopicChange(event.currentTarget.value)}
          className="topic-input"
          disabled={props.busy}
        />
        <Button
          variant="primary"
          size="compact"
          onClick={props.onGenerate}
          disabled={!props.generateEnabled || props.busy}
          data-testid="generate-cards-btn"
        >
          <IconCards width={14} height={14} />
          <span>{t('Generate cards', '生成闪卡')}</span>
        </Button>
      </div>
      {props.disabledReason ? (
        <p className="muted" data-testid="generate-disabled-reason">
          {props.disabledReason}
        </p>
      ) : null}
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
  );
}
