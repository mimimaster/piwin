/**
 * Extracts font family name and format from font binary buffers and filenames.
 * Supports SFNT TrueType / OpenType name tables, with safe fallback to cleaned filenames.
 */

export interface ParsedFontMeta {
  family: string;
  format: 'truetype' | 'opentype' | 'woff' | 'woff2';
}

function detectFontFormat(view: DataView, fileName: string): 'truetype' | 'opentype' | 'woff' | 'woff2' {
  if (view.byteLength >= 4) {
    const magic = String.fromCharCode(
      view.getUint8(0),
      view.getUint8(1),
      view.getUint8(2),
      view.getUint8(3),
    );
    if (magic === 'wOFF') return 'woff';
    if (magic === 'wOF2') return 'woff2';
    if (magic === 'OTTO') return 'opentype';
    if (magic === 'true' || (view.getUint8(0) === 0 && view.getUint8(1) === 1 && view.getUint8(2) === 0 && view.getUint8(3) === 0)) {
      return 'truetype';
    }
  }

  const lower = fileName.toLowerCase();
  if (lower.endsWith('.woff2')) return 'woff2';
  if (lower.endsWith('.woff')) return 'woff';
  if (lower.endsWith('.otf')) return 'opentype';
  return 'truetype';
}

/**
 * Product-facing family name. The word "anthropic" is never shown, in any case.
 */
export function sanitizeFontFamilyName(name: string): string {
  const stripped = name
    .replace(/anthropic/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return stripped.length > 0 ? stripped : 'Custom Font';
}

function cleanFamilyFromFileName(fileName: string): string {
  const withoutExt = fileName.replace(/\.[a-zA-Z0-9]+$/, '');
  const cleaned = withoutExt.replace(/[_-]+/g, ' ').trim();
  return cleaned.length > 0 ? cleaned : 'Custom Font';
}

/**
 * Extracts the font family name from the SFNT TrueType/OpenType `name` table.
 * Returns null if the name table cannot be located or parsed.
 */
function parseSfntFamilyName(view: DataView): string | null {
  try {
    if (view.byteLength < 12) return null;
    const numTables = view.getUint16(4);
    let nameTableOffset = 0;

    for (let i = 0; i < numTables; i++) {
      const recordOffset = 12 + i * 16;
      if (recordOffset + 16 > view.byteLength) break;
      const tag = String.fromCharCode(
        view.getUint8(recordOffset),
        view.getUint8(recordOffset + 1),
        view.getUint8(recordOffset + 2),
        view.getUint8(recordOffset + 3),
      );
      if (tag === 'name') {
        nameTableOffset = view.getUint32(recordOffset + 8);
        break;
      }
    }

    if (nameTableOffset === 0 || nameTableOffset + 6 > view.byteLength) return null;

    const count = view.getUint16(nameTableOffset + 2);
    const stringOffset = nameTableOffset + view.getUint16(nameTableOffset + 4);
    if (stringOffset > view.byteLength) return null;

    let candidateName: string | null = null;

    for (let i = 0; i < count; i++) {
      const rec = nameTableOffset + 6 + i * 12;
      if (rec + 12 > view.byteLength) break;

      const platformId = view.getUint16(rec);
      const encodingId = view.getUint16(rec + 2);
      const nameId = view.getUint16(rec + 6);
      const length = view.getUint16(rec + 8);
      const offset = view.getUint16(rec + 10);

      const strStart = stringOffset + offset;
      if (strStart + length > view.byteLength) continue;

      // Name ID 1 = Font Family, Name ID 16 = Typographic Family, Name ID 4 = Full Name
      if (nameId === 1 || nameId === 16 || nameId === 4) {
        let str = '';
        if (platformId === 0 || (platformId === 3 && (encodingId === 1 || encodingId === 10))) {
          // UTF-16BE
          for (let j = 0; j < length - 1; j += 2) {
            str += String.fromCharCode(view.getUint16(strStart + j));
          }
        } else if (platformId === 1 && encodingId === 0) {
          // Mac Roman
          for (let j = 0; j < length; j++) {
            str += String.fromCharCode(view.getUint8(strStart + j));
          }
        } else if (platformId === 3 && encodingId === 0) {
          // Symbol / ASCII-compatible
          for (let j = 0; j < length; j++) {
            const charCode = view.getUint8(strStart + j);
            if (charCode !== 0) str += String.fromCharCode(charCode);
          }
        }

        const trimmed = str.trim();
        if (trimmed) {
          if (nameId === 16) {
            // Preferred typographic family takes highest priority
            return trimmed;
          }
          if (nameId === 1 && !candidateName) {
            candidateName = trimmed;
          } else if (!candidateName) {
            candidateName = trimmed;
          }
        }
      }
    }

    return candidateName;
  } catch {
    return null;
  }
}

/**
 * Parses font metadata from buffer and file name.
 * The displayed family never contains "anthropic".
 */
export function parseFontMetadata(buffer: ArrayBuffer, fileName: string): ParsedFontMeta {
  const view = new DataView(buffer);
  const format = detectFontFormat(view, fileName);
  const parsedFamily = parseSfntFamilyName(view);
  const raw = parsedFamily && parsedFamily.length > 0 ? parsedFamily : cleanFamilyFromFileName(fileName);

  return { family: sanitizeFontFamilyName(raw), format };
}
