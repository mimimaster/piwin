/**
 * Render a ui-kit ContextMenu from a pure catalog + dispatchers.
 */
import { type ReactElement, type ReactNode } from 'react';
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  FileTypeIcon,
  IconAgent,
  IconAlertCircle,
  IconArrowFork,
  IconChat,
  IconCheckCircle,
  IconCode,
  IconCommentPlus,
  IconCopy,
  IconFile,
  IconFileDiff,
  IconFolder,
  IconLink,
  IconMore,
  IconRefresh,
  IconSideChat,
  IconSpark,
  IconTerminal,
  IconUser,
} from '@piwin/ui-kit';
import { buildContextMenuItems } from './catalog.js';
import { dispatchContextMenuAction, type ContextMenuDispatchers } from './dispatch.js';
import type {
  ContextMenuCapabilities,
  ContextMenuItemSpec,
  ContextMenuTarget,
} from './types.js';

export type ContextMenuFromCatalogProps = {
  target: ContextMenuTarget | null;
  /**
   * Read the live target when the portal mounts (after `contextmenu`).
   * Use this when the surface can switch (message vs transcript selection)
   * so Radix clearing `window.getSelection()` does not bake a stale menu.
   */
  resolveTarget?: () => ContextMenuTarget | null;
  caps: ContextMenuCapabilities;
  dispatchers: ContextMenuDispatchers;
  children: ReactNode;
  testId?: string;
  label?: string;
};

function renderActionIcon(iconName: string | undefined): ReactNode {
  if (!iconName) return null;
  switch (iconName) {
    case 'chat':
      return <IconChat width={14} height={14} />;
    case 'spark':
      return <IconSpark width={14} height={14} />;
    case 'link':
      return <IconLink width={14} height={14} />;
    case 'check-circle':
      return <IconCheckCircle width={14} height={14} />;
    case 'code':
      return <IconCode width={14} height={14} />;
    case 'alert-circle':
      return <IconAlertCircle width={14} height={14} />;
    case 'file':
      return <IconFile width={14} height={14} />;
    case 'folder':
      return <IconFolder width={14} height={14} />;
    case 'copy':
      return <IconCopy width={14} height={14} />;
    case 'comment-plus':
      return <IconCommentPlus width={14} height={14} />;
    case 'refresh':
      return <IconRefresh width={14} height={14} />;
    case 'arrow-fork':
      return <IconArrowFork width={14} height={14} />;
    case 'side-chat':
      return <IconSideChat width={14} height={14} />;
    case 'file-diff':
      return <IconFileDiff width={14} height={14} />;
    case 'more':
      return <IconMore width={14} height={14} />;
    default:
      return null;
  }
}

function renderTargetHeader(target: ContextMenuTarget): ReactNode {
  let icon: ReactNode = null;
  let labelText = '';

  switch (target.surface) {
    case 'file-tree-file':
    case 'path-chip':
      icon = <FileTypeIcon filePathOrExt={target.label} />;
      labelText = target.label;
      break;
    case 'file-tree-folder':
      icon = <IconFolder width={12} height={12} />;
      labelText = target.label;
      break;
    case 'selection': {
      icon = <IconCode width={12} height={12} />;
      const len = target.selectedText.length;
      if (target.lineStart !== undefined && target.lineEnd !== undefined) {
        labelText = `${target.label} (L${target.lineStart}-${target.lineEnd})`;
      } else {
        labelText = target.label ? `${target.label} (${len} chars)` : `${len} chars selected`;
      }
      break;
    }
    case 'code-block':
      icon = <IconCode width={12} height={12} />;
      labelText = target.label || 'Code Block';
      break;
    case 'message-user':
      icon = <IconUser width={12} height={12} />;
      labelText = target.label || 'User Message';
      break;
    case 'message-assistant':
      icon = <IconAgent width={12} height={12} />;
      labelText = target.label || 'Assistant Message';
      break;
    case 'diff-row':
      icon = <IconFileDiff width={12} height={12} />;
      labelText = target.label || 'Diff';
      break;
    case 'tool-card':
      icon = <IconTerminal width={12} height={12} />;
      labelText = target.label || target.toolName || 'Tool Call';
      break;
    case 'terminal-selection':
      icon = <IconTerminal width={12} height={12} />;
      labelText = target.label || 'Terminal Selection';
      break;
    case 'error':
      icon = <IconAlertCircle width={12} height={12} />;
      labelText = target.label || target.title || 'Error';
      break;
    default:
      return null;
  }

  if (!labelText) return null;

  return (
    <ContextMenuLabel icon={icon} className="ui-menu-header">
      {labelText}
    </ContextMenuLabel>
  );
}

function renderItems(
  items: ContextMenuItemSpec[],
  target: ContextMenuTarget,
  dispatchers: ContextMenuDispatchers,
): ReactNode[] {
  return items.map((entry, index) => {
    if (entry.type === 'separator') {
      return <ContextMenuSeparator key={`sep-${index}`} />;
    }
    if (entry.type === 'submenu') {
      return (
        <ContextMenuSub key={entry.id}>
          <ContextMenuSubTrigger
            testId={`context-menu-sub-${entry.id}`}
            {...(entry.icon ? { icon: renderActionIcon(entry.icon) } : {})}
          >
            {entry.label}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {renderItems(entry.children, target, dispatchers)}
          </ContextMenuSubContent>
        </ContextMenuSub>
      );
    }
    return (
      <ContextMenuItem
        key={entry.id}
        testId={entry.testId}
        disabled={entry.disabled === true}
        danger={entry.danger === true}
        {...(entry.icon ? { icon: renderActionIcon(entry.icon) } : {})}
        {...(entry.shortcut ? { shortcut: entry.shortcut } : {})}
        onSelect={() => dispatchContextMenuAction(entry.id, target, dispatchers)}
      >
        {entry.label}
      </ContextMenuItem>
    );
  });
}

function CatalogContent(props: {
  target: ContextMenuTarget | null;
  resolveTarget?: () => ContextMenuTarget | null;
  caps: ContextMenuCapabilities;
  dispatchers: ContextMenuDispatchers;
}): ReactElement | null {
  const target = props.resolveTarget?.() ?? props.target;
  if (target === null) {
    return null;
  }
  return (
    <>
      {renderTargetHeader(target)}
      {renderItems(buildContextMenuItems(target, props.caps), target, props.dispatchers)}
    </>
  );
}

export function ContextMenuFromCatalog(props: ContextMenuFromCatalogProps): ReactElement {
  return (
    <ContextMenu
      {...(props.testId !== undefined ? { testId: props.testId } : {})}
      {...(props.label !== undefined ? { label: props.label } : {})}
      content={
        <CatalogContent
          target={props.target}
          {...(props.resolveTarget !== undefined ? { resolveTarget: props.resolveTarget } : {})}
          caps={props.caps}
          dispatchers={props.dispatchers}
        />
      }
    >
      {props.children}
    </ContextMenu>
  );
}
