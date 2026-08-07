/**
 * Width of the file-tree navigator rail inside the Files split preview.
 * CSS consumes the value via --file-tree-rail-width on .file-tree-panel-split.
 */

export const FILE_TREE_RAIL_DEFAULT_WIDTH_PX = 220;
export const FILE_TREE_RAIL_MIN_WIDTH_PX = 160;
export const FILE_TREE_RAIL_MAX_WIDTH_PX = 500;

const STORAGE_KEY = 'piwin.desktop.fileTreeRailWidth';

export function clampFileTreeRailWidth(widthPx: number): number {
  if (!Number.isFinite(widthPx)) {
    return FILE_TREE_RAIL_DEFAULT_WIDTH_PX;
  }
  return Math.min(
    FILE_TREE_RAIL_MAX_WIDTH_PX,
    Math.max(FILE_TREE_RAIL_MIN_WIDTH_PX, Math.round(widthPx)),
  );
}

/**
 * Also keep a usable preview pane: the rail cannot eat more than
 * `maxFraction` of the split container (default 45%).
 */
export function clampFileTreeRailWidthForContainer(
  widthPx: number,
  containerWidthPx: number,
  options?: { maxFraction?: number; minPreviewPx?: number },
): number {
  const maxFraction = options?.maxFraction ?? 0.6;
  const minPreviewPx = options?.minPreviewPx ?? 160;
  const absolute = clampFileTreeRailWidth(widthPx);
  if (!Number.isFinite(containerWidthPx) || containerWidthPx <= 0) {
    return absolute;
  }
  const maxFromFraction = Math.floor(containerWidthPx * maxFraction);
  const maxFromPreview = Math.max(
    FILE_TREE_RAIL_MIN_WIDTH_PX,
    Math.floor(containerWidthPx - minPreviewPx),
  );
  return Math.min(absolute, maxFromFraction, maxFromPreview);
}

export function loadFileTreeRailWidth(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw == null) {
      return FILE_TREE_RAIL_DEFAULT_WIDTH_PX;
    }
    return clampFileTreeRailWidth(Number(raw));
  } catch {
    return FILE_TREE_RAIL_DEFAULT_WIDTH_PX;
  }
}

export function saveFileTreeRailWidth(widthPx: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(clampFileTreeRailWidth(widthPx)));
  } catch {
    // private mode / SSR — ignore
  }
}
