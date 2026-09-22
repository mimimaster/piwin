import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const documentCss = readFileSync(join(here, 'document.css'), 'utf8');

describe('Inkstone document typography unified rules', () => {
  it('defines derived typography scale variables on .markdown', () => {
    expect(documentCss).toContain('--md-table-font-size: calc(var(--chat-font-size) * 0.95);');
    expect(documentCss).toContain('--md-table-line-height: 1.65;');
    expect(documentCss).toContain('--md-code-inline-font-size: calc(var(--chat-font-size) * 0.9);');
    expect(documentCss).toContain('--md-code-inline-line-height: 1.4;');
  });

  it('paints inline code pure red, not ink', () => {
    expect(documentCss).toMatch(
      /\.markdown \.md-inline-code\s*\{[^}]*color:\s*var\(--inline-code, #c4232b\)/,
    );
  });

  it('unifies inline code size and line-height directly with reading base', () => {
    expect(documentCss).toMatch(
      /\.markdown \.md-inline-code\s*\{[^}]*font-size:\s*var\(--md-code-inline-font-size/,
    );
    expect(documentCss).toMatch(
      /\.markdown \.md-inline-code\s*\{[^}]*line-height:\s*var\(--md-code-inline-line-height/,
    );
    expect(documentCss).toMatch(
      /\.markdown \.md-inline-code\s*\{[^}]*border:\s*0;/,
    );
  });

  it('paints openable transcript file chips pure blue, icon included', () => {
    expect(documentCss).toContain('color: var(--file-link);');
    expect(documentCss).toMatch(
      /\.role-assistant \.markdown :is\(a\.pc, a\.md-doc-chip\):not\(\.static\) :is\(\.chip-dir, \.chip-file/,
    );
  });

  it('scopes reading area path chips to match inline code metrics without button shadow', () => {
    expect(documentCss).toMatch(
      /\.markdown :is\(\.pc, \.md-doc-chip\)\s*\{[^}]*font-size:\s*var\(--md-code-inline-font-size/,
    );
    expect(documentCss).toMatch(
      /\.markdown :is\(\.pc, \.md-doc-chip\)\s*\{[^}]*line-height:\s*var\(--md-code-inline-line-height/,
    );
    expect(documentCss).toMatch(
      /\.markdown :is\(\.pc, \.md-doc-chip\)\s*\{[^}]*vertical-align:\s*-0\.12em;/,
    );
    expect(documentCss).toMatch(
      /\.markdown :is\(\.pc, \.md-doc-chip\)\s*\{[^}]*box-shadow:\s*none;/,
    );
  });

  it('aligns table cells to top and scales table text smoothly with reading size', () => {
    expect(documentCss).toMatch(
      /\.markdown \.md-table\s*\{[^}]*font-size:\s*var\(--md-table-font-size/,
    );
    expect(documentCss).toMatch(
      /\.markdown \.md-table\s*\{[^}]*line-height:\s*var\(--md-table-line-height/,
    );
    expect(documentCss).toMatch(
      /\.markdown \.md-table th,\s*\.markdown \.md-table td\s*\{[^}]*vertical-align:\s*top;/,
    );
    expect(documentCss).toMatch(
      /\.markdown \.md-table th,\s*\.markdown \.md-table td\s*\{[^}]*overflow-wrap:\s*break-word;/,
    );
    expect(documentCss).toMatch(
      /\.markdown \.md-table th\s*\{[^}]*font-size:\s*inherit;/,
    );
  });

  it('scales paragraph margin proportionally with reading font size', () => {
    expect(documentCss).toMatch(
      /\.markdown :is\(p, \.md-p\)\s*\{[^}]*margin:\s*0 0 calc\(var\(--chat-font-size\) \* 0\.75\);/,
    );
  });
});
