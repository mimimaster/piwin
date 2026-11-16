/**
 * Session status popover — the titlebar trigger plus the floating panel.
 *
 * The content lives in `SessionStatusPanel` (session-status-panel.tsx) so the
 * same flat 2-layer sheet can also dock into the stage's right gutter. The
 * trigger is always a static icon button. When the stage can auto-dock and
 * there is content, the trigger toggles the dock instead of duplicating the
 * panel in a popover.
 */
import { useEffect, useState, type ReactElement } from 'react';
import { IconButton, Popover } from '@piwin/ui-kit';
import type { JobRecord, SessionPlan } from '@piwin/contracts';
import type { DesktopLocale } from '../i18n/desktop-locale';
import { useDesktopLocale } from '../i18n/desktop-locale-context';
import type { SubagentOrchestrationView } from '../agents/subagent-orchestration-view.js';
import type { RightPanelTab } from '../right-panel/right-panel-sections';
import {
  SessionStatusPanel,
  sessionStatusCopy,
  type SessionStatusArtifact,
  type SessionStatusRuntimeInfo,
} from './session-status-panel';

export type { SessionStatusArtifact, SessionStatusRuntimeInfo };
export { SessionStatusDock, SessionStatusPanel } from './session-status-panel';

export type SessionStatusPopoverProps = {
  locale?: DesktopLocale | undefined;
  plan?: SessionPlan | null | undefined;
  orchestrationView?: SubagentOrchestrationView | undefined;
  jobs?: readonly JobRecord[] | undefined;
  artifacts?: readonly SessionStatusArtifact[] | undefined;
  runtimeInfo?: SessionStatusRuntimeInfo | undefined;
  onOpenTool: (tab: RightPanelTab) => void;
  onViewJobLogs?: ((jobId: string) => void) | undefined;
  onStopJob?: ((jobId: string) => void) | undefined;
  onCancelSubagentBatch?: ((runId: string) => void) | undefined;
  /** Stop-all for batches; falls back to one cancel per run. */
  onCancelSubagentBatches?: ((runIds: readonly string[]) => void) | undefined;
  isSubagentStopping?: ((runId: string) => boolean) | undefined;
  /**
   * Stage-dock coordination. When `canAutoDock && hasContent`, the trigger
   * toggles the docked sheet instead of opening a duplicate popover.
   */
  docked?: boolean | undefined;
  canAutoDock?: boolean | undefined;
  hasContent?: boolean | undefined;
  onToggleDock?: (() => void) | undefined;
};

export function SessionStatusPopover(props: SessionStatusPopoverProps): ReactElement {
  const { locale: contextLocale } = useDesktopLocale();
  const zh = (props.locale ?? contextLocale) === 'zh-CN';
  const copy = sessionStatusCopy(zh);
  const [open, setOpen] = useState(false);

  const dockToggle = props.canAutoDock === true && props.hasContent === true;
  const docked = props.docked === true;

  // Docking owns the panel; a popover that was already open must yield so the
  // content never renders twice at once.
  useEffect(() => {
    if (open && docked) setOpen(false);
  }, [open, docked]);

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      side="bottom"
      align="end"
      label={copy.trigger}
      testId="session-status-popover"
      contentClassName="session-status-popover"
      trigger={
        <IconButton
          className="session-status-btn ib"
          data-testid="session-status-btn"
          label={copy.trigger}
          title={copy.trigger}
          aria-expanded={dockToggle ? docked : open}
          onClick={(event) => {
            if (!dockToggle) return;
            // The stage dock owns this surface; keep Radix from also opening
            // the popover (its trigger handler yields to preventDefault).
            event.preventDefault();
            props.onToggleDock?.();
          }}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
            <circle cx="5" cy="5" r="1.8" stroke="currentColor" strokeWidth="1.4" />
            <path d="M1.5 5H3.2M6.8 5H14.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            <circle cx="11" cy="11" r="1.8" stroke="currentColor" strokeWidth="1.4" />
            <path d="M1.5 11H9.2M12.8 11H14.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </IconButton>
      }
    >
      <SessionStatusPanel {...props} onNavigate={() => setOpen(false)} />
    </Popover>
  );
}
