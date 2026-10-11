/**
 * Host directory browser: sidebar + column view, same shape as the OS
 * "Open workspace" window.
 */
import { type PointerEvent as ReactPointerEvent, type ReactElement } from 'react';
import {
  IconArrowUp,
  IconChevronLeft,
  IconChevronRight,
  IconDocument,
  IconDownload,
  IconFolder,
  IconGrid,
  IconLaptop,
  IconSearch,
} from './shell-icons';
import {
  HOST_PICKER_COLUMN_MAX,
  HOST_PICKER_COLUMN_MIN,
  HOST_PICKER_SIDEBAR_MAX,
  HOST_PICKER_SIDEBAR_MIN,
  type HostPickerSidebarItem,
} from './host-workspace-picker-nav.js';
import { Button } from '@piwin/ui-kit';
import { HostWorkspacePickerColumns } from './host-workspace-picker-columns.js';
import {
  HostWorkspacePickerFileMenu,
  type HostPickerMenuActions,
} from './host-workspace-picker-menu.js';
import { HostWorkspacePickerCreateDialog } from './host-workspace-picker-create-dialog.js';
import { useHostPickerCreation } from './use-host-picker-creation.js';
import { useHostWorkspacePicker } from './use-host-workspace-picker.js';
import { useHostWorkspacePickerResize } from './use-host-workspace-picker-resize.js';
import type { HostWorkspacePickerProps } from './host-workspace-picker-types.js';
export type { HostWorkspacePickerProps } from './host-workspace-picker-types.js';

function favoriteIcon(name: string): ReactElement {
  switch (name) {
    case 'Desktop':
      return <IconLaptop width={14} height={14} />;
    case 'Documents':
      return <IconDocument width={14} height={14} />;
    case 'Downloads':
      return <IconDownload width={14} height={14} />;
    case 'Applications':
      return <IconGrid width={14} height={14} />;
    default:
      return <IconFolder width={14} height={14} />;
  }
}

function homeLabel(homePath: string, zh: boolean): string {
  const parts = homePath.split(/[/\\]/).filter(Boolean);
  const last = parts[parts.length - 1];
  return last ?? (zh ? '主目录' : 'Home');
}

function ResizeHandle(props: {
  testId: string;
  label: string;
  kind: 'column' | 'corner';
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
}): ReactElement {
  return (
    <div
      className={props.kind === 'corner' ? 'host-workspace-resize-grip' : 'host-workspace-resizer'}
      data-testid={props.testId}
      role="separator"
      aria-label={props.label}
      aria-orientation={props.kind === 'corner' ? 'horizontal' : 'vertical'}
      onPointerDown={props.onPointerDown}
    />
  );
}

export function HostWorkspacePicker(props: HostWorkspacePickerProps): ReactElement {
  const zh = props.locale === 'zh-CN';
  const pickerMode = props.mode ?? 'directory';
  const {
    columns,
    homeListing,
    search,
    setSearch,
    loading,
    error,
    history,
    setHistory,
    pathDraft,
    setPathDraft,
    pathDraftDirty,
    columnsRef,
    directoryPath,
    confirmPath,
    openDisabled,
    favorites,
    locations,
    recents,
    focusPath,
    revealPath,
    openEntry,
    jumpTo,
    includeHidden,
    creating,
    refreshDirectory,
    toggleHidden,
    createEntry,
  } = useHostWorkspacePicker(props);
  const {
    sidebarWidth,
    setSidebarWidth,
    setColumnWidthByPath,
    layoutResizing,
    rootRef,
    columnWidth,
    onHorizontalResizePointerDown,
    onDialogResizePointerDown,
  } = useHostWorkspacePickerResize();
  const busy = loading || creating;
  const creation = useHostPickerCreation(props.locale, createEntry);
  const menuActions: HostPickerMenuActions = {
    locale: props.locale,
    busy,
    canCreate: Boolean(props.createEntry),
    includeHidden,
    onCreate: creation.start,
    onRefresh: (path) => void refreshDirectory(path),
    onToggleHidden: () => void toggleHidden(),
  };
  const sidebarHome: HostPickerSidebarItem | null = homeListing
    ? { name: homeLabel(homeListing.homePath, zh), path: homeListing.homePath }
    : null;

  const canBack = history.index > 0;
  const canForward = history.index >= 0 && history.index < history.paths.length - 1;
  const parentPath = columns[columns.length - 1]?.parentPath;

  return (
    <div
      ref={rootRef}
      className={`host-workspace-picker${layoutResizing ? ' is-resizing' : ''}`}
      data-testid="host-workspace-picker"
    >
      <header className="host-workspace-chrome" inert={creating}>
        <div className="host-workspace-toolbar">
          <button
            type="button"
            className="host-workspace-nav-btn"
            disabled={!canBack || busy}
            data-testid="host-workspace-back"
            aria-label={zh ? '后退到上一位置' : 'Back to previous location'}
            title={zh ? '后退到上一位置' : 'Back to previous location'}
            onClick={() => {
              const path = history.paths[history.index - 1];
              if (!path) {
                return;
              }
              pathDraftDirty.current = false;
              setHistory((prev) => ({ ...prev, index: prev.index - 1 }));
              void revealPath(path, { history: false });
            }}
          >
            <IconChevronLeft width={14} height={14} />
          </button>
          <button
            type="button"
            className="host-workspace-nav-btn"
            disabled={!canForward || busy}
            data-testid="host-workspace-forward"
            aria-label={zh ? '前进到下一位置' : 'Forward to next location'}
            title={zh ? '前进到下一位置' : 'Forward to next location'}
            onClick={() => {
              const path = history.paths[history.index + 1];
              if (!path) {
                return;
              }
              pathDraftDirty.current = false;
              setHistory((prev) => ({ ...prev, index: prev.index + 1 }));
              void revealPath(path, { history: false });
            }}
          >
            <IconChevronRight width={14} height={14} />
          </button>
          <button
            type="button"
            className="host-workspace-nav-btn"
            disabled={!parentPath || busy}
            data-testid="host-workspace-up"
            aria-label={zh ? '上一级文件夹' : 'Parent folder'}
            title={zh ? '上一级文件夹' : 'Parent folder'}
            onClick={() => {
              if (parentPath) void jumpTo(parentPath);
            }}
          >
            <IconArrowUp width={14} height={14} />
          </button>
          <input
            className="host-workspace-path-input"
            data-testid="project-path-input"
            value={pathDraft}
            spellCheck={false}
            onChange={(event) => {
              pathDraftDirty.current = true;
              setPathDraft(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void jumpTo(pathDraft.trim());
              }
            }}
            aria-label={zh ? '路径' : 'Path'}
          />
          <label className="host-workspace-search">
            <IconSearch width={14} height={14} />
            <input
              data-testid="host-workspace-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={zh ? '搜索' : 'Search'}
              spellCheck={false}
            />
          </label>
          <HostWorkspacePickerFileMenu actions={menuActions} column={columns[columns.length - 1]} />
        </div>
      </header>
      <div className="host-workspace-body" inert={creating}>
        <nav
          className="host-workspace-sidebar"
          aria-label={zh ? '位置' : 'Locations'}
          style={{ flexBasis: sidebarWidth, width: sidebarWidth, minWidth: sidebarWidth }}
        >
          <div className="host-workspace-sidebar-scroll">
            {recents.length > 0 ? (
              <div className="host-workspace-sidebar-group">
                <p>{zh ? '最近' : 'Recents'}</p>
                {recents.map((path) => {
                  const name = path.split(/[/\\]/).filter(Boolean).pop() ?? path;
                  return (
                    <button
                      key={path}
                      type="button"
                      className={directoryPath === path ? 'is-active' : undefined}
                      title={path}
                      onClick={() => void jumpTo(path)}
                    >
                      <IconFolder width={14} height={14} />
                      <span>{name}</span>
                    </button>
                  );
                })}
              </div>
            ) : null}
            {favorites.length > 0 ? (
              <div className="host-workspace-sidebar-group">
                <p>{zh ? '常用' : 'Favorites'}</p>
                {favorites.map((item) => (
                  <button
                    key={item.path}
                    type="button"
                    className={directoryPath === item.path ? 'is-active' : undefined}
                    title={item.path}
                    onClick={() => void jumpTo(item.path)}
                  >
                    {favoriteIcon(item.name)}
                    <span>{item.name}</span>
                  </button>
                ))}
              </div>
            ) : null}
            <div className="host-workspace-sidebar-group">
              <p>{zh ? '位置' : 'Locations'}</p>
              {sidebarHome ? (
                <button
                  type="button"
                  className={directoryPath === sidebarHome.path ? 'is-active' : undefined}
                  data-testid="host-workspace-home"
                  title={sidebarHome.path}
                  onClick={() => void jumpTo(sidebarHome.path)}
                >
                  <IconLaptop width={14} height={14} />
                  <span>{sidebarHome.name}</span>
                </button>
              ) : null}
              {locations.map((location) => (
                <button
                  key={location.path}
                  type="button"
                  className={directoryPath === location.path ? 'is-active' : undefined}
                  data-testid="host-workspace-location"
                  title={location.path}
                  onClick={() => void jumpTo(location.path)}
                >
                  {location.path === '/' ? (
                    <IconLaptop width={14} height={14} />
                  ) : (
                    <IconFolder width={14} height={14} />
                  )}
                  <span>
                    {location.path === '/' ? (zh ? '根目录' : 'Computer') : location.name}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <ResizeHandle
            testId="host-workspace-sidebar-resizer"
            label={zh ? '调整侧栏宽度' : 'Resize sidebar'}
            kind="column"
            onPointerDown={(event) =>
              onHorizontalResizePointerDown(
                event,
                sidebarWidth,
                HOST_PICKER_SIDEBAR_MIN,
                HOST_PICKER_SIDEBAR_MAX,
                setSidebarWidth,
              )
            }
          />
        </nav>
        <HostWorkspacePickerColumns
          locale={props.locale}
          mode={pickerMode}
          columns={columns}
          columnsRef={columnsRef}
          search={search}
          focusPath={focusPath}
          loading={loading}
          error={error}
          actions={menuActions}
          columnWidth={columnWidth}
          openEntry={openEntry}
          onConfirm={props.onConfirm}
          renderResizer={(path, width) => (
            <ResizeHandle
              testId="host-workspace-col-resizer"
              label={zh ? '调整列宽' : 'Resize column'}
              kind="column"
              onPointerDown={(event) =>
                onHorizontalResizePointerDown(
                  event,
                  width,
                  HOST_PICKER_COLUMN_MIN,
                  HOST_PICKER_COLUMN_MAX,
                  (next) => setColumnWidthByPath((previous) => ({ ...previous, [path]: next })),
                )
              }
            />
          )}
        />
      </div>
      <footer className="host-workspace-footer">
        <Button variant="ghost" size="compact" disabled={creating} onClick={props.onCancel}>
          {zh ? '取消' : 'Cancel'}
        </Button>
        <Button
          variant="primary"
          size="compact"
          data-testid="open-project-btn"
          disabled={openDisabled || creation.draft !== null}
          onClick={() => props.onConfirm(confirmPath)}
        >
          {pickerMode === 'file' ? (zh ? '选择' : 'Choose') : zh ? '打开' : 'Open'}
        </Button>
      </footer>
      <HostWorkspacePickerCreateDialog locale={props.locale} creation={creation} />
      <ResizeHandle
        testId="host-workspace-dialog-resizer"
        label={zh ? '调整窗口大小' : 'Resize window'}
        kind="corner"
        onPointerDown={onDialogResizePointerDown}
      />
    </div>
  );
}
