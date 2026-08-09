/**
 * Render a ui-kit ContextMenu from a pure catalog + dispatchers.
 */
import type { ReactElement, ReactNode } from 'react';
import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from '@piwin/ui-kit';
import { buildContextMenuItems } from './catalog.js';
import { dispatchContextMenuAction, type ContextMenuDispatchers } from './dispatch.js';
import type {
  ContextMenuCapabilities,
  ContextMenuItemSpec,
  ContextMenuTarget,
} from './types.js';

export type ContextMenuFromCatalogProps = {
  target: ContextMenuTarget;
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
      // P0 catalogs are flat; submenu support lands with CM-16 More…
      return (
        <ContextMenuItem key={entry.id} disabled testId={`context-menu-sub-${entry.id}`}>
          {entry.label}
        </ContextMenuItem>
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
  const items = buildContextMenuItems(props.target, props.caps);
  return (
    <ContextMenu
      {...(props.testId !== undefined ? { testId: props.testId } : {})}
      {...(props.label !== undefined ? { label: props.label } : {})}
      content={<>{renderItems(items, props.target, props.dispatchers)}</>}
    >
      {props.children}
    </ContextMenu>
  );
}
