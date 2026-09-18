import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { parseFontMetadata } from './font-parser.js';

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

  const testDir = '/Volumes/BigDisk/Downloads/20260918T075744Z-1-001';
  const testFiles = [
    { file: 'Anthropic Sans.ttf', expectedPrefix: 'Anthropic Sans' },
    { file: 'Anthropic Mono.ttf', expectedPrefix: 'Anthropic Mono' },
    { file: 'Anthropic Serif.ttf', expectedPrefix: 'Anthropic Serif' },
  ];

  for (const { file, expectedPrefix } of testFiles) {
    const fullPath = `${testDir}/${file}`;
    if (existsSync(fullPath)) {
      it(`correctly parses real font ${file}`, () => {
        const buffer = readFileSync(fullPath);
        const arrayBuf = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
        const meta = parseFontMetadata(arrayBuf, file);
        expect(meta.format).toBe('truetype');
        expect(meta.family).toContain(expectedPrefix);
      });
    }
  }
});
