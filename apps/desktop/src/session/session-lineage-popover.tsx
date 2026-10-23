import { useMemo, useState, type ReactElement } from 'react';
import type { ProductSessionLineageNode, ProductSessionLineageView } from '@piwin/contracts';
import { IconGit, Popover } from '@piwin/ui-kit';
import { buildSessionLineageTree, type SessionLineageTreeNode } from './session-lineage-tree';

export type SessionLineagePopoverProps = {
  messageId: string;
  lineage: ProductSessionLineageView;
  directForkCount: number;
  showTreeOnLatestResponse: boolean;
  onOpenSession: (sessionId: string) => void;
  onOpenForks?: ((messageId: string) => void) | undefined;
  locale: 'zh-CN' | 'en';
};

function getNodeLabel(node: ProductSessionLineageNode, locale: 'zh-CN' | 'en'): string {
  if (node.isArchived) {
    return `${node.name ?? (locale === 'zh-CN' ? '已归档会话' : 'Archived session')}`;
  }
  return node.name ?? (locale === 'zh-CN' ? '未命名会话' : 'Unnamed session');
}

function getSourceHint(node: ProductSessionLineageNode, locale: 'zh-CN' | 'en'): string | null {
  if (node.origin?.kind !== 'fork') return null;
  const prefix = locale === 'zh-CN' ? '从此处分叉：' : 'Forked from: ';
  return `${prefix}${node.origin.sourceMessagePreview}`;
}

function LineageTreeBranch(props: {
  node: SessionLineageTreeNode;
  activeSessionId: string;
  locale: 'zh-CN' | 'en';
  onOpenSession: (sessionId: string) => void;
  onClose: () => void;
  level: number;
}): ReactElement {
  const { node } = props;
  const label = node.isMissingRoot
    ? props.locale === 'zh-CN'
      ? '原始会话已删除'
      : 'Original conversation deleted'
    : getNodeLabel(node, props.locale);
  const sourceHint = node.isMissingRoot ? null : getSourceHint(node, props.locale);
  const isActive = node.sessionId === props.activeSessionId;

  return (
    <div className="session-lineage-branch" data-session-lineage-branch={node.sessionId}>
      <button
        type="button"
        className={
          isActive
            ? 'session-lineage-node session-lineage-node--active'
            : node.isMissingRoot
              ? 'session-lineage-node session-lineage-node--missing'
              : 'session-lineage-node'
        }
        disabled={node.isMissingRoot}
        role="treeitem"
        aria-level={props.level}
        aria-expanded={node.children.length > 0 ? true : undefined}
        aria-current={isActive ? 'page' : undefined}
        data-testid={`session-lineage-node-${node.sessionId}`}
        onClick={() => {
          if (node.isMissingRoot) return;
          props.onOpenSession(node.sessionId);
          props.onClose();
        }}
      >
        <span className="session-lineage-node-marker" aria-hidden />
        <span className="session-lineage-node-copy">
          <span className="session-lineage-node-name">{label}</span>
          {sourceHint ? (
            <span className="session-lineage-node-hint" title={sourceHint}>
              {sourceHint}
            </span>
          ) : null}
        </span>
        {node.isArchived ? (
          <span className="session-lineage-node-status">
            {props.locale === 'zh-CN' ? '已归档' : 'Archived'}
          </span>
        ) : null}
        {isActive ? (
          <span className="session-lineage-node-status">
            {props.locale === 'zh-CN' ? '当前' : 'Current'}
          </span>
        ) : null}
      </button>
      {node.children.length > 0 ? (
        <div className="session-lineage-children">
          {node.children.map((child) => (
            <LineageTreeBranch
              key={child.sessionId}
              node={child}
              activeSessionId={props.activeSessionId}
              locale={props.locale}
              onOpenSession={props.onOpenSession}
              onClose={props.onClose}
              level={props.level + 1}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function getLineageCounts(lineage: ProductSessionLineageView): {
  sessionCount: number;
  branchCount: number;
} {
  return {
    sessionCount: lineage.nodes.length,
    branchCount: Math.max(0, lineage.nodes.length - (lineage.rootMissing ? 0 : 1)),
  };
}

function SessionLineageTreePanel(props: {
  lineage: ProductSessionLineageView;
  locale: 'zh-CN' | 'en';
  onOpenSession: (sessionId: string) => void;
  onClose: () => void;
}): ReactElement {
  const tree = useMemo(() => buildSessionLineageTree(props.lineage), [props.lineage]);
  const isChinese = props.locale === 'zh-CN';
  const { sessionCount, branchCount } = getLineageCounts(props.lineage);

  return (
    <div className="session-lineage-panel">
      <div className="session-lineage-popover-header">
        <div>
          <strong>{isChinese ? '相关会话' : 'Related chats'}</strong>
          <span className="session-lineage-popover-subtitle">
            {isChinese ? '打开这条消息分出去的会话' : 'Open chats forked from this reply'}
          </span>
        </div>
        <span>
          {isChinese
            ? `${sessionCount} 个会话 · ${branchCount} 个分支`
            : `${sessionCount} sessions · ${branchCount} branches`}
        </span>
      </div>
      <div
        className="session-lineage-tree"
        role="tree"
        aria-label={isChinese ? '关联会话' : 'Related sessions'}
      >
        {tree.root ? (
          <LineageTreeBranch
            node={tree.root}
            activeSessionId={props.lineage.activeSessionId}
            locale={props.locale}
            onOpenSession={props.onOpenSession}
            onClose={props.onClose}
            level={1}
          />
        ) : null}
        {tree.detached.map((node) => (
          <LineageTreeBranch
            key={node.sessionId}
            node={node}
            activeSessionId={props.lineage.activeSessionId}
            locale={props.locale}
            onOpenSession={props.onOpenSession}
            onClose={props.onClose}
            level={1}
          />
        ))}
      </div>
      {branchCount === 0 ? (
        <div className="session-lineage-empty" data-testid="session-lineage-empty">
          <span className="session-lineage-empty-icon" aria-hidden>
            <IconGit width={15} height={15} stroke={1.8} />
          </span>
          <span className="session-lineage-empty-copy">
            <strong>{isChinese ? '当前还没有分支' : 'No branches yet'}</strong>
            <span>
              {isChinese
                ? '在任意已完成的助手回复下点击“从此处分叉”，新会话会出现在这里。'
                : 'Choose “Fork from here” below any completed assistant reply; the new session will appear here.'}
            </span>
          </span>
        </div>
      ) : null}
    </div>
  );
}

/** Compact product-session lineage tree anchored to a response action footer. */
export function SessionLineagePopover(props: SessionLineagePopoverProps): ReactElement | null {
  const [open, setOpen] = useState(false);
  const hasTree = props.lineage.nodes.length > 1;
  const shouldRender = hasTree && (props.directForkCount > 0 || props.showTreeOnLatestResponse);
  if (!shouldRender) return null;

  const isChinese = props.locale === 'zh-CN';
  const { branchCount } = getLineageCounts(props.lineage);
  const count = props.directForkCount > 0 ? props.directForkCount : branchCount;
  const triggerLabel =
    props.directForkCount > 0
      ? isChinese
        ? `${props.directForkCount} 个分叉会话`
        : `${props.directForkCount} forks`
      : isChinese
        ? '相关会话'
        : 'Related chats';

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="start"
      side="bottom"
      label={isChinese ? '相关会话' : 'Related chats'}
      testId="session-lineage-popover"
      contentClassName="session-lineage-popover"
      trigger={
        <button
          type="button"
          className="fk session-lineage-trigger"
          title={triggerLabel}
          aria-label={triggerLabel}
          aria-haspopup="dialog"
          data-testid="response-session-tree-btn"
          onClick={() => props.onOpenForks?.(props.messageId)}
        >
          <span {...(props.directForkCount > 0 ? { 'data-testid': 'response-fork-count' } : {})}>
            {count}
          </span>
          {isChinese ? ' 个分支' : count === 1 ? ' branch' : ' branches'}
        </button>
      }
    >
      <SessionLineageTreePanel
        lineage={props.lineage}
        locale={props.locale}
        onOpenSession={props.onOpenSession}
        onClose={() => setOpen(false)}
      />
    </Popover>
  );
}
