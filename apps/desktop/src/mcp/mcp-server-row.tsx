/**
 * One MCP server in the settings list: a fixed grid so the controls sit in the
 * same column on every row, whatever the command or fact widths are.
 */
import type { ReactElement, ReactNode } from 'react';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
  IconButton,
  Switch,
} from '@piwin/ui-kit';
import { IconPin, IconChevronDown, IconChevronRight } from '../tool-cards/shell-icons';
import {
  mcpServerRuntimeStatusLabel,
  type McpServerRuntimeUiStatus,
} from './mcp-visibility-model.js';

export type McpServerRowProps = {
  serverId: string;
  commandLine: string;
  isEnabled: boolean;
  runtimeStatus: McpServerRuntimeUiStatus;
  toolCount: number;
  pinnedCount: number;
  credentialCount: number;
  /** Env vars for a stdio server, headers for a remote one. */
  credentialKind: 'env' | 'headers';
  expanded: boolean;
  pinning: boolean;
  activity: { id: string; animation: string; status: 'running' | 'error' | 'done' };
  isChinese: boolean;
  onToggleExpanded: () => void;
  onToggleEnabled: (enabled: boolean) => void;
  onTogglePinned: () => void;
  onEdit: () => void;
  onReload: () => void;
  onDelete: () => void;
  /** Expanded detail, rendered under the summary row. */
  children?: ReactNode;
};

export function McpServerRow(props: McpServerRowProps): ReactElement {
  const { serverId, isChinese, pinnedCount } = props;
  const pinned = pinnedCount > 0;
  const classNames = ['ext-list-item', 'mcp-server-card'];
  if (props.expanded) classNames.push('is-expanded');
  if (!props.isEnabled) classNames.push('is-disabled');

  return (
    <li
      className={classNames.join(' ')}
      data-testid={`mcp-server-${serverId}`}
      data-activity-id={props.activity.id}
      data-activity-animation={props.activity.animation}
      data-tool-status={props.activity.status}
    >
      <div className="mcp-server-card-summary">
        <button
          type="button"
          className="mcp-server-card-body"
          aria-expanded={props.expanded}
          data-testid={`mcp-server-expand-${serverId}`}
          onClick={props.onToggleExpanded}
        >
          <span
            className={`mcp-status-dot-inline ${props.runtimeStatus}`}
            title={mcpServerRuntimeStatusLabel(props.runtimeStatus, isChinese)}
          />
          <span className="mcp-server-card-title">
            <strong className="mcp-server-id">{serverId}</strong>
            {!props.isEnabled ? (
              <span className="mcp-disabled-pill">{isChinese ? '已禁用' : 'Disabled'}</span>
            ) : null}
            <span className="mcp-server-facts">
              {props.toolCount > 0 ? (
                <span className="mcp-server-fact">
                  {isChinese ? `${props.toolCount} 个工具` : `${props.toolCount} tools`}
                </span>
              ) : null}
              {pinned ? (
                <span
                  className="mcp-server-fact mcp-server-fact--pinned"
                  title={
                    isChinese
                      ? `${pinnedCount} 个工具已固定为直接调用`
                      : `${pinnedCount} tool(s) pinned for direct call`
                  }
                  data-testid={`mcp-server-pinned-count-${serverId}`}
                >
                  {isChinese ? `${pinnedCount} 直调` : `${pinnedCount} pinned`}
                </span>
              ) : null}
              {props.credentialCount > 0 ? (
                <span className="mcp-server-fact">
                  {props.credentialKind === 'headers'
                    ? isChinese
                      ? `${props.credentialCount} 个请求头`
                      : `${props.credentialCount} headers`
                    : isChinese
                      ? `${props.credentialCount} 个环境变量`
                      : `${props.credentialCount} env vars`}
                </span>
              ) : null}
            </span>
          </span>
          <code className="mcp-command-snippet" title={props.commandLine}>
            {props.commandLine || (isChinese ? '(无命令)' : '(no command)')}
          </code>
          <span className="mcp-server-expand-chevron" aria-hidden>
            {props.expanded ? <IconChevronDown /> : <IconChevronRight />}
          </span>
        </button>
        <div className="mcp-server-card-actions">
          <Switch
            checked={props.isEnabled}
            onCheckedChange={props.onToggleEnabled}
            onClick={(event) => event.stopPropagation()}
            aria-label={isChinese ? `切换 ${serverId}` : `Toggle ${serverId}`}
          />
          <IconButton
            label={
              pinned
                ? isChinese
                  ? `取消固定 ${serverId} 的全部工具`
                  : `Unpin all tools from ${serverId}`
                : isChinese
                  ? `固定 ${serverId} 的全部工具`
                  : `Pin all tools from ${serverId}`
            }
            title={
              pinned
                ? isChinese
                  ? `${pinnedCount} 个工具已固定，点击取消固定`
                  : `${pinnedCount} tool(s) pinned; click to unpin`
                : isChinese
                  ? '点击直接固定该服务器的全部工具'
                  : 'Click to directly pin all tools from this server'
            }
            className={pinned ? 'mcp-server-pin-btn mcp-server-pin-btn--active' : 'mcp-server-pin-btn'}
            aria-pressed={pinned}
            disabled={props.pinning}
            data-testid={`mcp-server-pin-trigger-${serverId}`}
            onClick={(event) => {
              event.stopPropagation();
              props.onTogglePinned();
            }}
          >
            <IconPin
              className={
                pinned ? 'mcp-server-pin-icon mcp-server-pin-icon--filled' : 'mcp-server-pin-icon'
              }
              width={16}
              height={16}
            />
          </IconButton>
          <DropdownMenu
            align="end"
            side="bottom"
            label={isChinese ? '服务器操作' : 'Server actions'}
            trigger={
              <button
                type="button"
                className="mcp-row-menu-trigger"
                aria-label={isChinese ? '更多操作' : 'More actions'}
                onClick={(event) => event.stopPropagation()}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <circle cx="8" cy="4" r="1.5" />
                  <circle cx="8" cy="8" r="1.5" />
                  <circle cx="8" cy="12" r="1.5" />
                </svg>
              </button>
            }
          >
            <DropdownMenuItem onSelect={props.onEdit}>{isChinese ? '编辑' : 'Edit'}</DropdownMenuItem>
            <DropdownMenuItem onSelect={props.onReload}>
              {isChinese ? '重新加载' : 'Reload'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem danger onSelect={props.onDelete}>
              {isChinese ? '删除' : 'Delete'}
            </DropdownMenuItem>
          </DropdownMenu>
        </div>
      </div>
      {props.children}
    </li>
  );
}
