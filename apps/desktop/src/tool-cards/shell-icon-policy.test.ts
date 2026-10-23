/**
 * Quiet workbench W1 gate: functional UI must not use character/emoji icons.
 * Closing / chevron / pin / settings affordances use shell-icons SVG.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

/** Characters banned as functional icons in TSX (text copy may still use them in strings carefully). */
const FORBIDDEN = /[⚙★×▸▾📄]/u;

/**
 * Skip pure docs/comments lines is hard; flag any source line that is clearly
 * rendering these as icon children (not inside long prose strings).
 */
const RENDER_HINT =
  />\s*[⚙★×▸▾📄]\s*<|{\s*['"`][⚙★×▸▾📄]['"`]\s*}|>\s*[⚙★×▸▾]\s*\{|>\s*[⚙★×▸▾]\s*\n/;

async function listTsxFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'styles' || entry.name === 'node_modules') {
        continue;
      }
      files.push(...(await listTsxFiles(full)));
      continue;
    }
    if (entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx')) {
      files.push(full);
    }
  }
  return files;
}

describe('shell icon policy (quiet workbench)', () => {
  it('does not render character icons in desktop functional UI', async () => {
    const files = await listTsxFiles(SRC_DIR);
    const offenders: string[] = [];
    for (const file of files) {
      const text = await readFile(file, 'utf8');
      const lines = text.split('\n');
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? '';
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
          continue;
        }
        // Allow pure text content like math "×" in copy only if not a JSX child icon pattern.
        if (!FORBIDDEN.test(line)) {
          continue;
        }
        if (RENDER_HINT.test(line) || /['"`][⚙★×▸▾📄]['"`]/.test(line) || />\s*[⚙★×▸▾📄]\s*</.test(line)) {
          offenders.push(`${path.relative(SRC_DIR, file)}:${index + 1}: ${trimmed}`);
        }
        // Standalone JSX text node icon: `      ×` or `                    ★`
        if (/^\s*[⚙★×▸▾📄]\s*$/.test(line)) {
          offenders.push(`${path.relative(SRC_DIR, file)}:${index + 1}: ${trimmed}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
