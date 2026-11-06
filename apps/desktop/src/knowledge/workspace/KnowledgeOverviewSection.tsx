/**
 * Overview: what the user has and what they can do next.
 *
 * Every number is a Host read (see `use-knowledge-overview`). Blocks that the
 * Host cannot answer say so; nothing renders a placeholder metric, and no
 * sample content is ever counted as the user's own.
 */
import type { ReactElement } from 'react';
import { Notice, Spinner } from '@piwin/ui-kit';
import type { WikiConceptItem } from '@piwin/contracts';
import { IconBook, IconCards, IconFolder, IconFolderPlus } from '../../tool-cards/shell-icons.js';
import type { KnowledgeOverviewState } from './use-knowledge-overview.js';
import type { KnowledgeRecentRead } from './knowledge-workspace-recents.js';
import type { KnowledgeWorkspaceSection } from './knowledge-workspace-sections.js';

export type KnowledgeOverviewSectionProps = {
  locale: 'zh-CN' | 'en';
  state: KnowledgeOverviewState;
  onSelectSection: (section: KnowledgeWorkspaceSection) => void;
  onOpenConcept: (concept: WikiConceptItem) => void;
  onAddFolder?: (() => void) | undefined;
  onStartStudy?: (() => void) | undefined;
  onOpenIndexSettings?: (() => void) | undefined;
  recents?: readonly KnowledgeRecentRead[];
  onOpenRecent?: ((entry: KnowledgeRecentRead) => void) | undefined;
};

export function KnowledgeOverviewSection(props: KnowledgeOverviewSectionProps): ReactElement {
  const zh = props.locale === 'zh-CN';
  const t = (en: string, cn: string) => (zh ? cn : en);
  const { data, loading, errors } = props.state;

  const materials = data.materials;
  const wiki = data.wiki;
  const study = data.study;
  const collections = data.collections;

  const isEmpty =
    materials !== null &&
    wiki !== null &&
    materials.sources === 0 &&
    materials.notes === 0 &&
    wiki.concepts === 0;

  if (loading && materials === null && wiki === null) {
    return (
      <div className="kw-state" data-testid="knowledge-overview">
        <Spinner label={t('Reading your knowledge space…', '正在读取知识空间…')} />
      </div>
    );
  }

  return (
    <div className="kw-overview" data-testid="knowledge-overview">
      <header className="kw-page-head">
        <div>
          <h1>{t('Overview', '总览')}</h1>
          <p>
            {t(
              'Everything filed under this Host: materials, knowledge pages and what is due today.',
              '这里是这台 Host 上的全部内容：资料、知识页，以及今天该复习什么。',
            )}
          </p>
        </div>
        <div className="kw-overview-head-actions">
          {props.onAddFolder ? (
            <button
              type="button"
              className="kw-btn"
              onClick={props.onAddFolder}
              data-testid="knowledge-overview-head-add"
            >
              <IconFolderPlus width={14} height={14} aria-hidden="true" />
              <span>{t('Add materials', '添加资料')}</span>
            </button>
          ) : null}
          <button
            type="button"
            className="kw-btn"
            onClick={() => props.onSelectSection('wiki')}
            data-testid="knowledge-overview-head-wiki"
          >
            <IconBook width={14} height={14} aria-hidden="true" />
            <span>{t('Knowledge wiki', '知识 Wiki')}</span>
          </button>
        </div>
      </header>

      {errors.length > 0 ? (
        <Notice tone="error" testId="knowledge-overview-error">
          {errors.join(' · ')}
        </Notice>
      ) : null}

      {isEmpty ? (
        <section className="kw-empty" data-testid="knowledge-overview-empty">
          <h2>{t('Nothing here yet', '还没有内容')}</h2>
          <p>
            {t(
              'Add a folder of Markdown, text or code, and it shows up in the materials library — readable before it is indexed.',
              '添加一个装着 Markdown、纯文本或代码的文件夹，它会出现在资料库里；没有建立索引也能直接阅读。',
            )}
          </p>
          <div className="kw-empty-actions">
            {props.onAddFolder ? (
              <button
                type="button"
                className="kw-btn is-primary"
                onClick={props.onAddFolder}
                data-testid="knowledge-overview-add-folder"
              >
                <IconFolderPlus width={15} height={15} aria-hidden="true" />
                <span>{t('Add materials', '添加资料')}</span>
              </button>
            ) : null}
            <button
              type="button"
              className="kw-btn"
              onClick={() => props.onSelectSection('wiki')}
              data-testid="knowledge-overview-open-wiki"
            >
              <IconBook width={15} height={15} aria-hidden="true" />
              <span>{t('Open the wiki', '打开知识 Wiki')}</span>
            </button>
          </div>
        </section>
      ) : null}

      <div className="kw-kpis">
        <button
          type="button"
          className="kw-kpi"
          onClick={() => props.onSelectSection('materials')}
          data-testid="knowledge-kpi-materials"
        >
          <div className="kw-kpi-top">
            <div>
              <span className="kw-kpi-label">{t('Materials', '资料')}</span>
              <span className="kw-kpi-value">{materials ? materials.documents : '—'}</span>
            </div>
            <span className="kw-kpi-icon is-blue" aria-hidden="true">
              <IconFolder width={18} height={18} />
            </span>
          </div>
          <div className="kw-kpi-hint">
            <span>
              {materials
                ? t(
                    `${materials.sources} sources · ${materials.notes} notes`,
                    `${materials.sources} 个来源 · ${materials.notes} 条笔记`,
                  )
                : t('Unavailable', '暂不可用')}
            </span>
            <span className="kw-kpi-arrow">{t('Browse →', '浏览 →')}</span>
          </div>
        </button>

        <button
          type="button"
          className="kw-kpi"
          onClick={() => props.onSelectSection('wiki')}
          data-testid="knowledge-kpi-wiki"
        >
          <div className="kw-kpi-top">
            <div>
              <span className="kw-kpi-label">{t('Knowledge pages', '知识页')}</span>
              <span className="kw-kpi-value">{wiki ? wiki.concepts : '—'}</span>
            </div>
            <span className="kw-kpi-icon is-emerald" aria-hidden="true">
              <IconBook width={18} height={18} />
            </span>
          </div>
          <div className="kw-kpi-hint">
            <span>
              {wiki ? t('Concepts, topics and notes', '概念、专题与笔记') : t('Unavailable', '暂不可用')}
            </span>
            <span className="kw-kpi-arrow">{t('Explore →', '进入 Wiki →')}</span>
          </div>
        </button>

        <button
          type="button"
          className="kw-kpi"
          onClick={() => props.onSelectSection('flashcards')}
          data-testid="knowledge-kpi-due"
        >
          <div className="kw-kpi-top">
            <div>
              <span className="kw-kpi-label">{t('Due cards', '待复习')}</span>
              <span className="kw-kpi-value">{study ? study.dueCount : '—'}</span>
            </div>
            <span className="kw-kpi-icon is-amber" aria-hidden="true">
              <IconCards width={18} height={18} />
            </span>
          </div>
          <div className="kw-kpi-hint">
            <span>
              {study
                ? study.unfinishedCount > 0
                  ? t(`${study.unfinishedCount} round to continue`, `有 ${study.unfinishedCount} 轮未结束`)
                  : t(`${study.newCount} new cards`, `${study.newCount} 张新卡`)
                : t('Unavailable', '暂不可用')}
            </span>
            <span className="kw-kpi-arrow">{t('Study →', '继续复习 →')}</span>
          </div>
        </button>
      </div>

      <div className="kw-grid kw-grid-bento">
        {/* Left Column (7 cols): Continue reading + Recently edited wiki */}
        <div className="kw-col-main">
          <section className="kw-card" data-testid="knowledge-overview-continue">
            <div className="kw-card-head">
              <h2>{t('Continue reading', '继续阅读')}</h2>
              <button
                type="button"
                className="kw-link"
                onClick={() => props.onSelectSection('materials')}
              >
                {t('All materials', '全部资料')}
              </button>
            </div>
            {!props.recents || props.recents.length === 0 ? (
              <div className="kw-card-placeholder">
                <span className="kw-placeholder-icon" aria-hidden="true">
                  <IconBook width={22} height={22} />
                </span>
                <p className="kw-muted">
                  {t('Open a document or wiki page and it will show up here.', '打开原文或知识页后会出现在这里。')}
                </p>
              </div>
            ) : (
              <ul className="kw-list">
                {props.recents.map((entry) => (
                  <li key={entry.kind === 'wiki' ? `wiki:${entry.slug}` : `doc:${entry.baseId}:${entry.relativePath}`}>
                    <button
                      type="button"
                      className="kw-row kw-read-row"
                      data-testid={
                        entry.kind === 'wiki'
                          ? `knowledge-overview-continue-wiki-${entry.slug}`
                          : `knowledge-overview-continue-doc-${entry.relativePath}`
                      }
                      onClick={() => props.onOpenRecent?.(entry)}
                    >
                      <div className="kw-row-title-wrap">
                        <span className={`kw-source-badge ${entry.kind === 'wiki' ? 'is-wiki' : 'is-doc'}`}>
                          {entry.kind === 'wiki' ? t('Wiki', 'Wiki') : t('Doc', '原文')}
                        </span>
                        <div className="kw-row-text">
                          <span className="kw-row-title">{entry.title}</span>
                          {entry.kind === 'document' ? (
                            <span className="kw-row-subpath">{entry.relativePath}</span>
                          ) : (
                            <span className="kw-row-subpath">{entry.slug}</span>
                          )}
                        </div>
                      </div>
                      <span className="kw-row-meta">
                        {entry.kind === 'wiki'
                          ? t('Wiki →', '知识页 →')
                          : t(
                              entry.startLine ? `Document · line ${entry.startLine}` : 'Document',
                              entry.startLine ? `原文 · 第 ${entry.startLine} 行` : '原文',
                            )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="kw-card" data-testid="knowledge-overview-recent">
            <div className="kw-card-head">
              <h2>{t('Recently edited', '最近整理')}</h2>
              <button
                type="button"
                className="kw-link"
                onClick={() => props.onSelectSection('wiki')}
              >
                {t('All wiki pages', '全部词条')}
              </button>
            </div>
            {wiki === null ? (
              <p className="kw-muted">{t('Unavailable on this Host.', '当前 Host 不支持。')}</p>
            ) : wiki.recent.length === 0 ? (
              <p className="kw-muted">
                {t('No knowledge pages yet.', '还没有知识页。')}
              </p>
            ) : (
              <ul className="kw-list">
                {wiki.recent.map((concept) => (
                  <li key={concept.relativePath}>
                    <button
                      type="button"
                      className="kw-row kw-recent-row"
                      onClick={() => props.onOpenConcept(concept)}
                      data-testid={`knowledge-overview-concept-${concept.slug}`}
                    >
                      <div className="kw-row-title-wrap">
                        <div className="kw-row-text">
                          <span className="kw-row-title">{concept.title}</span>
                          <span className="kw-row-subpath">
                            {concept.tags[0] ? `#${concept.tags[0]}` : t('#concept', '#概念')} · {concept.relativePath}
                          </span>
                        </div>
                      </div>
                      <span className="kw-row-meta">{concept.updatedAt.slice(0, 10)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* Right Column (5 cols): Due cards + Collections */}
        <div className="kw-col-side">
          <section className="kw-card kw-card-study" data-testid="knowledge-overview-study">
            <div className="kw-card-head">
              <div className="kw-card-title-group">
                <span className="kw-tag is-amber">{t('FSRS Spaced Repetition', 'FSRS 间隔复习')}</span>
              </div>
              <button
                type="button"
                className="kw-link"
                onClick={() => props.onSelectSection('flashcards')}
                data-testid="knowledge-overview-study-all"
              >
                {t('All cards', '全部卡片')}
              </button>
            </div>
            {study === null ? (
              <p className="kw-muted">{t('Unavailable on this Host.', '当前 Host 不支持。')}</p>
            ) : (
              <div className="kw-study-card-content">
                <h3 className="kw-study-lead-title">
                  {study.dueCount > 0
                    ? t(`${study.dueCount} review units are due.`, `${study.dueCount} 个复习单元已到期`)
                    : t('Nothing is due right now.', '当前没有到期的卡片。')}
                </h3>
                <p className="kw-study-note">
                  {study.unfinishedCount > 0
                    ? t(`There is ${study.unfinishedCount} unfinished round. Finish it to compound concepts.`, `当前有 ${study.unfinishedCount} 轮未结束的复习进度，完成后可强化近期整理的知识概念。`)
                    : t('Keep reviewing regularly to maintain long-term memory stability.', '持续每日复习可强化记忆稳定性，巩固已沉淀知识点。')}
                </p>
                {props.onStartStudy && (study.dueCount > 0 || study.unfinishedCount > 0) ? (
                  <div className="kw-study-footer">
                    <button
                      type="button"
                      className="kw-btn is-primary kw-study-btn"
                      onClick={props.onStartStudy}
                      data-testid="knowledge-overview-start-study"
                    >
                      <span>
                        {study.unfinishedCount > 0
                          ? t('Continue the round →', '继续本轮 →')
                          : t('Start review →', '开始复习 →')}
                      </span>
                    </button>
                  </div>
                ) : null}
              </div>
            )}
          </section>

          <section className="kw-card" data-testid="knowledge-overview-collections">
            <div className="kw-card-head">
              <h2>{t('Topic collections', '主题合集分布')}</h2>
              <span className="kw-subtag">{t('Cross-domain filter', '多主题共享不复制')}</span>
            </div>
            {collections === null ? (
              <p className="kw-muted">
                {t(
                  'This Host version does not store collections yet.',
                  '当前 Host 版本还不支持主题合集。',
                )}
              </p>
            ) : collections.length === 0 ? (
              <p className="kw-muted">
                {t(
                  'No collections yet. One material can belong to several topics without being copied.',
                  '还没有主题合集。同一份资料可以属于多个主题，内容只保留一份。',
                )}
              </p>
            ) : (
              <ul className="kw-list">
                {collections.map((collection) => (
                  <li key={collection.id}>
                    <div className="kw-row" data-testid={`knowledge-collection-${collection.id}`}>
                      <span className="kw-row-title">{collection.name}</span>
                      <span className="kw-row-meta">
                        {collection.counts.materials + collection.counts.notes}{' '}
                        {t('materials', '资料')} · {collection.counts.wiki} {t('pages', '页')} ·{' '}
                        {collection.counts.cards} {t('cards', '卡')}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
