import { describe, expect, it, beforeEach } from 'vitest';
import {
  clearCustomFonts,
  deleteCustomFont,
  getCustomFont,
  listCustomFonts,
  saveCustomFont,
} from './font-storage.js';

describe('font-storage', () => {
  beforeEach(async () => {
    await clearCustomFonts();
  });

  it('saves, lists, retrieves, and deletes custom font files', async () => {
    const data = new Uint8Array([1, 2, 3, 4]).buffer;
    const font = await saveCustomFont({
      family: 'Sans Variable',
      fileName: 'sans.ttf',
      format: 'truetype',
      data,
    });

    expect(font.id).toBeDefined();
    expect(font.family).toBe('Sans Variable');
    expect(font.size).toBe(4);

    const list = await listCustomFonts();
    expect(list.length).toBe(1);
    expect(list[0]?.id).toBe(font.id);

    const retrieved = await getCustomFont(font.id);
    expect(retrieved?.family).toBe('Sans Variable');

    await deleteCustomFont(font.id);
    const afterDelete = await listCustomFonts();
    expect(afterDelete.length).toBe(0);
  });
});
