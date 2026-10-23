/**
 * @xterm/addon-fit 0.11 sizes the grid as
 * `parentWidth - padding - (scrollback === 0 ? 0 : overviewRuler.width || 14)`.
 * A full-screen CLI paints to the last column, so that 14px reserve is an
 * empty band down the right edge. Measure the fitted grid and give those
 * columns back; the bar itself is hidden in CSS.
 */
export function fullBleedColumns(input: {
  screenWidth: number;
  columns: number;
  containerWidth: number;
  paddingX: number;
}): number | undefined {
  if (input.columns < 2 || input.screenWidth <= 0 || input.containerWidth <= 0) {
    return undefined;
  }
  const cellWidth = input.screenWidth / input.columns;
  if (!Number.isFinite(cellWidth) || cellWidth <= 0) {
    return undefined;
  }
  const available = input.containerWidth - input.paddingX;
  const columns = Math.floor(available / cellWidth);
  if (!Number.isFinite(columns) || columns <= input.columns) {
    return undefined;
  }
  return columns;
}
