import { useState, type ReactElement } from 'react';
import type { TranscriptBranchPoint } from '@piwin/contracts';
import { Popover } from '@piwin/ui-kit';
import { BranchPointsPanel } from './branch-points-panel';
import { countConversationTreeBranches } from './conversation-branch';
import { IconSessionTree } from './shell-icons';

export type ConversationTreeHeaderPopoverProps = {
  branchPoints: readonly TranscriptBranchPoint[];
  disabled?: boolean;
  onSwitch: (headMessageId: string) => void;
  locale: 'zh-CN' | 'en';
  /** Project/Agent sessions get disk-honesty copy in the panel. */
  isConversationSession?: boolean;
};

/** Persistent in-session tree entry beside the active session title (ADR 0055). */
export function ConversationTreeHeaderPopover(
  props: ConversationTreeHeaderPopoverProps,
): ReactElement {
  const [open, setOpen] = useState(false);
  const isChinese = props.locale === 'zh-CN';
  const branchCount = countConversationTreeBranches(props.branchPoints);
  const title =
    branchCount > 0
      ? isChinese
        ? `打开会话树（${String(branchCount)} 个分岔）`
        : `Open session tree (${String(branchCount)} branches)`
      : isChinese
        ? '打开会话树（尚无分岔）'
        : 'Open session tree (no branches yet)';

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="start"
      side="bottom"
      label={isChinese ? '会话树' : 'Session tree'}
      testId="session-tree-popover"
      contentClassName="session-lineage-popover session-lineage-popover--header"
      trigger={
        <button
          type="button"
          className="context-session-tree-trigger"
          title={title}
          aria-label={title}
          aria-haspopup="dialog"
          aria-expanded={open}
          data-testid="context-session-tree-btn"
          data-has-branches={branchCount > 0 ? 'true' : 'false'}
        >
          <IconSessionTree width={14} height={14} />
          <span className="context-session-tree-label">
            {isChinese ? '会话树' : 'Session tree'}
          </span>
          <span className="context-session-tree-count" aria-label={String(branchCount)}>
            {branchCount}
          </span>
        </button>
      }
    >
      <div className="session-lineage-panel">
        <div className="session-lineage-popover-header">
          <div>
            <strong>{isChinese ? '会话树' : 'Session tree'}</strong>
            <span className="session-lineage-popover-subtitle">
              {props.isConversationSession === false
                ? isChinese
                  ? '切换的是对话路线，不会自动还原工作区文件'
                  : 'Switches the chat path; workspace files are not reverted'
                : isChinese
                  ? '在这条会话的分岔之间切换'
                  : 'Switch branches in this conversation'}
            </span>
          </div>
          <span>
            {branchCount === 0
              ? isChinese
                ? '0 个分岔'
                : '0 branches'
              : props.branchPoints.length > 1
                ? isChinese
                  ? `${String(props.branchPoints.length)} 处分叉 · ${String(branchCount)} 条备选`
                  : `${String(props.branchPoints.length)} forks · ${String(branchCount)} branches`
                : isChinese
                  ? `${String(branchCount)} 个分岔`
                  : `${String(branchCount)} branches`}
          </span>
        </div>
        <BranchPointsPanel
          branchPoints={[...props.branchPoints]}
          disabled={props.disabled === true}
          onSwitch={(headMessageId) => {
            props.onSwitch(headMessageId);
            setOpen(false);
          }}
          locale={props.locale}
          {...(props.isConversationSession === false
            ? { isConversationSession: false }
            : {})}
        />
      </div>
    </Popover>
  );
}
