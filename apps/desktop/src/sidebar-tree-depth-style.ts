import type { CSSProperties } from 'react';

/**
 * Hands a row's indent level to the stylesheet. Rows are a flat list, so
 * nesting cannot come from markup; `--tree-depth` is the only input the
 * indent and guide-line rules read (region-sidebar-tree.css).
 */
export function sidebarTreeDepthStyle(depth: number): CSSProperties {
  // CSSProperties has no index signature for custom properties.
  return { '--tree-depth': depth } as CSSProperties;
}
