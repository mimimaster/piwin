import { describe, expect, it } from 'vitest';
import {
  canGoShellBack,
  canGoShellForward,
  createInitialShellNavigation,
  currentShellRoute,
  goShellBack,
  goShellForward,
  leaveSettingsRoute,
  pushShellRoute,
  resolveShellSubPage,
} from './shell-navigation';

describe('shell navigation stack', () => {
  it('starts on workspace with no back/forward', () => {
    const initial = createInitialShellNavigation();
    expect(currentShellRoute(initial)).toEqual({ kind: 'workspace' });
    expect(canGoShellBack(initial)).toBe(false);
    expect(canGoShellForward(initial)).toBe(false);
  });

  it('opens settings as a push, then back restores workspace', () => {
    const withSettings = pushShellRoute(createInitialShellNavigation(), {
      kind: 'settings',
      section: 'general',
    });
    expect(currentShellRoute(withSettings)).toEqual({
      kind: 'settings',
      section: 'general',
    });
    expect(canGoShellBack(withSettings)).toBe(true);
    expect(canGoShellForward(withSettings)).toBe(false);

    const backToWorkspace = goShellBack(withSettings);
    expect(currentShellRoute(backToWorkspace)).toEqual({ kind: 'workspace' });
    expect(canGoShellBack(backToWorkspace)).toBe(false);
    expect(canGoShellForward(backToWorkspace)).toBe(true);

    const forwardToSettings = goShellForward(backToWorkspace);
    expect(currentShellRoute(forwardToSettings)).toEqual({
      kind: 'settings',
      section: 'general',
    });
  });

  it('replaces settings section in place instead of stacking tabs', () => {
    const opened = pushShellRoute(createInitialShellNavigation(), {
      kind: 'settings',
      section: 'general',
    });
    const switched = pushShellRoute(opened, {
      kind: 'settings',
      section: 'models',
    });
    expect(switched.entries).toHaveLength(2);
    expect(currentShellRoute(switched)).toEqual({
      kind: 'settings',
      section: 'models',
    });
    expect(canGoShellBack(switched)).toBe(true);
  });

  it('discards forward entries when pushing after going back', () => {
    const opened = pushShellRoute(createInitialShellNavigation(), {
      kind: 'settings',
      section: 'general',
    });
    const back = goShellBack(opened);
    const reopened = pushShellRoute(back, {
      kind: 'settings',
      section: 'skills',
    });
    expect(reopened.entries).toHaveLength(2);
    expect(currentShellRoute(reopened)).toEqual({
      kind: 'settings',
      section: 'skills',
    });
    expect(canGoShellForward(reopened)).toBe(false);
  });

  it('maps the retired knowledge overlay onto the flashcards home', () => {
    expect(resolveShellSubPage({ kind: 'knowledge' })).toBe('flashcards');
    expect(resolveShellSubPage({ kind: 'flashcards' })).toBe('flashcards');
    expect(resolveShellSubPage({ kind: 'workspace' })).toBeNull();
  });

  it('treats flashcards gallery and wiki as distinct stack entries', () => {
    const opened = pushShellRoute(createInitialShellNavigation(), {
      kind: 'flashcards',
      entry: 'gallery',
    });
    const wiki = pushShellRoute(opened, { kind: 'flashcards', entry: 'wiki' });
    expect(wiki.entries).toHaveLength(3);
    expect(currentShellRoute(wiki)).toEqual({ kind: 'flashcards', entry: 'wiki' });
    const sameWiki = pushShellRoute(wiki, { kind: 'flashcards', entry: 'wiki' });
    expect(sameWiki).toBe(wiki);
  });

  it('leaveSettingsRoute returns to workspace without inventing extra entries', () => {
    const opened = pushShellRoute(createInitialShellNavigation(), {
      kind: 'settings',
      section: 'tools',
    });
    const left = leaveSettingsRoute(opened);
    expect(currentShellRoute(left)).toEqual({ kind: 'workspace' });
    expect(canGoShellForward(left)).toBe(true);
  });
});
