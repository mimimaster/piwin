/**
 * Flat, windowed rendering of the file tree for large expansions. The nested
 * tree mounts every visible row; past a few hundred that is thousands of DOM
 * nodes for a rail that shows about thirty. Small trees keep the nested
 * markup, so this only takes over where it pays.
 */
import { useEffect, useRef, type ReactElement } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { FileTreeNodeView, type FileTreeNodeListProps } from './file-tree-node-view';
import type { VisibleTreeNode } from './file-tree-model';
import { isEventHandlerPropName, memoWithLatestCallbacks } from './memo-with-latest-callbacks';

export const FILE_TREE_VIRTUALIZE_MIN_ROWS = 200;
/** A plain row as laid out (24px control + 2px row gap); every row is then measured. */
const FILE_TREE_ROW_HEIGHT_PX = 26;
const FILE_TREE_VIRTUAL_OVERSCAN = 12;

export function shouldVirtualizeFileTree(visibleRowCount: number): boolean {
  return visibleRowCount >= FILE_TREE_VIRTUALIZE_MIN_ROWS;
}

export type FileTreeVirtualListProps = Omit<FileTreeNodeListProps, 'nodes'> & {
  rows: readonly VisibleTreeNode[];
  scrollElement: HTMLElement | null;
};

function estimateRowSize(): number {
  return FILE_TREE_ROW_HEIGHT_PX;
}

export const FileTreeVirtualList = memoWithLatestCallbacks(
  function FileTreeVirtualList(props: FileTreeVirtualListProps): ReactElement {
    const { rows, scrollElement, ...rowProps } = props;
    const virtualizer = useVirtualizer({
      count: rows.length,
      getScrollElement: () => scrollElement,
      estimateSize: estimateRowSize,
      getItemKey: (index) => rows[index]?.node.entry.relativePath ?? index,
      overscan: FILE_TREE_VIRTUAL_OVERSCAN,
      useFlushSync: false,
    });

    // Keyboard navigation moves the selection past the window; bring the row
    // back in. Only a selection change scrolls — not rows loading around it.
    const rowsRef = useRef(rows);
    rowsRef.current = rows;
    const virtualizerRef = useRef(virtualizer);
    virtualizerRef.current = virtualizer;
    const selectedPath = props.selectedPath;
    useEffect(() => {
      if (selectedPath === null) return;
      const index = rowsRef.current.findIndex(
        (row) => row.node.entry.relativePath === selectedPath,
      );
      if (index >= 0) virtualizerRef.current.scrollToIndex(index, { align: 'auto' });
    }, [selectedPath]);

    return (
      <>
        <li
          role="presentation"
          aria-hidden
          className="file-tree-virtual-spacer"
          style={{ height: virtualizer.getTotalSize() }}
        />
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const row = rows[virtualRow.index];
          if (row === undefined) return null;
          return (
            <FileTreeNodeView
              key={virtualRow.key}
              node={row.node}
              depth={row.depth}
              virtualIndex={virtualRow.index}
              virtualStart={virtualRow.start}
              measureRef={virtualizer.measureElement}
              {...rowProps}
            />
          );
        })}
      </>
    );
  },
  { isHandler: isEventHandlerPropName },
);
