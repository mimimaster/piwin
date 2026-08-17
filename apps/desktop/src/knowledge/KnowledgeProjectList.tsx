/**
 * Left column: Projects and Knowledge Base List.
 * Shows active project, recent projects, and custom mounted folders with index stats.
 */

import { useMemo, useState, type ReactElement } from 'react';
import { Button, IconButton, TextInput } from '@piwin/ui-kit';
import { useDesktopLocale } from '../desktop-locale-context.js';
import { IconFolder, IconFolderOpen, IconPlus } from '../shell-icons.js';
import { pickProjectDirectory } from '../pick-project-directory.js';

export type KnowledgeProjectItem = {
  path: string;
  name: string;
  isActiveProject: boolean;
  status: 'ready' | 'indexing' | 'unindexed';
  fileCount?: number | undefined;
  cardCount?: number | undefined;
};

export type KnowledgeProjectListProps = {
  folders: string[];
  selectedPath: string;
  activeProjectPath: string | null;
  projectStats?: Record<string, { status: 'ready' | 'indexing' | 'unindexed'; fileCount?: number | undefined; cardCount?: number | undefined }> | undefined;
  onSelectProject: (path: string) => void;
  onMountFolder: (path: string) => void;
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

  const projectItems: KnowledgeProjectItem[] = useMemo(() => {
    return props.folders.map((folder) => {
      const stats = props.projectStats?.[folder];
      return {
        path: folder,
        name: getFolderBasename(folder),
        isActiveProject: folder === props.activeProjectPath,
        status: stats?.status ?? 'unindexed',
        fileCount: stats?.fileCount,
        cardCount: stats?.cardCount,
      };
    });
  }, [props.folders, props.activeProjectPath, props.projectStats]);

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
        <span className="knowledge-sidebar-title">{t('Document folders', '文档文件夹')}</span>
        <div className="knowledge-sidebar-header-actions">
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
          placeholder={t('Filter folders…', '过滤文档文件夹…')}
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          className="knowledge-search-input"
        />
      </div>

      <div className="knowledge-project-scroll">
        {filteredItems.length === 0 ? (
          <div className="knowledge-empty-hint muted">
            {t('No matching folders', '暂无匹配的文件夹')}
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
                            {typeof item.fileCount === 'number'
                              ? `${item.fileCount} ${t('files', '个文件')} · `
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
          <span>{t('Add a document folder…', '添加文档文件夹')}</span>
        </Button>
      </div>
    </aside>
  );
}
