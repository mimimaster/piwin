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
    }
  });

  it('keeps group ids unique and recommended first', () => {
    const groupIds = SHORTCUT_CATALOG.map((group) => group.id);
    expect(new Set(groupIds).size).toBe(groupIds.length);
    expect(groupIds[0]).toBe('recommended');
  });
});
