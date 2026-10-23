import type { ReactElement, RefObject } from 'react';
import type { HostDirEntry, HostListDirData } from '@piwin/contracts';
import { IconChevronRight, IconFile, IconFolder } from '../tool-cards/shell-icons.js';
import {
  filterColumnEntries,
  pickerRowSelected,
  sortPickerEntries,
} from './host-workspace-picker-nav.js';
import {
  HostWorkspacePickerColumnMenu,
  type HostPickerMenuActions,
} from './host-workspace-picker-menu.js';

export function HostWorkspacePickerColumns(props: {
  locale: 'zh-CN' | 'en';
  mode: 'directory' | 'file';
  columns: HostListDirData[];
  columnsRef: RefObject<HTMLDivElement | null>;
  search: string;
  focusPath: string;
  loading: boolean;
  error: string | null;
  actions: HostPickerMenuActions;
  columnWidth: (path: string) => number;
  openEntry: (entry: HostDirEntry, index: number) => Promise<void>;
  onConfirm: (path: string) => void;
  renderResizer: (path: string, width: number) => ReactElement;
}): ReactElement {
  const {
    columns,
    columnsRef,
    search,
    focusPath,
    loading,
    error,
    actions,
    columnWidth,
    openEntry,
    onConfirm,
    renderResizer,
  } = props;
  const zh = props.locale === 'zh-CN';
  const pickerMode = props.mode;
  const lastColumnIndex = columns.length - 1;
  return (
    <div className="host-workspace-columns" role="list" ref={columnsRef}>
      {error ? (
        <p className="muted host-workspace-error" role="alert" data-testid="host-workspace-error">
          {error}
        </p>
      ) : null}
      {loading && columns.length === 0 ? (
        <p className="muted host-workspace-error">{zh ? '正在列出文件夹…' : 'Listing folders…'}</p>
      ) : null}
      {columns.map((column, columnIndex) => {
        const isLast = columnIndex === lastColumnIndex;
        const width = columnWidth(column.path);
        const entries = sortPickerEntries(
          isLast ? filterColumnEntries(column.entries, search) : column.entries,
        );
        return (
          <HostWorkspacePickerColumnMenu
            key={`${column.path}:${columnIndex}`}
            actions={actions}
            column={column}
            columns={columns}
            onOpenFolder={(entry) => void openEntry(entry, columnIndex)}
          >
            {(onContextMenuCapture) => (
              <div
                className={`host-workspace-column${isLast ? ' is-last' : ''}`}
                data-testid="host-workspace-column"
                onContextMenuCapture={onContextMenuCapture}
                role="listbox"
                aria-label={column.path}
                style={
                  isLast
                    ? { flex: `1 0 ${width}px`, minWidth: width }
                    : { flex: `0 0 ${width}px`, width, minWidth: width }
                }
              >
                <div className="host-workspace-column-scroll">
                  {entries.length === 0 ? (
                    <p className="muted host-workspace-empty">
                      {zh ? '没有可打开的项目' : 'Nothing to open'}
                    </p>
                  ) : (
                    entries.map((entry) => {
                      const selected = pickerRowSelected(entry, focusPath);
                      const isDir = entry.kind === 'directory';
                      return (
                        <button
                          key={entry.path}
                          type="button"
                          className={`host-workspace-row${selected ? ' is-selected' : ''}${
                            isDir ? '' : ' is-file'
                          }`}
                          data-testid={isDir ? 'host-workspace-dir' : 'host-workspace-file'}
                          data-host-entry-path={entry.path}
                          role="option"
                          aria-selected={selected}
                          title={entry.name}
                          onClick={() => {
                            void openEntry(entry, columnIndex);
                          }}
                          onDoubleClick={() => {
                            if (isDir) {
                              if (pickerMode === 'directory') {
                                onConfirm(entry.path);
                              }
                              return;
                            }
                            if (pickerMode === 'file') {
                              onConfirm(entry.path);
                            }
                          }}
                        >
                          {isDir ? (
                            <IconFolder width={14} height={14} />
                          ) : (
                            <IconFile width={14} height={14} />
                          )}
                          <span>{entry.name}</span>
                          {isDir ? <IconChevronRight width={10} height={10} /> : null}
                        </button>
                      );
                    })
                  )}
                </div>
                {isLast ? null : renderResizer(column.path, width)}
              </div>
            )}
          </HostWorkspacePickerColumnMenu>
        );
      })}
    </div>
  );
}
