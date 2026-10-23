import { describe, expect, it } from 'vitest';
import {
  SHORTCUT_CATALOG,
  detectShortcutDisplayPlatform,
  formatShortcutChordTokens,
  listShortcutCatalogEntries,
  splitShortcutChord,
} from './desktop-shortcut-catalog';

describe('desktop-shortcut-catalog', () => {
  it('splits Apple-style chords into tokens', () => {
    expect(splitShortcutChord('⌘K')).toEqual(['⌘', 'K']);
    expect(splitShortcutChord('⇧⌘F')).toEqual(['⇧', '⌘', 'F']);
    expect(splitShortcutChord('⌘,')).toEqual(['⌘', ',']);
    expect(splitShortcutChord('⌘\\')).toEqual(['⌘', '\\']);
    expect(splitShortcutChord('⌘.')).toEqual(['⌘', '.']);
  });

  it('remaps modifiers for non-Apple platforms', () => {
    expect(formatShortcutChordTokens('⇧⌘F', 'pc')).toEqual(['Shift', 'Ctrl', 'F']);
    expect(formatShortcutChordTokens('⌘K', 'apple')).toEqual(['⌘', 'K']);
  });

  it('detects Apple platforms from UA / platform strings', () => {
    expect(detectShortcutDisplayPlatform('Mozilla/5.0', 'MacIntel')).toBe('apple');
    expect(detectShortcutDisplayPlatform('Mozilla/5.0 (Windows NT 10.0)', 'Win32')).toBe('pc');
  });

  it('covers every catalog entry with a non-empty chord', () => {
    const entries = listShortcutCatalogEntries();
    expect(entries.length).toBeGreaterThan(8);
    for (const entry of entries) {
      expect(entry.chord.length).toBeGreaterThan(0);
      expect(splitShortcutChord(entry.chord).length).toBeGreaterThan(0);
      if (entry.pcChord) {
        expect(splitShortcutChord(entry.pcChord).length).toBeGreaterThan(0);
      }
    }
  });

  it('uses a distinct PC resize chord instead of displaying Ctrl twice', () => {
    const resize = listShortcutCatalogEntries().find((entry) => entry.id === 'pane-resize');
    if (!resize?.pcChord) {
      throw new Error('pane-resize shortcut missing');
    }
    expect(resize.pcChord).toBe('⇧⌥⌘Arrow');
    expect(formatShortcutChordTokens(resize.pcChord, 'pc')).toEqual([
      'Shift',
      'Alt',
      'Ctrl',
      'Arrow',
    ]);
  });

  it('keeps group ids unique and recommended first', () => {
    const groupIds = SHORTCUT_CATALOG.map((group) => group.id);
    expect(new Set(groupIds).size).toBe(groupIds.length);
    expect(groupIds[0]).toBe('recommended');
  });
});
