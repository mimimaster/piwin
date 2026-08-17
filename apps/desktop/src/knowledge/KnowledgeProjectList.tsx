/**
 * Left column: Projects and Knowledge Base List.
 * Shows active project, recent projects, and custom mounted folders with index stats.
 */

import { useMemo, useState, type ReactElement } from 'react';
import { Button, IconButton, TextInput } from '@piwin/ui-kit';
import { useDesktopLocale } from '../desktop-locale-context.js';
import { IconFolder, IconFolderOpen, IconPlus, IconSettings } from '../shell-icons.js';
import { pickProjectDirectory } from '../pick-project-directory.js';

export type KnowledgeProjectItem = {
  path: string;
  name: string;
  isActiveProject: boolean;
  status: 'ready' | 'indexing' | 'unindexed';
  sliceCount?: number | undefined;
  cardCount?: number | undefined;
};

export type KnowledgeProjectListProps = {
  activeProjectPath: string | null;
  recentProjects: Array<{ path: string; name?: string }>;
  mountedFolders: string[];
  selectedPath: string;
  projectStats?: Record<string, { status: 'ready' | 'indexing' | 'unindexed'; sliceCount?: number | undefined; cardCount?: number | undefined }> | undefined;
  onSelectProject: (path: string) => void;
  onMountFolder: (path: string) => void;
  onConfigureEmbedding?: (() => void) | undefined;
};

function getFolderBasename(folderPath: string): string {
  const parts = folderPath.replace(/[/\\]+$/, '').split(/[/\\]/);
  return parts[parts.length - 1] || folderPath;
}

export function KnowledgeProjectList(props: KnowledgeProjectListProps): ReactElement {
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';
  const t = (en: string, zh: string) => (isZh ? zh : en);

  const [query, setQuery] = useState('');

  // Assemble unique projects list: active project first, then recent, then mounted
  const projectItems: KnowledgeProjectItem[] = useMemo(() => {
    const map = new Map<string, KnowledgeProjectItem>();

    if (props.activeProjectPath) {
      const p = props.activeProjectPath;
      const stats = props.projectStats?.[p];
      map.set(p, {
        path: p,
        name: getFolderBasename(p),
        isActiveProject: true,
        status: stats?.status ?? 'unindexed',
        sliceCount: stats?.sliceCount,
        cardCount: stats?.cardCount,
      });
    }

    for (const recent of props.recentProjects) {
      if (!map.has(recent.path)) {
        const stats = props.projectStats?.[recent.path];
        map.set(recent.path, {
          path: recent.path,
          name: recent.name || getFolderBasename(recent.path),
          isActiveProject: recent.path === props.activeProjectPath,
          status: stats?.status ?? 'unindexed',
          sliceCount: stats?.sliceCount,
          cardCount: stats?.cardCount,
        });
      }
    }

    for (const folder of props.mountedFolders) {
      if (!map.has(folder)) {
        const stats = props.projectStats?.[folder];
        map.set(folder, {
          path: folder,
          name: getFolderBasename(folder),
          isActiveProject: folder === props.activeProjectPath,
          status: stats?.status ?? 'unindexed',
          sliceCount: stats?.sliceCount,
          cardCount: stats?.cardCount,
        });
      }
    }

    return Array.from(map.values());
  }, [props.activeProjectPath, props.recentProjects, props.mountedFolders, props.projectStats]);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projectItems;
    return projectItems.filter(
      (item) => item.name.toLowerCase().includes(q) || item.path.toLowerCase().includes(q),
    );
  }, [projectItems, query]);

  async function handlePickFolder(): Promise<void> {
    const picked = await pickProjectDirectory();
    if (picked) {
      props.onMountFolder(picked);
      props.onSelectProject(picked);
    }
  }

  return (
    <aside className="knowledge-master-sidebar" data-testid="knowledge-project-list">
      <div className="knowledge-sidebar-header">
        <span className="knowledge-sidebar-title">{t('Knowledge Bases', '知识库 / 目录')}</span>
        <div className="knowledge-sidebar-header-actions">
          {props.onConfigureEmbedding ? (
            <IconButton
              label={t('Embedding settings…', '设置 Embedding 模型…')}
              onClick={props.onConfigureEmbedding}
              data-testid="configure-embedding-btn"
            >
              <IconSettings width={13} height={13} />
            </IconButton>
          ) : null}
          <IconButton
            label={t('Mount local directory', '挂载本地目录')}
            onClick={() => void handlePickFolder()}
            data-testid="mount-folder-btn"
          >
            <IconPlus width={14} height={14} />
          </IconButton>
        </div>
      </div>

      <div className="knowledge-sidebar-search">
        <TextInput
          placeholder={t('Filter repositories...', '过滤项目与知识库...')}
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          className="knowledge-search-input"
        />
      </div>

      <div className="knowledge-project-scroll">
        {filteredItems.length === 0 ? (
          <div className="knowledge-empty-hint muted">
            {t('No matching repositories', '暂无匹配的项目')}
          </div>
        ) : (
          <ul className="knowledge-project-items">
            {filteredItems.map((item) => {
              const isSelected = item.path === props.selectedPath;
              return (
                <li key={item.path}>
                  <button
                    type="button"
                    className={`knowledge-project-row${isSelected ? ' selected' : ''}`}
                    onClick={() => props.onSelectProject(item.path)}
                    data-testid={`project-item-${item.name}`}
                  >
                    <div className="knowledge-project-icon">
                      {isSelected ? (
                        <IconFolderOpen width={15} height={15} />
                      ) : (
                        <IconFolder width={15} height={15} />
                      )}
                    </div>
                    <div className="knowledge-project-info">
                      <div className="knowledge-project-name-row">
                        <span className="knowledge-project-name">{item.name}</span>
                        {item.isActiveProject ? (
                          <span className="knowledge-project-badge active">
                            {t('Active', '当前')}
                          </span>
                        ) : null}
                      </div>
                      <div className="knowledge-project-meta">
                        {item.status === 'ready' ? (
                          <span className="meta-ready">
                            {typeof item.sliceCount === 'number'
                              ? `${item.sliceCount} ${t('slices', '切片')} · `
                              : ''}
                            {typeof item.cardCount === 'number'
                              ? `${item.cardCount} ${t('cards', '闪卡')}`
                              : t('Ready', '已就绪')}
                          </span>
                        ) : item.status === 'indexing' ? (
                          <span className="meta-indexing">{t('Indexing...', '索引中...')}</span>
                        ) : (
                          <span className="meta-unindexed">{t('Not indexed', '未索引')}</span>
                        )}
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="knowledge-sidebar-footer">
        <Button
          variant="secondary"
          size="compact"
          onClick={() => void handlePickFolder()}
          className="knowledge-mount-btn"
          data-testid="sidebar-add-folder-btn"
        >
          <IconPlus width={12} height={12} />
          <span>{t('Mount Local Directory...', '挂载其他本地目录...')}</span>
        </Button>
      </div>
    </aside>
  );
}
