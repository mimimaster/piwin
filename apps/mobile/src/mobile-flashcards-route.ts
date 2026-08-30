import { isFlashcardStudyId, isPathLikeFlashcardStudyId } from '@piwin/contracts';

export type MobileFlashcardsRoute =
  | { kind: 'catalog' }
  | { kind: 'study'; roundId: string };

export type MobileFlashcardsOverlay = 'end-confirm';

export type MobileFlashcardsHistoryState = {
  mobileFlashcards?: MobileFlashcardsRoute;
  overlay?: MobileFlashcardsOverlay;
};

const CATALOG_HASH = '#flashcards';
const STUDY_HASH_PREFIX = '#flashcards/study/';

function normalizeHash(hash: string): string {
  return hash.startsWith('#') ? hash : `#${hash}`;
}

/** Safe parse. Path-like or unknown IDs never become a study route. */
export function parseMobileFlashcardsRoute(
  hash = typeof window === 'undefined' ? '' : window.location.hash,
): MobileFlashcardsRoute | null {
  const normalized = normalizeHash(hash).split('?')[0] ?? '';
  if (normalized.toLowerCase() === CATALOG_HASH) return { kind: 'catalog' };
  if (!normalized.toLowerCase().startsWith(STUDY_HASH_PREFIX)) return null;
  const rawId = normalized.slice(STUDY_HASH_PREFIX.length);
  if (!rawId || rawId.includes('/') || rawId.includes('\\')) return null;
  let roundId = rawId;
  try {
    roundId = decodeURIComponent(rawId);
  } catch {
    return null;
  }
  if (!isFlashcardStudyId(roundId) || isPathLikeFlashcardStudyId(roundId)) return null;
  return { kind: 'study', roundId };
}

export function mobileFlashcardsHash(route: MobileFlashcardsRoute): string {
  if (route.kind === 'catalog') return CATALOG_HASH;
  return `${STUDY_HASH_PREFIX}${encodeURIComponent(route.roundId)}`;
}

export function readMobileFlashcardsHistoryState(
  state: unknown = typeof history === 'undefined' ? null : history.state,
): MobileFlashcardsHistoryState {
  if (state === null || typeof state !== 'object') return {};
  const record = state as Record<string, unknown>;
  const next: MobileFlashcardsHistoryState = {};
  const route = record.mobileFlashcards;
  if (route && typeof route === 'object') {
    const parsed = route as Record<string, unknown>;
    if (parsed.kind === 'catalog') next.mobileFlashcards = { kind: 'catalog' };
    if (parsed.kind === 'study' && typeof parsed.roundId === 'string') {
      const study = parseMobileFlashcardsRoute(mobileFlashcardsHash({ kind: 'study', roundId: parsed.roundId }));
      if (study) next.mobileFlashcards = study;
    }
  }
  if (record.overlay === 'end-confirm') next.overlay = 'end-confirm';
  return next;
}

export function historyStateHasFlashcardsOverlay(state: unknown): boolean {
  return readMobileFlashcardsHistoryState(state).overlay === 'end-confirm';
}

function writeLocation(hash: string, mode: 'push' | 'replace', state: MobileFlashcardsHistoryState): void {
  if (typeof window === 'undefined') return;
  const url = `${window.location.pathname}${window.location.search}${hash}`;
  if (mode === 'replace') history.replaceState(state, '', url);
  else history.pushState(state, '', url);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

/**
 * Enter catalog or study. Same-hash push is a no-op so flip/rate cannot spam history.
 * Overlay helper layers use `pushMobileFlashcardsOverlay` instead.
 */
export function navigateMobileFlashcardsRoute(
  route: MobileFlashcardsRoute,
  mode: 'push' | 'replace' = 'push',
): void {
  if (typeof window === 'undefined') return;
  const hash = mobileFlashcardsHash(route);
  if (window.location.hash === hash && mode === 'push') return;
  writeLocation(hash, mode, { mobileFlashcards: route });
}

/** Same-URL history entry so system back closes the helper overlay first. */
export function pushMobileFlashcardsOverlay(overlay: MobileFlashcardsOverlay): void {
  if (typeof window === 'undefined') return;
  const route = parseMobileFlashcardsRoute();
  if (!route) return;
  if (historyStateHasFlashcardsOverlay(history.state)) return;
  history.pushState({ mobileFlashcards: route, overlay }, '', window.location.href);
}

export function replaceMobileFlashcardsOverlayClosed(): void {
  if (typeof window === 'undefined') return;
  const route = parseMobileFlashcardsRoute();
  if (!route) return;
  history.replaceState({ mobileFlashcards: route }, '', window.location.href);
}

export function popMobileFlashcardsOverlay(): void {
  if (typeof window === 'undefined') return;
  if (historyStateHasFlashcardsOverlay(history.state)) {
    history.back();
    return;
  }
  replaceMobileFlashcardsOverlayClosed();
}

/** Leave the workbench without a fake multi-layer replace. */
export function leaveMobileFlashcardsToChat(): void {
  if (typeof window === 'undefined') return;
  const url = `${window.location.pathname}${window.location.search}`;
  history.replaceState(null, '', url);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

export function subscribeMobileFlashcardsRoute(
  listener: (route: MobileFlashcardsRoute | null) => void,
): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const emit = (): void => {
    listener(parseMobileFlashcardsRoute());
  };
  window.addEventListener('hashchange', emit);
  emit();
  return () => window.removeEventListener('hashchange', emit);
}
