/**
 * Hero onboarding state for an unindexed repository or folder.
 * Provides instant scanning, file stats, and one-tap RAG index building.
 */

import { type ReactElement } from 'react';
import { Button, IconButton, StatusBadge } from '@piwin/ui-kit';
import { useDesktopLocale } from '../desktop-locale-context.js';
import { DocCardsProgressRing } from '../DocCardsProgressRing.js';
import type { IngestionJob, ScannedDocFile, ScannedFileV2 } from '@piwin/contracts';
import { IconFolder, IconRefresh, IconSettings } from '../shell-icons.js';

export type KnowledgeUnindexedHeroProps = {
  folderPath: string;
  folderName: string;
  scannedFiles: ScannedDocFile[];
  unsupportedFiles: ScannedFileV2[];
  indexingJob: IngestionJob | null;
  busy: boolean;
  empty?: boolean | undefined;
  isEmbeddingConfigured?: boolean | undefined;
  onStartIndexing: () => void;
  onRescan: () => void;
  onPickFolder?: (() => void) | undefined;
  onUseCurrentProject?: (() => void) | undefined;
  onConfigureEmbedding?: (() => void) | undefined;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function KnowledgeUnindexedHero(props: KnowledgeUnindexedHeroProps): ReactElement {
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';
  const t = (en: string, zh: string) => (isZh ? zh : en);

  const totalSize = props.scannedFiles.reduce((acc, f) => acc + (f.sizeBytes || 0), 0);
  const isIndexing = props.indexingJob?.status === 'RUNNING' || props.indexingJob?.status === 'PENDING' || props.busy;

  return (
    <div className="knowledge-unindexed-hero" data-testid="knowledge-unindexed-hero">
      <div className="unindexed-hero-card">
        <div className="unindexed-hero-icon-wrap">
          {isIndexing ? (
            <DocCardsProgressRing
              progress={{
                percent: 30,
                labelZh: '正在建立索引...',
                labelEn: 'Building index...',
              }}
              locale={locale}
            />
          ) : (
            <div className="unindexed-hero-icon">
              <IconFolder width={32} height={32} />
            </div>
          )}
        </div>

        <h2 className="unindexed-hero-title">
          {props.empty
            ? t('Learn from folder', '从文件夹学习')
            : isIndexing
              ? t(`Indexing ${props.folderName}…`, `正在入库「${props.folderName}」…`)
              : t(`Index files in ${props.folderName}`, `入库「${props.folderName}」里的文件`)}
        </h2>

        <p className="unindexed-hero-desc muted">
          {props.empty
            ? t(
                'Pick a local folder of notes or documents. Index the files you want, then generate cards.',
                '选一个本地文档文件夹。先入库所选文件，再生成闪卡。',
              )
            : isIndexing
              ? t('Parsing and indexing the selected files.', '正在解析并入库所选文件。')
              : t(
                  'Choose which supported files to index. Generate is available after those files are ready.',
                  '勾选要入库的支持文件。这些文件就绪后才能生成闪卡。',
                )}
        </p>

        <div className="unindexed-hero-stats">
          <div className="stat-pill">
            <span className="stat-label muted">{t('Scanned files', '扫描文件')}:</span>
            <span className="stat-val">{props.scannedFiles.length}</span>
          </div>
          <div className="stat-pill">
            <span className="stat-label muted">{t('Total size', '文档体积')}:</span>
            <span className="stat-val">{formatBytes(totalSize)}</span>
          </div>
          {props.unsupportedFiles.length > 0 ? (
            <div className="stat-pill unsupported">
              <span className="stat-label muted">{t('Skipped', '跳过非文本')}:</span>
              <span className="stat-val">{props.unsupportedFiles.length}</span>
            </div>
          ) : null}
        </div>

        {props.onConfigureEmbedding && props.isEmbeddingConfigured === false ? (
          <div className="unindexed-hero-config-hint" data-testid="hero-embedding-unconfigured-hint">
            <span className="hint-dot" />
            <span className="hint-text">
              {t(
                'Embedding model unconfigured (will use basic full-text indexing).',
                '当前未配置向量模型（将以全文检索模式构建）。',
              )}
            </span>
            <button
              type="button"
              className="hint-config-btn"
              onClick={props.onConfigureEmbedding}
              data-testid="hero-configure-embedding-link"
            >
              {t('Configure Embedding →', '配置向量模型 →')}
            </button>
          </div>
        ) : null}

        <div className="unindexed-hero-actions">
          {isIndexing ? (
            <div className="indexing-status-indicator">
              <StatusBadge
                tone="running"
                label={t('Indexing files…', '正在入库文件…')}
              />
            </div>
          ) : (
            <>
              {props.empty && props.onPickFolder ? (
                <>
                  <Button
                    variant="primary"
                    size="default"
                    onClick={props.onPickFolder}
                    data-testid="hero-pick-folder-btn"
                    className="hero-primary-btn"
                  >
                    <span>{t('Choose folder…', '选择文件夹…')}</span>
                  </Button>
                  {props.onUseCurrentProject ? (
                    <Button
                      variant="secondary"
                      size="default"
                      onClick={props.onUseCurrentProject}
                      data-testid="use-current-project-btn"
                    >
                      <span>{t('Use current project (optional)', '使用当前项目（可选）')}</span>
                    </Button>
                  ) : null}
                </>
              ) : (
                <Button
                  variant="primary"
                  size="default"
                  onClick={props.onStartIndexing}
                  disabled={props.scannedFiles.length === 0 || props.busy}
                  data-testid="start-indexing-btn"
                  className="hero-primary-btn"
                >
                  <span>{t('Index these files', '入库这些文件')}</span>
                </Button>
              )}
              <Button
                variant="secondary"
                size="default"
                onClick={props.onRescan}
                disabled={props.busy}
                data-testid="rescan-btn"
              >
                <IconRefresh width={14} height={14} />
                <span>{t('Rescan folder', '重新扫描目录')}</span>
              </Button>
              {props.onConfigureEmbedding ? (
                <IconButton
                  label={t('Embedding settings…', '设置 Embedding 模型…')}
                  onClick={props.onConfigureEmbedding}
                  data-testid="hero-configure-embedding-btn"
                >
                  <IconSettings width={14} height={14} />
                </IconButton>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
