/**
 * Code-fence context menu. Artifact preview is the same wrapper: a live
 * visible selection becomes a `selection` target so "Add to chat" does not
 * dump the HTML/CSS fence source into a capsule.
 */
import { useRef, type ReactElement, type ReactNode } from 'react';
import {
  ContextMenuFromCatalog,
  useDesktopContextMenu,
  type ContextMenuTarget,
} from './context-menu';
import { resolveCodeFenceContextMenuTarget } from './transcript-selection-target.js';

export function CodeBlockContextMenu(props: {
  source: string;
  language: string;
  children: ReactNode;
}): ReactElement {
  const contextMenu = useDesktopContextMenu();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const resolvedRef = useRef<ContextMenuTarget | null>(null);
  const fallbackTarget: ContextMenuTarget | null =
    contextMenu && props.source.trim().length > 0
      ? {
          surface: 'code-block',
          selectedText: props.source,
          label: props.language || 'code',
        }
      : null;
  if (!fallbackTarget || !contextMenu) {
    return <>{props.children}</>;
  }
  return (
    <ContextMenuFromCatalog
      testId="code-block-context-menu"
      target={fallbackTarget}
      resolveTarget={() =>
        resolvedRef.current ??
        (hostRef.current
          ? resolveCodeFenceContextMenuTarget(hostRef.current, props.source, props.language)
          : fallbackTarget)
      }
      caps={contextMenu.caps}
      dispatchers={contextMenu.dispatchers}
    >
      <div
        ref={hostRef}
        data-testid="code-block-context-host"
        style={{ display: 'contents' }}
        onContextMenu={() => {
          if (hostRef.current) {
            resolvedRef.current = resolveCodeFenceContextMenuTarget(
              hostRef.current,
              props.source,
              props.language,
            );
          }
        }}
      >
        {props.children}
      </div>
    </ContextMenuFromCatalog>
  );
}
