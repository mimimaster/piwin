import type { ReactElement } from 'react';
import {
  IconBook,
  IconCards,
  IconFolder,
  IconGrid,
  IconSettings,
} from '../../tool-cards/shell-icons.js';
import {
  KNOWLEDGE_WORKSPACE_SECTIONS,
  type KnowledgeSectionMeta,
  type KnowledgeWorkspaceSection,
} from './knowledge-workspace-sections.js';

export type KnowledgeWorkspaceNavProps = {
  locale: 'zh-CN' | 'en';
  active: KnowledgeWorkspaceSection;
  onSelect: (section: KnowledgeWorkspaceSection) => void;
  /** Real counts only; a section with no count yet renders no badge. */
  counts?: Partial<Record<KnowledgeWorkspaceSection, number>> | undefined;
  onOpenIndexSettings?: (() => void) | undefined;
};

const SECTION_ICONS: Record<KnowledgeWorkspaceSection, typeof IconGrid> = {
  overview: IconGrid,
  materials: IconFolder,
  wiki: IconBook,
  flashcards: IconCards,
};

export function KnowledgeWorkspaceNav(props: KnowledgeWorkspaceNavProps): ReactElement {
  const zh = props.locale === 'zh-CN';
  const t = (en: string, cn: string) => (zh ? cn : en);

  function renderItem(meta: KnowledgeSectionMeta): ReactElement {
    const Icon = SECTION_ICONS[meta.section];
    const count = props.counts?.[meta.section];
    const active = props.active === meta.section;
    return (
      <button
        key={meta.section}
        type="button"
        className={`kw-nav-item${active ? ' is-active' : ''}`}
        aria-current={active ? 'page' : undefined}
        onClick={() => props.onSelect(meta.section)}
        data-testid={meta.testId}
      >
        <Icon width={15} height={15} aria-hidden="true" />
        <span className="kw-nav-text">{zh ? meta.labelZh : meta.labelEn}</span>
        {typeof count === 'number' && count > 0 ? (
          <span className="kw-nav-count">{count}</span>
        ) : null}
      </button>
    );
  }

  return (
    <aside className="kw-nav" aria-label={t('Knowledge sections', '知识分区')}>
      <div className="kw-nav-group">
        <div className="kw-nav-label">{t('Browse', '浏览')}</div>
        {KNOWLEDGE_WORKSPACE_SECTIONS.map(renderItem)}
      </div>
      <div className="kw-nav-footer">
        {props.onOpenIndexSettings ? (
          <button
            type="button"
            className="kw-nav-item kw-nav-item-quiet"
            onClick={props.onOpenIndexSettings}
            data-testid="knowledge-index-settings"
          >
            <IconSettings width={15} height={15} aria-hidden="true" />
            <span className="kw-nav-text">{t('Index & Settings', '索引与设置')}</span>
            <span className="kw-status-dot is-ready" style={{ marginLeft: 'auto' }} title={t('Index ready', '索引正常')} />
          </button>
        ) : null}
      </div>
    </aside>
  );
}
