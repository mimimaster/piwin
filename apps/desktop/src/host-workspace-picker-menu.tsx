import { useRef, useState, type MouseEventHandler, type ReactElement } from 'react';
import type { HostDirEntry, HostListDirData } from '@piwin/contracts';
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSwitchItem,
  IconButton,
} from '@piwin/ui-kit';
import {
  IconCheck,
  IconEye,
  IconFile,
  IconFolderPlus,
  IconMore,
  IconRefresh,
  IconFolder,
} from './shell-icons.js';

export type HostPickerCreationTarget = Pick<HostListDirData, 'path' | 'entries'>;

export type HostPickerMenuActions = {
  locale: 'zh-CN' | 'en';
  busy: boolean;
  canCreate: boolean;
  includeHidden: boolean;
  onCreate: (kind: HostDirEntry['kind'], column: HostPickerCreationTarget) => void;
  onRefresh: (path: string) => void;
  onToggleHidden: () => void;
};

type MenuProps = { actions: HostPickerMenuActions; column: HostPickerCreationTarget | undefined };

function FileMenuItems(
  props: MenuProps & { context: boolean; onOpenFolder?: () => void },
): ReactElement {
  const { actions, column, context } = props;
  const zh = actions.locale === 'zh-CN';
  const Item = context ? ContextMenuItem : DropdownMenuItem;
  const Label = context ? ContextMenuLabel : DropdownMenuLabel;
  const Separator = context ? ContextMenuSeparator : DropdownMenuSeparator;
  const disabled = actions.busy || !column;
  const folderName = column?.path.split(/[/\\]/).filter(Boolean).pop() ?? column?.path ?? '';
  return (
    <>
      <Label>{zh ? `在「${folderName}」中` : `In “${folderName}”`}</Label>
      {props.onOpenFolder ? (
        <>
          <Item
            testId="host-workspace-context-open"
            onSelect={props.onOpenFolder}
            disabled={actions.busy}
            icon={<IconFolder width={14} height={14} />}
          >
            {zh ? '打开文件夹' : 'Open Folder'}
          </Item>
          <Separator />
        </>
      ) : null}
      {actions.canCreate ? (
        <>
          <Item
            testId="host-workspace-new-folder"
            disabled={disabled}
            icon={<IconFolderPlus width={14} height={14} />}
            onSelect={() => {
              if (column) actions.onCreate('directory', column);
            }}
          >
            {zh ? '新增文件夹' : 'New Folder'}
          </Item>
          <Item
            testId="host-workspace-new-file"
            disabled={disabled}
            icon={<IconFile width={14} height={14} />}
            onSelect={() => {
              if (column) actions.onCreate('file', column);
            }}
          >
            {zh ? '新增文件' : 'New File'}
          </Item>
          {props.onOpenFolder ? null : <Separator />}
        </>
      ) : null}
      {props.onOpenFolder ? null : (
        <>
          <Item
            testId="host-workspace-refresh"
            disabled={disabled}
            icon={<IconRefresh width={14} height={14} />}
            onSelect={() => {
              if (column) actions.onRefresh(column.path);
            }}
          >
            {zh ? '刷新' : 'Refresh'}
          </Item>
          {context ? (
            <Item
              testId="host-workspace-hidden"
              disabled={disabled}
              icon={
                actions.includeHidden ? (
                  <IconCheck width={14} height={14} />
                ) : (
                  <IconEye width={14} height={14} />
                )
              }
              onSelect={actions.onToggleHidden}
            >
              {zh ? '显示隐藏文件' : 'Show Hidden Files'}
            </Item>
          ) : (
            <DropdownMenuSwitchItem
              testId="host-workspace-hidden"
              disabled={disabled}
              checked={actions.includeHidden}
              onCheckedChange={actions.onToggleHidden}
              icon={<IconEye width={14} height={14} />}
            >
              {zh ? '显示隐藏文件' : 'Show Hidden Files'}
            </DropdownMenuSwitchItem>
          )}
        </>
      )}
    </>
  );
}

export function HostWorkspacePickerFileMenu(props: MenuProps): ReactElement {
  const label = props.actions.locale === 'zh-CN' ? '文件操作' : 'File actions';
  const openingDialog = useRef(false);
  const actions: HostPickerMenuActions = {
    ...props.actions,
    onCreate: (kind, column) => {
      openingDialog.current = true;
      props.actions.onCreate(kind, column);
    },
  };
  return (
    <DropdownMenu
      label={label}
      testId="host-workspace-file-menu"
      align="end"
      modal={false}
      onOpenChange={(open) => {
        if (open) openingDialog.current = false;
      }}
      onCloseAutoFocus={(event) => {
        if (openingDialog.current) event.preventDefault();
      }}
      trigger={
        <IconButton
          label={label}
          size={24}
          data-testid="host-workspace-file-actions"
          disabled={props.actions.busy || !props.column}
        >
          <IconMore width={16} height={16} />
        </IconButton>
      }
    >
      <FileMenuItems actions={actions} column={props.column} context={false} />
    </DropdownMenu>
  );
}

export function HostWorkspacePickerColumnMenu(props: {
  actions: HostPickerMenuActions;
  column: HostListDirData;
  columns: HostListDirData[];
  onOpenFolder: (entry: HostDirEntry) => void;
  children: (onContextMenuCapture: MouseEventHandler<HTMLDivElement>) => ReactElement;
}): ReactElement {
  const [folderTarget, setFolderTarget] = useState<HostDirEntry | undefined>(undefined);
  const target = folderTarget
    ? {
        path: folderTarget.path,
        entries: props.columns.find((column) => column.path === folderTarget.path)?.entries ?? [],
      }
    : props.column;

  const captureTarget: MouseEventHandler<HTMLDivElement> = (event) => {
    const element =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>('[data-host-entry-path]')
        : null;
    const entry = props.column.entries.find(
      (item) => item.path === element?.dataset['hostEntryPath'],
    );
    // A folder row names the destination itself; files and blank space use the containing column.
    setFolderTarget(entry?.kind === 'directory' ? entry : undefined);
  };
  return (
    <ContextMenu
      testId="host-workspace-context-menu"
      label={props.actions.locale === 'zh-CN' ? '文件操作' : 'File actions'}
      content={
        <FileMenuItems
          actions={props.actions}
          column={target}
          context
          {...(folderTarget ? { onOpenFolder: () => props.onOpenFolder(folderTarget) } : {})}
        />
      }
    >
      {props.children(captureTarget)}
    </ContextMenu>
  );
}
