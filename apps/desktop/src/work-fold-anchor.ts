/**
 * Open call-chain folds, located through the DOM.
 *
 * A fold is a header (`[data-fold-header]`) and an end marker
 * (`[data-fold-end]`) carrying the same id. The turn-level fold's rows are
 * siblings of its header, not descendants, so its extent is header → marker.
 * Reading geometry straight from the DOM keeps this independent of how the
 * virtualized list is built and costs O(open folds), not O(messages).
 *
 * Collapsing from anywhere else than the header — the rail, the spine, the
 * foot bar, Esc — must not lose the reader's place: the header is usually
 * above the viewport, so the content under the reader vanishes. `collapse…`
 * puts the header back where it was (or just under the rail).
 */

export const FOLD_RAIL_ROW_PX = 30;
/** Folds shown in the rail at once; the deepest ones win. */
export const FOLD_RAIL_MAX_ROWS = 3;

export type OpenFold = {
  id: string;
  header: HTMLElement;
  end: HTMLElement;
  level: 'turn' | 'segment';
  title: string;
  meta: string;
};

/** Open folds in document order (a parent always precedes its children). */
export function collectOpenFolds(container: HTMLElement): OpenFold[] {
  const ends = new Map<string, HTMLElement>();
  for (const end of container.querySelectorAll<HTMLElement>('[data-fold-end]')) {
    const id = end.dataset.foldEnd;
    if (id) ends.set(id, end);
  }
  const folds: OpenFold[] = [];
  for (const header of container.querySelectorAll<HTMLElement>(
    '[data-fold-header][data-fold-open="true"]',
  )) {
    const id = header.dataset.foldHeader;
    const end = id ? ends.get(id) : undefined;
    if (!id || !end) continue;
    folds.push({
      id,
      header,
      end,
      level: header.dataset.foldLevel === 'turn' ? 'turn' : 'segment',
      title: header.dataset.foldTitle ?? '',
      meta: header.dataset.foldMeta ?? '',
    });
  }
  return folds;
}

/**
 * The open folds that contain the top edge of the viewport but whose header
 * has scrolled away — the breadcrumb the reader would otherwise have to
 * scroll back up to find. Each pinned row covers `rowPx`, so the next fold's
 * header only counts as scrolled away once it is under those rows.
 */
export function pinnedFoldChain(container: HTMLElement, rowPx = FOLD_RAIL_ROW_PX): OpenFold[] {
  const top = container.getBoundingClientRect().top;
  const chain: OpenFold[] = [];
  let pinned = 0;
  for (const fold of collectOpenFolds(container)) {
    const headerTop = fold.header.getBoundingClientRect().top;
    const endTop = fold.end.getBoundingClientRect().top;
    if (headerTop < top + pinned + 1 && endTop > top + pinned + rowPx * 1.5) {
      chain.push(fold);
      pinned += rowPx;
    }
  }
  return chain;
}

const SETTLE_FRAMES = 10;

/**
 * Collapse `header`'s fold and keep the header where the reader last saw it.
 * A header that had scrolled above the viewport lands just under the rail rows
 * of its ancestors instead. The virtualizer re-measures the shrunken row over a
 * few frames, so the position is corrected on each of them.
 */
export function collapseFoldWithAnchor(
  container: HTMLElement,
  header: HTMLElement,
  hooks: { beginProgrammaticScroll?: () => void; rowPx?: number } = {},
): void {
  const rowPx = hooks.rowPx ?? FOLD_RAIL_ROW_PX;
  const chain = pinnedFoldChain(container, rowPx);
  const ancestorRows = Math.max(
    0,
    chain.findIndex((fold) => fold.header === header),
  );
  const offsetOf = (): number =>
    header.getBoundingClientRect().top - container.getBoundingClientRect().top;
  const desired = Math.max(offsetOf(), ancestorRows * rowPx + 2);
  header.click();
  let frame = 0;
  const settle = (): void => {
    const delta = offsetOf() - desired;
    if (Math.abs(delta) >= 1) {
      hooks.beginProgrammaticScroll?.();
      container.scrollTop += delta;
    }
    frame += 1;
    if (frame < SETTLE_FRAMES) window.requestAnimationFrame(settle);
  };
  window.requestAnimationFrame(settle);
}
