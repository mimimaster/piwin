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
            ? t('Choose a document folder first', '先选一个文档文件夹')
            : isIndexing
              ? t(`Indexing ${props.folderName}...`, `正在为「${props.folderName}」构建知识库...`)
              : t(`Build Knowledge Base for ${props.folderName}`, `为「${props.folderName}」构建知识库`)}
        </h2>

        <p className="unindexed-hero-desc muted">
          {isIndexing
            ? t(
                'Parsing code and documentation files, generating structure-aware chunks and vector embeddings.',
                '正在解析代码与文档、建立结构化切片与向量索引...',
              )
            : t(
                'Scan and index Markdown documents, architectural design, and core source code into a local-first RAG knowledge base.',
                '自动扫描并索引项目中的 Markdown 文档、架构说明与核心源码，构建本地私有化 RAG 知识底座与全景 Wiki。',
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
                label={t('Processing chunks...', '正在处理切片...')}
              />
            </div>
          ) : (
            <>
              {props.empty && props.onPickFolder ? (
                <Button
                  variant="primary"
                  size="default"
                  onClick={props.onPickFolder}
                  data-testid="hero-pick-folder-btn"
                  className="hero-primary-btn"
                >
                  <span>{t('Choose folder…', '选择文件夹…')}</span>
                </Button>
              ) : (
                <Button
                  variant="primary"
                  size="default"
                  onClick={props.onStartIndexing}
                  disabled={props.scannedFiles.length === 0 || props.busy}
                  data-testid="start-indexing-btn"
                  className="hero-primary-btn"
                >
                  <span>{t('🚀 Build Knowledge Base', '🚀 立即开始分析与构建索引')}</span>
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
