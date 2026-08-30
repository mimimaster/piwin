// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import {
  historyStateHasFlashcardsOverlay,
  leaveMobileFlashcardsToChat,
  mobileFlashcardsHash,
  navigateMobileFlashcardsRoute,
  parseMobileFlashcardsRoute,
  popMobileFlashcardsOverlay,
  pushMobileFlashcardsOverlay,
  replaceMobileFlashcardsOverlayClosed,
} from './mobile-flashcards-route.js';

function pageUrl(hash = ''): string {
  return `${window.location.pathname}${window.location.search}${hash}`;
}

afterEach(() => {
  history.replaceState(null, '', pageUrl());
});

describe('parseMobileFlashcardsRoute', () => {
  it('parses catalog and well-formed study hashes', () => {
    expect(parseMobileFlashcardsRoute('#flashcards')).toEqual({ kind: 'catalog' });
    expect(parseMobileFlashcardsRoute('#FLASHCARDS')).toEqual({ kind: 'catalog' });
    expect(parseMobileFlashcardsRoute('#flashcards/study/round-1')).toEqual({
      kind: 'study',
      roundId: 'round-1',
    });
    expect(mobileFlashcardsHash({ kind: 'catalog' })).toBe('#flashcards');
  });

  it('rejects path-like, empty, and unknown study IDs at parse time', () => {
    expect(parseMobileFlashcardsRoute('#flashcards/study/')).toBeNull();
    expect(parseMobileFlashcardsRoute('#flashcards/study/../etc')).toBeNull();
    expect(parseMobileFlashcardsRoute('#flashcards/study/%2e%2e%2fetc')).toBeNull();
    expect(parseMobileFlashcardsRoute('#flashcards/study/C:\\Users\\host')).toBeNull();
    expect(parseMobileFlashcardsRoute('#flashcards/study/a/b')).toBeNull();
    expect(parseMobileFlashcardsRoute('#sidebar')).toBeNull();
    expect(parseMobileFlashcardsRoute('')).toBeNull();
  });
});

describe('navigateMobileFlashcardsRoute history', () => {
  it('does not push a history entry when the study hash is unchanged (flip/rate)', () => {
    history.replaceState(null, '', pageUrl());
    navigateMobileFlashcardsRoute({ kind: 'catalog' }, 'push');
    navigateMobileFlashcardsRoute({ kind: 'study', roundId: 'round-1' }, 'push');
    const lengthAfterEnter = history.length;
    navigateMobileFlashcardsRoute({ kind: 'study', roundId: 'round-1' }, 'push');
    navigateMobileFlashcardsRoute({ kind: 'study', roundId: 'round-1' }, 'push');
    expect(window.location.hash).toBe('#flashcards/study/round-1');
    expect(history.length).toBe(lengthAfterEnter);
  });

  it('replace from an overlay hash becomes a real catalog page, not another overlay', () => {
    history.replaceState(null, '', pageUrl('#sidebar'));
    navigateMobileFlashcardsRoute({ kind: 'catalog' }, 'replace');
    expect(window.location.hash).toBe('#flashcards');
    expect(parseMobileFlashcardsRoute()).toEqual({ kind: 'catalog' });
  });

  it('system-back overlay layering uses same-URL history, not replaceState of all layers', () => {
    navigateMobileFlashcardsRoute({ kind: 'study', roundId: 'round-9' }, 'replace');
    const lengthBeforeOverlay = history.length;
    pushMobileFlashcardsOverlay('end-confirm');
    expect(historyStateHasFlashcardsOverlay(history.state)).toBe(true);
    expect(window.location.hash).toBe('#flashcards/study/round-9');
    expect(history.length).toBeGreaterThanOrEqual(lengthBeforeOverlay);

    popMobileFlashcardsOverlay();
    expect(window.location.hash).toBe('#flashcards/study/round-9');

    replaceMobileFlashcardsOverlayClosed();
    expect(historyStateHasFlashcardsOverlay(history.state)).toBe(false);
    expect(parseMobileFlashcardsRoute()).toEqual({ kind: 'study', roundId: 'round-9' });
  });

  it('leave to chat clears the page hash without claiming study layers closed', () => {
    navigateMobileFlashcardsRoute({ kind: 'catalog' }, 'replace');
    leaveMobileFlashcardsToChat();
    expect(window.location.hash).toBe('');
    expect(parseMobileFlashcardsRoute()).toBeNull();
  });
});
