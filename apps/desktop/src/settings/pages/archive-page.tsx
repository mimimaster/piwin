/**
 * Settings → Archive Management page.
 * View, search, filter, restore, and permanently delete archived sessions across all scopes.
 */
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import type { SessionListData, SessionSummary } from '@piwin/contracts';
import { Button, IconButton, Select, Spinner, TextInput } from '@piwin/ui-kit';
import { useDesktopLocale } from '../../desktop-locale-context';
import { useConfirmDialog } from '../../use-confirm-dialog';
import {
  IconArchive,
  IconChat,
  IconFolder,
  IconRefresh,
  IconSearch,
  IconTrash,
  IconUnarchive,
} from '../../shell-icons';
import { PageTitle } from '../page-title';
import { useSettings } from '../settings-context';

function formatTimestamp(isoString: string | undefined, isZh: boolean): string {
  if (!isoString) return '';
  try {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return isoString;
    return date.toLocaleString(isZh ? 'zh-CN' : 'en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return isoString;
  }
}

function getProjectDisplayName(projectPath: string | undefined): string {
  if (!projectPath) return '';
  const normalized = projectPath.replace(/[/\\]+$/, '');
  const segments = normalized.split(/[/\\]/);
  return segments[segments.length - 1] || projectPath;
}

function getSessionProjectPath(session: SessionSummary): string | undefined {
  if (session.scope?.kind === 'project') {
    return session.scope.projectPath;
  }
  return session.projectPath || undefined;
}

export function ArchivePage(): ReactElement {
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';
  const { request, setError, setInfo } = useSettings();
  const { confirm, dialog: confirmModal, setBusy: setConfirmBusy } = useConfirmDialog();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [scopeFilter, setScopeFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'archivedAt' | 'updatedAt' | 'name'>('archivedAt');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  const loadArchivedSessions = useCallback(
    async (isManualRefresh = false) => {
      if (isManualRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      try {
        const response = await request({
          type: 'session/list',
          allScopes: true,
          includeArchived: true,
        });
        if (!response.success) {
          setError(response.error);
          return;
        }
        const data = response.data as SessionListData | undefined;
        const allSessions = data?.sessions ?? [];
        const archivedOnly = allSessions.filter((session) => session.isArchived === true);
        setSessions(archivedOnly);
        // Prune any selected ids that no longer exist
        setSelectedIds((prev) => {
          const next = new Set<string>();
          const currentIds = new Set(archivedOnly.map((s) => s.id));
          for (const id of prev) {
            if (currentIds.has(id)) {
              next.add(id);
            }
          }
          return next;
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [request, setError],
  );

  useEffect(() => {
    void loadArchivedSessions();
  }, [loadArchivedSessions]);

  // Extract unique project scopes for filter dropdown
  const scopeOptions = useMemo(() => {
    const options = [
      { value: 'all', label: isZh ? '全部范围' : 'All scopes' },
      { value: 'general', label: isZh ? '通用工作区' : 'General workspace' },
    ];
    const projectPaths = new Set<string>();
    for (const session of sessions) {
      const pp = getSessionProjectPath(session);
      if (pp) {
        projectPaths.add(pp);
      }
    }
    for (const p of Array.from(projectPaths).sort()) {
      const displayName = getProjectDisplayName(p);
      options.push({
        value: p,
        label: `${isZh ? '项目: ' : 'Project: '}${displayName}`,
      });
    }
    return options;
  }, [sessions, isZh]);

  // Filtered and sorted sessions
  const filteredSessions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return sessions
      .filter((session) => {
        // Scope filter
        if (scopeFilter !== 'all') {
          if (scopeFilter === 'general') {
            const isGeneral = session.scope?.kind === 'general' || !session.projectPath;
            if (!isGeneral) return false;
          } else {
            const matchProject = getSessionProjectPath(session) === scopeFilter;
            if (!matchProject) return false;
          }
        }
        // Search query
        if (query) {
          const name = (session.name ?? '').toLowerCase();
          const preview = (session.lastPreview ?? '').toLowerCase();
          const id = session.id.toLowerCase();
          const project = (session.projectPath ?? '').toLowerCase();
          if (
            !name.includes(query) &&
            !preview.includes(query) &&
            !id.includes(query) &&
            !project.includes(query)
          ) {
            return false;
          }
        }
        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'name') {
          return (a.name ?? a.id).localeCompare(b.name ?? b.id);
        }
        if (sortBy === 'updatedAt') {
          return b.updatedAt.localeCompare(a.updatedAt);
        }
        // default: archivedAt desc (fallback to updatedAt)
        const aTime = a.archivedAt ?? a.updatedAt;
        const bTime = b.archivedAt ?? b.updatedAt;
        return bTime.localeCompare(aTime);
      });
  }, [sessions, scopeFilter, searchQuery, sortBy]);

  const allFilteredSelected = useMemo(() => {
    if (filteredSessions.length === 0) return false;
    return filteredSessions.every((s) => selectedIds.has(s.id));
  }, [filteredSessions, selectedIds]);

  const handleToggleSelectAll = useCallback(() => {
    if (allFilteredSelected) {
      // Deselect all visible
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const s of filteredSessions) {
          next.delete(s.id);
        }
        return next;
      });
    } else {
      // Select all visible
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const s of filteredSessions) {
          next.add(s.id);
        }
        return next;
      });
    }
  }, [allFilteredSelected, filteredSessions]);

  const handleToggleSelectOne = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // Single restore
  const handleRestore = useCallback(
    async (session: SessionSummary) => {
      if (actionInProgress) return;
      setActionInProgress(session.id);
      try {
        const response = await request({
          type: 'session/unarchive',
          sessionId: session.id,
        });
        if (!response.success) {
          setError(response.error);
          return;
        }
        setSessions((prev) => prev.filter((s) => s.id !== session.id));
        setSelectedIds((prev) => {
          const next = new Set(prev);
          next.delete(session.id);
          return next;
        });
        const name = session.name ?? session.id;
        setInfo(
          isZh ? `已还原会话「${name}」` : `Restored session "${name}"`,
          'success',
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setActionInProgress(null);
      }
    },
    [actionInProgress, isZh, request, setError, setInfo],
  );

  // Single delete
  const handleDelete = useCallback(
    async (session: SessionSummary) => {
      if (actionInProgress) return;
      const name = session.name ?? session.id;
      const confirmed = await confirm({
        title: isZh ? '彻底删除归档会话' : 'Delete Archived Session',
        description: isZh
          ? `确定要彻底删除会话「${name}」吗？此操作不可撤销，所有对话记录将被永久删除。`
          : `Are you sure you want to permanently delete session "${name}"? This action cannot be undone.`,
        confirmLabel: isZh ? '彻底删除' : 'Delete permanently',
        tone: 'danger',
        affectedObject: name,
        skipKey: 'archive-delete',
        dontAskAgainLabel: isZh ? '不再询问' : "Don't ask again",
      });
      if (!confirmed) return;

      setActionInProgress(session.id);
      setConfirmBusy(true);
      try {
        const response = await request({
          type: 'session/delete',
          sessionId: session.id,
        });
        if (!response.success) {
          setError(response.error);
          return;
        }
        setSessions((prev) => prev.filter((s) => s.id !== session.id));
        setSelectedIds((prev) => {
          const next = new Set(prev);
          next.delete(session.id);
          return next;
        });
        setInfo(
          isZh ? `已彻底删除会话「${name}」` : `Deleted session "${name}"`,
          'success',
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setActionInProgress(null);
        setConfirmBusy(false);
      }
    },
    [actionInProgress, confirm, isZh, request, setConfirmBusy, setError, setInfo],
  );

  // Batch restore
  const handleBatchRestore = useCallback(async () => {
    if (actionInProgress) return;
    const targetSessions = filteredSessions.filter((s) => selectedIds.has(s.id));
    if (targetSessions.length === 0) return;

    setActionInProgress('batch-restore');
    let successCount = 0;
    const failedErrors: string[] = [];

    try {
      const results = await Promise.allSettled(
        targetSessions.map((session) =>
          request({
            type: 'session/unarchive',
            sessionId: session.id,
          }),
        ),
      );

      const restoredIds = new Set<string>();
      results.forEach((res, index) => {
        const target = targetSessions[index];
        if (!target) return;
        if (res.status === 'fulfilled' && res.value.success) {
          restoredIds.add(target.id);
          successCount++;
        } else if (res.status === 'fulfilled' && !res.value.success) {
          failedErrors.push(res.value.error);
        } else if (res.status === 'rejected') {
          failedErrors.push(String(res.reason));
        }
      });

      if (restoredIds.size > 0) {
        setSessions((prev) => prev.filter((s) => !restoredIds.has(s.id)));
        setSelectedIds((prev) => {
          const next = new Set(prev);
          for (const id of restoredIds) {
            next.delete(id);
          }
          return next;
        });
        setInfo(
          isZh ? `已成功还原 ${successCount} 个会话` : `Successfully restored ${successCount} sessions`,
          'success',
        );
      }
      if (failedErrors.length > 0) {
        setError(
          isZh
            ? `部分会话还原失败 (${failedErrors.length} 个): ${failedErrors[0]}`
            : `Failed to restore ${failedErrors.length} sessions: ${failedErrors[0]}`,
        );
      }
    } finally {
      setActionInProgress(null);
    }
  }, [actionInProgress, filteredSessions, isZh, request, selectedIds, setError, setInfo]);

  // Batch delete
  const handleBatchDelete = useCallback(async () => {
    if (actionInProgress) return;
    const targetSessions = filteredSessions.filter((s) => selectedIds.has(s.id));
    if (targetSessions.length === 0) return;

    const count = targetSessions.length;
    const confirmed = await confirm({
      title: isZh ? '批量删除归档会话' : 'Batch Delete Archived Sessions',
      description: isZh
        ? `确定要彻底删除选中的 ${count} 个归档会话吗？此操作不可撤销，所有对话记录将被永久删除。`
        : `Are you sure you want to permanently delete the ${count} selected archived sessions? This action cannot be undone.`,
      confirmLabel: isZh ? `彻底删除 (${count})` : `Delete (${count})`,
      tone: 'danger',
      skipKey: 'archive-delete',
      dontAskAgainLabel: isZh ? '不再询问' : "Don't ask again",
    });
    if (!confirmed) return;

    setActionInProgress('batch-delete');
    setConfirmBusy(true);
    let successCount = 0;
    const failedErrors: string[] = [];

    try {
      const results = await Promise.allSettled(
        targetSessions.map((session) =>
          request({
            type: 'session/delete',
            sessionId: session.id,
          }),
        ),
      );

      const deletedIds = new Set<string>();
      results.forEach((res, index) => {
        const target = targetSessions[index];
        if (!target) return;
        if (res.status === 'fulfilled' && res.value.success) {
          deletedIds.add(target.id);
          successCount++;
        } else if (res.status === 'fulfilled' && !res.value.success) {
          failedErrors.push(res.value.error);
        } else if (res.status === 'rejected') {
          failedErrors.push(String(res.reason));
        }
      });

      if (deletedIds.size > 0) {
        setSessions((prev) => prev.filter((s) => !deletedIds.has(s.id)));
        setSelectedIds((prev) => {
          const next = new Set(prev);
          for (const id of deletedIds) {
            next.delete(id);
          }
          return next;
        });
        setInfo(
          isZh ? `已彻底删除 ${successCount} 个会话` : `Successfully deleted ${successCount} sessions`,
          'success',
        );
      }
      if (failedErrors.length > 0) {
        setError(
          isZh
            ? `部分会话删除失败 (${failedErrors.length} 个): ${failedErrors[0]}`
            : `Failed to delete ${failedErrors.length} sessions: ${failedErrors[0]}`,
        );
      }
    } finally {
      setActionInProgress(null);
      setConfirmBusy(false);
    }
  }, [actionInProgress, confirm, filteredSessions, isZh, request, selectedIds, setConfirmBusy, setError, setInfo]);

  // Empty all
  const handleEmptyAll = useCallback(async () => {
    if (actionInProgress || sessions.length === 0) return;
    const count = sessions.length;
    const confirmed = await confirm({
      title: isZh ? '清空全部归档会话' : 'Empty All Archived Sessions',
      description: isZh
        ? `确定要彻底删除全部 ${count} 个归档会话吗？此操作不可撤销，所有对话数据将被永久删除。`
        : `Are you sure you want to permanently delete all ${count} archived sessions? This action cannot be undone.`,
      confirmLabel: isZh ? `清空全部 (${count})` : `Delete all (${count})`,
      tone: 'danger',
    });
    if (!confirmed) return;

    setActionInProgress('empty-all');
    setConfirmBusy(true);
    let successCount = 0;
    const failedErrors: string[] = [];

    try {
      const results = await Promise.allSettled(
        sessions.map((session) =>
          request({
            type: 'session/delete',
            sessionId: session.id,
          }),
        ),
      );

      const deletedIds = new Set<string>();
      results.forEach((res, index) => {
        const target = sessions[index];
        if (!target) return;
        if (res.status === 'fulfilled' && res.value.success) {
          deletedIds.add(target.id);
          successCount++;
        } else if (res.status === 'fulfilled' && !res.value.success) {
          failedErrors.push(res.value.error);
        } else if (res.status === 'rejected') {
          failedErrors.push(String(res.reason));
        }
      });

      if (deletedIds.size > 0) {
        setSessions((prev) => prev.filter((s) => !deletedIds.has(s.id)));
        setSelectedIds(new Set());
        setInfo(
          isZh ? `已清空 ${successCount} 个归档会话` : `Cleared ${successCount} archived sessions`,
          'success',
        );
      }
      if (failedErrors.length > 0) {
        setError(
          isZh
            ? `清空过程中有 ${failedErrors.length} 个会话删除失败`
            : `Failed to delete ${failedErrors.length} sessions during clear`,
        );
      }
    } finally {
      setActionInProgress(null);
      setConfirmBusy(false);
    }
  }, [actionInProgress, confirm, isZh, request, sessions, setConfirmBusy, setError, setInfo]);

  const selectedCount = selectedIds.size;
  const isBusy = actionInProgress !== null;

  return (
    <div className="settings-card archive-page-container" data-testid="archive-management-page">
      <div className="settings-section settings-section-card">
        <PageTitle
          title={isZh ? '归档管理' : 'Archive Management'}
          description={
            isZh
              ? '集中管理已归档的历史会话。你可以将归档会话还原回工作区继续对话，或彻底删除无用的历史数据以释放存储。'
              : 'Manage archived historical sessions. Restore them back to your workspace to continue chatting, or permanently delete unneeded records.'
          }
        />

        <div className="archive-toolbar">
          <div className="archive-filters">
            <TextInput
              testId="archive-search-input"
              className="archive-search-input"
              placeholder={isZh ? '搜索会话名称、预览内容…' : 'Search name, preview…'}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.currentTarget.value)}
              leftSection={<IconSearch width={14} height={14} />}
            />

            {scopeOptions.length > 2 ? (
              <Select
                testId="archive-scope-select"
                className="archive-scope-select"
                value={scopeFilter}
                onChange={(e) => setScopeFilter(e.currentTarget.value)}
                data={scopeOptions}
                aria-label={isZh ? '工作区范围筛选' : 'Scope filter'}
              />
            ) : null}

            <Select
              testId="archive-sort-select"
              className="archive-sort-select"
              value={sortBy}
              onChange={(e) =>
                setSortBy(e.currentTarget.value as 'archivedAt' | 'updatedAt' | 'name')
              }
              data={[
                { value: 'archivedAt', label: isZh ? '按归档时间倒序' : 'Archived (newest)' },
                { value: 'updatedAt', label: isZh ? '按更新时间倒序' : 'Updated (newest)' },
                { value: 'name', label: isZh ? '按名称排序' : 'Name (A-Z)' },
              ]}
              aria-label={isZh ? '排序方式' : 'Sort order'}
            />
          </div>

          <div className="archive-toolbar-actions">
            <IconButton
              data-testid="archive-refresh-button"
              label={isZh ? '刷新归档列表' : 'Refresh archive list'}
              onClick={() => void loadArchivedSessions(true)}
              disabled={loading || refreshing || isBusy}
            >
              <IconRefresh width={15} height={15} />
            </IconButton>

            {sessions.length > 0 ? (
              <Button
                variant="ghost"
                data-testid="archive-empty-all-button"
                onClick={() => void handleEmptyAll()}
                disabled={loading || refreshing || isBusy}
                style={{ color: 'var(--danger, #e05252)' }}
              >
                {isZh ? '清空归档' : 'Empty archive'}
              </Button>
            ) : null}
          </div>
        </div>

        {/* Batch action bar */}
        {filteredSessions.length > 0 ? (
          <div className="archive-batch-bar" data-testid="archive-batch-bar">
            <div className="archive-batch-left">
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  className="archive-item-checkbox"
                  data-testid="archive-select-all-checkbox"
                  checked={allFilteredSelected}
                  onChange={handleToggleSelectAll}
                  disabled={isBusy}
                />
                <span>
                  {selectedCount > 0
                    ? isZh
                      ? `已选 ${selectedCount} / 共 ${filteredSessions.length} 个会话`
                      : `Selected ${selectedCount} of ${filteredSessions.length}`
                    : isZh
                      ? `全选当前列表 (${filteredSessions.length})`
                      : `Select all (${filteredSessions.length})`}
                </span>
              </label>
            </div>

            {selectedCount > 0 ? (
              <div className="archive-batch-actions">
                <Button
                  data-testid="archive-batch-restore-button"
                  variant="primary"
                  onClick={() => void handleBatchRestore()}
                  disabled={isBusy}
                >
                  <IconUnarchive width={14} height={14} style={{ marginRight: 6 }} />
                  {isZh ? `还原所选 (${selectedCount})` : `Restore (${selectedCount})`}
                </Button>
                <Button
                  data-testid="archive-batch-delete-button"
                  variant="ghost"
                  onClick={() => void handleBatchDelete()}
                  disabled={isBusy}
                  style={{ color: 'var(--danger, #e05252)' }}
                >
                  <IconTrash width={14} height={14} style={{ marginRight: 6 }} />
                  {isZh ? `删除所选 (${selectedCount})` : `Delete (${selectedCount})`}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Content list or empty/loading state */}
        {loading ? (
          <div className="archive-loading-state" data-testid="archive-loading-state">
            <Spinner />
            <p className="muted">{isZh ? '正在加载归档会话…' : 'Loading archived sessions…'}</p>
          </div>
        ) : filteredSessions.length === 0 ? (
          <div className="archive-empty-container" data-testid="archive-empty-state">
            <IconArchive className="archive-empty-icon" />
            <h3 className="archive-empty-title">
              {sessions.length === 0
                ? isZh
                  ? '暂无归档会话'
                  : 'No archived sessions'
                : isZh
                  ? '没有匹配的归档会话'
                  : 'No matching archived sessions'}
            </h3>
            <p className="archive-empty-desc">
              {sessions.length === 0
                ? isZh
                  ? '当你在侧边栏将不再使用的会话归档，或通过会话归档策略归档会话后，它们会集中显示在此处。'
                  : 'Archived sessions from your workspace or auto-archive policy will be collected here.'
                : isZh
                  ? '请尝试调整搜索关键词或选择其他工作区范围。'
                  : 'Try adjusting your search query or scope filter.'}
            </p>
          </div>
        ) : (
          <div className="archive-list" data-testid="archive-list">
            {filteredSessions.map((session) => {
              const isSelected = selectedIds.has(session.id);
              const isCurrentBusy = actionInProgress === session.id || isBusy;
              const sessionProjectPath = getSessionProjectPath(session);
              const isProject = Boolean(sessionProjectPath);
              const projectDir = getProjectDisplayName(sessionProjectPath);
              const name = session.name || `Session ${session.id.slice(0, 8)}`;
              const archivedTime = session.archivedAt ?? session.updatedAt;

              return (
                <div
                  key={session.id}
                  className={`archive-item-card ${isSelected ? 'selected' : ''}`}
                  data-testid={`archive-item-${session.id}`}
                >
                  <input
                    type="checkbox"
                    className="archive-item-checkbox"
                    data-testid={`archive-item-checkbox-${session.id}`}
                    checked={isSelected}
                    onChange={() => handleToggleSelectOne(session.id)}
                    disabled={isBusy}
                  />

                  <div className="archive-item-main">
                    <div className="archive-item-header">
                      <h4 className="archive-item-title" title={name}>
                        {name}
                      </h4>

                      {isProject ? (
                        <span
                          className="archive-item-scope-badge"
                          title={sessionProjectPath}
                        >
                          <IconFolder width={12} height={12} />
                          {projectDir}
                        </span>
                      ) : (
                        <span className="archive-item-scope-badge">
                          <IconChat width={12} height={12} />
                          {isZh ? '通用工作区' : 'General'}
                        </span>
                      )}
                    </div>

                    <div className="archive-item-meta">
                      <span>{isZh ? `${session.messageCount} 条消息` : `${session.messageCount} msgs`}</span>
                      <span>•</span>
                      <span>{isZh ? `归档于 ${formatTimestamp(archivedTime, isZh)}` : `Archived ${formatTimestamp(archivedTime, isZh)}`}</span>
                      {session.updatedAt && session.updatedAt !== session.archivedAt ? (
                        <>
                          <span>•</span>
                          <span>{isZh ? `更新于 ${formatTimestamp(session.updatedAt, isZh)}` : `Updated ${formatTimestamp(session.updatedAt, isZh)}`}</span>
                        </>
                      ) : null}
                    </div>

                    {session.lastPreview ? (
                      <p className="archive-item-preview" title={session.lastPreview}>
                        {session.lastPreview}
                      </p>
                    ) : null}
                  </div>

                  <div className="archive-item-actions">
                    <Button
                      variant="ghost"
                      data-testid={`archive-restore-btn-${session.id}`}
                      disabled={isCurrentBusy}
                      onClick={() => void handleRestore(session)}
                    >
                      <IconUnarchive width={14} height={14} style={{ marginRight: 5 }} />
                      {isZh ? '还原' : 'Restore'}
                    </Button>
                    <IconButton
                      data-testid={`archive-delete-btn-${session.id}`}
                      label={isZh ? '彻底删除会话' : 'Delete session permanently'}
                      disabled={isCurrentBusy}
                      onClick={() => void handleDelete(session)}
                      style={{ color: 'var(--danger, #e05252)' }}
                    >
                      <IconTrash width={15} height={15} />
                    </IconButton>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {confirmModal}
    </div>
  );
}
