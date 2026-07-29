/**
 * ContextBar — the 42px band between titleband and transcript.
 *
 * Quiet workbench: session title, scope pill, run status cluster only.
 * Right work-panel toggle lives on the titleband (top-right).
 *
 * Data-testids migrated from retired components:
 *   - "workspace-context-header" — root element (was on WorkspaceContextHeader)
 *   - "run-status-strip"         — status region (was on RunStatusStrip)
 *   - "run-status-stop"          — stop button (was on RunStatusStrip)
 *   - "run-status-stopping"      — stopping label (was on RunStatusStrip)
 */
import type { ReactElement } from 'react';
import { Button } from '@piwin/ui-kit';
import type { PermissionMode } from '@piwin/contracts';
import type { RunStatusView } from './run-status.js';

export type ContextBarSession = {
  title: string;
  scopeLabel: string;
};

export type ContextBarProps = {
  session: ContextBarSession;
  runState: RunStatusView;
  onStop: () => void;
  onReviewPermission: () => void;
  onViewPlan: () => void;
  onCancelCompact: () => void;
  onRetry?: (() => void) | undefined;
  /** ADR 0019 §3 — permission mode badge; click opens Settings → Permissions. */
  permissionMode?: PermissionMode | null;
  onOpenPermissions?: (() => void) | undefined;
  locale?: 'zh-CN' | 'en';
};

function modeBadgeLabel(mode: PermissionMode): string {
  switch (mode) {
    case 'auto':
      return 'Auto';
    case 'ask-all':
      return 'Ask all';
    case 'bypass':
      return 'Bypass';
  }
}

function formatElapsed(elapsedMs: number): string {
  const elapsedSeconds = Math.floor(elapsedMs / 1000);
  if (elapsedSeconds < 60) {
    return `${elapsedSeconds}s`;
  }
  const minutes = Math.floor(elapsedSeconds / 60);
  return `${minutes}m ${elapsedSeconds % 60}s`;
}

function phaseDotClass(kind: RunStatusView['kind']): string {
  switch (kind) {
    case 'preparing':
    case 'connecting-model':
    case 'waiting-first-token':
    case 'working':
    case 'planning':
    case 'compacting':
    case 'stopping':
      return 'context-bar-phase-dot is-running';
    case 'waiting-permission':
      return 'context-bar-phase-dot is-warning';
    case 'failed':
      return 'context-bar-phase-dot is-error';
    case 'complete':
      return 'context-bar-phase-dot is-complete';
    case 'stopped':
    case 'idle':
    default:
      return 'context-bar-phase-dot';
  }
}

export function ContextBar(props: ContextBarProps): ReactElement {
  const { session, runState } = props;
  const elapsedText = runState.elapsedMs !== undefined ? formatElapsed(runState.elapsedMs) : null;
  const isChinese = props.locale === 'zh-CN';
  const mode = props.permissionMode ?? null;

  return (
    <div className="context-bar" data-testid="workspace-context-header" data-kind={runState.kind}>
      {/* Session identity */}
      <div className="context-bar-identity">
        <span className="context-bar-title" title={session.title}>
          {session.title}
        </span>
        <span className="context-bar-scope-pill">{session.scopeLabel}</span>
        {mode ? (
          <button
            type="button"
            className={
              mode === 'bypass' ? 'context-bar-mode-badge is-warning' : 'context-bar-mode-badge'
            }
            data-testid="context-bar-mode-badge"
            data-mode={mode}
            title={
              isChinese
                ? '权限模式 — 点击打开权限设置'
                : 'Permission mode — click to open Permissions settings'
            }
            onClick={props.onOpenPermissions}
          >
            {modeBadgeLabel(mode)}
          </button>
        ) : null}
      </div>

      {/* Run status cluster */}
      <div
        className="context-bar-status"
        data-testid="run-status-strip"
        data-kind={runState.kind}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-label={runState.kind !== 'idle' ? runState.label : undefined}
      >
        <i className={phaseDotClass(runState.kind)} aria-hidden />
        {elapsedText !== null ? (
          <span className="context-bar-elapsed muted" aria-hidden>
            {elapsedText}
          </span>
        ) : null}

        {/* Contextual action buttons */}
        {runState.primaryAction === 'review-permission' ? (
          <Button size="compact" variant="primary" onClick={props.onReviewPermission}>
            Review request
          </Button>
        ) : null}
        {runState.primaryAction === 'view-plan' ? (
          <Button size="compact" onClick={props.onViewPlan}>
            View plan
          </Button>
        ) : null}
        {runState.kind === 'compacting' ? (
          <Button size="compact" onClick={props.onCancelCompact}>
            Cancel
          </Button>
        ) : null}
        {runState.canStop ? (
          <Button size="compact" data-testid="run-status-stop" onClick={props.onStop}>
            Stop
          </Button>
        ) : null}
        {runState.kind === 'stopping' ? (
          <span className="muted" data-testid="run-status-stopping">
            Stopping…
          </span>
        ) : null}
        {runState.primaryAction === 'retry' && props.onRetry !== undefined ? (
          <Button size="compact" onClick={props.onRetry}>
            Retry
          </Button>
        ) : null}
      </div>
    </div>
  );
}
