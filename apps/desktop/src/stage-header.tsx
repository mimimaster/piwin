/**
 * StageHeader — the 42px header over the stage column in Inkstone themes
 * (proto-00-shell.html line 201-207).
 *
 * Structure:
 *   <header class="tb stage-header">
 *     <div class="title">
 *       <span class="lamp" data-st="running" />
 *       <span class="sq" data-st="waiting" />
 *       <span class="tt">{title}</span>
 *       <button class="ib s22" title="会话树"><IconGit /></button>
 *       {modeBadge}
 *       {originBadge}
 *     </div>
 *     {status}
 *   </header>
 */
import type { ReactElement, ReactNode } from 'react';
import type { PermissionPreset, ProductSessionOrigin } from '@piwin/contracts';
import { IconGit } from '@piwin/ui-kit';
import type { RunStatusView } from './run-status.js';

export type StageHeaderProps = {
  title: string;
  runState?: RunStatusView | undefined;
  sessionTreeControl?: ReactNode | undefined;
  permissionMode?: PermissionPreset | null | undefined;
  onOpenPermissions?: (() => void) | undefined;
  origin?: ProductSessionOrigin | null | undefined;
  onReturnToRoot?: (() => void) | undefined;
  locale?: 'zh-CN' | 'en' | undefined;
  onStop?: (() => void) | undefined;
};

function shellStateKind(kind?: RunStatusView['kind']): 'idle' | 'running' | 'waiting' {
  switch (kind) {
    case 'waiting-permission':
      return 'waiting';
    case 'preparing':
    case 'connecting-model':
    case 'waiting-first-token':
    case 'working':
    case 'planning':
    case 'compacting':
    case 'stopping':
      return 'running';
    default:
      return 'idle';
  }
}

export function StageHeader(props: StageHeaderProps): ReactElement {
  const shellState = shellStateKind(props.runState?.kind);
  const isChinese = (props.locale ?? 'zh-CN') === 'zh-CN';
  const mode = props.permissionMode ?? null;

  return (
    <header className="tb stage-header" data-testid="stage-header" data-state={shellState}>
      <div className="title">
        {shellState === 'running' ? (
          <span className="lamp" data-st="running" aria-hidden />
        ) : null}
        {shellState === 'waiting' ? (
          <span className="sq" data-st="waiting" aria-hidden />
        ) : null}
        <span className="tt" id="session-title" title={props.title}>
          {props.title}
        </span>
        {props.sessionTreeControl ? (
          <span className="context-bar-session-tree-slot">{props.sessionTreeControl}</span>
        ) : (
          <button
            type="button"
            className="ib s22"
            title={isChinese ? '会话树' : 'Session tree'}
            aria-label={isChinese ? '会话树' : 'Session tree'}
          >
            <IconGit width={14} height={14} />
          </button>
        )}
        {mode ? (
          <button
            type="button"
            className={
              mode === 'yolo' ? 'context-bar-mode-badge is-warning' : 'context-bar-mode-badge'
            }
            data-testid="stage-mode-badge"
            data-mode={mode}
            title={
              isChinese
                ? '运行模式 — 点击打开权限设置'
                : 'Run mode — click to open Permissions settings'
            }
            onClick={props.onOpenPermissions}
          >
            {mode === 'auto' ? 'Auto' : mode === 'ask' ? 'Ask' : 'YOLO'}
          </button>
        ) : null}
        {props.origin ? (
          <button
            type="button"
            className="context-bar-origin-badge"
            data-testid="stage-origin-badge"
            data-origin-kind={props.origin.kind}
            title={
              props.origin.kind === 'fork'
                ? isChinese
                  ? `从「${props.origin.sourceSessionNameSnapshot ?? '源会话'}」分叉`
                  : `Forked from "${props.origin.sourceSessionNameSnapshot ?? 'source session'}"`
                : isChinese
                  ? `复制自「${props.origin.sourceSessionNameSnapshot ?? '源会话'}」`
                  : `Duplicated from "${props.origin.sourceSessionNameSnapshot ?? 'source session'}"`
            }
            onClick={props.onReturnToRoot}
          >
            <IconGit width={12} height={12} stroke={1.8} />
            <span>
              {props.origin.kind === 'fork'
                ? isChinese
                  ? '分支'
                  : 'Branch'
                : isChinese
                  ? '副本'
                  : 'Duplicate'}
            </span>
          </button>
        ) : null}
      </div>
      {props.runState && props.runState.kind !== 'idle' ? (
        <div className="status stage-header-status" role="status">
          <span className="muted">{props.runState.label}</span>
          {props.onStop && props.runState.canStop ? (
            <button type="button" className="chip" onClick={props.onStop}>
              {isChinese ? '停止' : 'Stop'}
            </button>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}
