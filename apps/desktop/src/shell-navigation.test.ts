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

  it('routes knowledge bases to their own subpage', () => {
    expect(resolveShellSubPage({ kind: 'knowledge' })).toBe('knowledge');
    expect(resolveShellSubPage({ kind: 'flashcards' })).toBe('flashcards');
    expect(resolveShellSubPage({ kind: 'marketplace' })).toBe('marketplace');
    expect(resolveShellSubPage({ kind: 'workspace' })).toBeNull();
  });

  it('treats flashcards produce targets as distinct stack entries per folder', () => {
    const opened = pushShellRoute(createInitialShellNavigation(), {
      kind: 'flashcards',
      entry: 'gallery',
    });
    const produce = pushShellRoute(opened, {
      kind: 'flashcards',
      entry: 'produce',
      folderPath: '/docs/a',
    });
    expect(produce.entries).toHaveLength(3);
    expect(pushShellRoute(produce, { kind: 'flashcards', entry: 'produce', folderPath: '/docs/a' })).toBe(
      produce,
    );
    const other = pushShellRoute(produce, { kind: 'flashcards', entry: 'produce', folderPath: '/docs/b' });
    expect(other.entries).toHaveLength(4);
    expect(currentShellRoute(other)).toEqual({
      kind: 'flashcards',
      entry: 'produce',
      folderPath: '/docs/b',
    });
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
