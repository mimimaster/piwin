/**
 * Render a ui-kit ContextMenu from a pure catalog + dispatchers.
 */
import type { ReactElement, ReactNode } from 'react';
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
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
  caps: ContextMenuCapabilities;
  dispatchers: ContextMenuDispatchers;
  children: ReactNode;
  testId?: string;
  label?: string;
};

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
          <ContextMenuSubTrigger testId={`context-menu-sub-${entry.id}`}>
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
        onSelect={() => dispatchContextMenuAction(entry.id, target, dispatchers)}
      >
        {entry.label}
      </ContextMenuItem>
    );
  });
}

export function ContextMenuFromCatalog(props: ContextMenuFromCatalogProps): ReactElement {
  const items =
    props.target !== null ? buildContextMenuItems(props.target, props.caps) : [];
  return (
    <ContextMenu
      {...(props.testId !== undefined ? { testId: props.testId } : {})}
      {...(props.label !== undefined ? { label: props.label } : {})}
      content={
        <>
          {props.target !== null && renderItems(items, props.target, props.dispatchers)}
        </>
      }
    >
      {props.children}
    </ContextMenu>
  );
}
