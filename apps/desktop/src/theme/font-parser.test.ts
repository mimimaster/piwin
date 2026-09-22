import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { parseFontMetadata, sanitizeFontFamilyName } from './font-parser.js';

describe('font-parser', () => {
  it('detects formats and infers clean names from filenames when SFNT table is absent', () => {
    const dummyBuffer = new ArrayBuffer(8);
    const metaWoff2 = parseFontMetadata(dummyBuffer, 'My-Custom_Font.woff2');
    expect(metaWoff2.format).toBe('woff2');
    expect(metaWoff2.family).toBe('My Custom Font');

    const metaOtf = parseFontMetadata(dummyBuffer, 'FiraCode-Regular.otf');
    expect(metaOtf.format).toBe('opentype');
    expect(metaOtf.family).toBe('FiraCode Regular');
  });

  it('strips the vendor word from a family name in any case', () => {
    expect(sanitizeFontFamilyName('Anthropic Sans Variable')).toBe('Sans Variable');
    expect(sanitizeFontFamilyName('ANTHROPIC Mono Web')).toBe('Mono Web');
    expect(sanitizeFontFamilyName('anthropicSerif')).toBe('Serif');
    expect(sanitizeFontFamilyName('Anthropic')).toBe('Custom Font');
  });

  it('strips the vendor word from a filename fallback too', () => {
    const dummyBuffer = new ArrayBuffer(8);
    expect(parseFontMetadata(dummyBuffer, 'Anthropic Sans.ttf').family).toBe('Sans');
  });

  it('detects format from magic bytes', () => {
    // Magic for wOFF
    const woffBuf = new Uint8Array([0x77, 0x4f, 0x46, 0x46, 0, 0, 0, 0]).buffer;
    expect(parseFontMetadata(woffBuf, 'font.bin').format).toBe('woff');

    // Magic for wOF2
    const woff2Buf = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0, 0, 0, 0]).buffer;
    expect(parseFontMetadata(woff2Buf, 'font.bin').format).toBe('woff2');

    // Magic for OTTO
    const ottoBuf = new Uint8Array([0x4f, 0x54, 0x54, 0x4f, 0, 0, 0, 0]).buffer;
    expect(parseFontMetadata(ottoBuf, 'font.bin').format).toBe('opentype');
  });

  const testDir = 'public/fonts/default';
  const testFiles = [
    { file: 'sans.ttf', expected: 'Sans Variable' },
    { file: 'mono.ttf', expected: 'Mono Web' },
    { file: 'serif.ttf', expected: 'Serif Variable' },
  ];

  for (const { file, expected } of testFiles) {
    const fullPath = `${testDir}/${file}`;
    if (existsSync(fullPath)) {
      it(`parses ${file} without the vendor word`, () => {
        const buffer = readFileSync(fullPath);
        const arrayBuf = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
        const meta = parseFontMetadata(arrayBuf, file);
        expect(meta.format).toBe('truetype');
        expect(meta.family).toBe(expected);
        expect(meta.family.toLowerCase()).not.toContain('anthropic');
      });
    }
  }
});
