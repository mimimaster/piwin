/**
 * Which edges of a scroller currently hide content. Drives edge fades that
 * should appear only when something is actually clipped — a fade on an edge
 * the user is already resting against would just dim the first/last row.
 */
export interface ScrollEdgeOverflow {
  above: boolean;
  below: boolean;
}

export interface ScrollEdgeMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/** Sub-pixel slack: zoomed / fractional layouts never land exactly on 0 or max. */
const SCROLL_EDGE_TOLERANCE_PX = 1;

export function measureScrollEdgeOverflow(metrics: ScrollEdgeMetrics): ScrollEdgeOverflow {
  const maxScrollTop = metrics.scrollHeight - metrics.clientHeight;
  return {
    above: metrics.scrollTop > SCROLL_EDGE_TOLERANCE_PX,
    below: maxScrollTop - metrics.scrollTop > SCROLL_EDGE_TOLERANCE_PX,
  };
}
