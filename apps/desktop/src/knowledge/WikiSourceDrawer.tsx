import type { ReactElement } from 'react';
import type { KnowledgeBaseSummary } from '@piwin/contracts';

export type WikiSourceDrawerProps = {
  locale: 'zh-CN' | 'en';
  sourceBases: readonly KnowledgeBaseSummary[];
  onClose: () => void;
  onAddFolder?: (() => void) | undefined;
  onOpenIngest?: ((folderPath: string) => void) | undefined;
  onProduceFlashcards?: ((folderPath: string) => void) | undefined;
};

export function WikiSourceDrawer(props: WikiSourceDrawerProps): ReactElement {
  const zh = props.locale === 'zh-CN';
  const t = (en: string, cn: string) => (zh ? cn : en);
  return (
    <>
      <div
        className="drawer-mask open"
        onClick={props.onClose}
        data-testid="wiki-source-drawer-mask"
      />
      <div className="source-drawer open" data-testid="wiki-source-drawer">
        <div className="drawer-header">
          <span>{t('Source Evidence Bases', '信源证据底座')}</span>
          <button
            type="button"
            className="btn sm ghost"
            onClick={props.onClose}
            data-testid="wiki-close-source-drawer"
          >
            ✕
          </button>
        </div>
        <div className="drawer-content">
          <p>
            {t(
              'Sources provide immutable evidence for the wiki. Slices and citations are clustered here.',
              '信源是维基百科的客观证据底座。Agent 提炼百科与闪卡时均在此处提取切片与交叉验证。',
            )}
          </p>
          {props.onAddFolder ? (
            <button
              type="button"
              className="btn sm pri"
              onClick={props.onAddFolder}
              data-testid="wiki-drawer-add-folder"
            >
              {t('+ Mount local repo / folder', '+ 挂载新的代码库或文档目录')}
            </button>
          ) : null}
          <div className="drawer-base-list">
            {props.sourceBases.map((base) => (
              <div
                key={base.id}
                className="drawer-base-card"
                data-testid={`wiki-source-card-${base.id}`}
              >
                <div className="drawer-base-card-top">
                  <span>{base.name}</span>
                  <span className={`wiki-stamp ${base.state === 'ready' ? 'pine' : 'ochre'}`}>
                    {base.state === 'ready' ? t('Ready', '就绪') : t('Unindexed', '未入库')}
                  </span>
                </div>
                <div className="drawer-base-path">{base.folderPath ?? '~/.piwin/notes'}</div>
                <div className="drawer-base-meta">
                  {base.documentCount ?? 0} {t('files', '文件')} · {base.chunkCount ?? 0} {t('chunks', '切片')}
                </div>
                <div className="drawer-base-actions">
                  {base.folderPath && props.onOpenIngest ? (
                    <button
                      type="button"
                      className="btn sm"
                      data-testid={`wiki-source-reslice-${base.id}`}
                      onClick={() => props.onOpenIngest?.(base.folderPath ?? '')}
                    >
                      {t('Re-slice', '重新切片')}
                    </button>
                  ) : null}
                  {base.folderPath && props.onProduceFlashcards ? (
                    <button
                      type="button"
                      className="btn sm pri"
                      data-testid={`wiki-source-distill-${base.id}`}
                      onClick={() => props.onProduceFlashcards?.(base.folderPath ?? '')}
                    >
                      {t('Distill', '提炼词条')}
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
