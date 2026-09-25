import type { HighlighterCore, ThemedToken } from 'shiki/core';
import { GRAMMAR_LOADERS } from './grammar-loaders.js';

/**
 * Lazily created Shiki highlighter for file previews and code fences.
 * The JS regex engine avoids WASM in WKWebView; grammars load per language
 * on first use; both paper and ink colours come back on every token so a
 * face switch needs no re-tokenization.
 */
// Theme names as registered by the two theme modules loaded below.
const LIGHT_THEME = 'github-light';
const DARK_THEME = 'github-dark';
/** Above this, preview as plain text: tokenizing runs on the UI thread. */
export const MAX_HIGHLIGHT_CHARS = 120_000;
/** Pathological minified lines are shown plain rather than tokenized. */
const MAX_LINE_CHARS = 2_000;

export type HighlightedLine = Array<{ content: string; light: string | undefined; dark: string | undefined }>;

let highlighterPromise: Promise<HighlighterCore> | null = null;
const loaded = new Set<string>();

/**
 * Core build: two themes and the JS engine only. The full `shiki` entry would
 * pull every theme plus the Oniguruma WASM into the app bundle.
 */
function highlighter(): Promise<HighlighterCore> {
  highlighterPromise ??= Promise.all([import('shiki/core'), import('shiki/engine/javascript')]).then(
    ([{ createHighlighterCore }, { createJavaScriptRegexEngine }]) =>
      createHighlighterCore({
        themes: [import('shiki/themes/github-light.mjs'), import('shiki/themes/github-dark.mjs')],
        langs: [],
        engine: createJavaScriptRegexEngine(),
      }),
  );
  return highlighterPromise;
}


/** Tokenize `code`; resolves undefined when the file is too large or the grammar is unavailable. */
export async function highlightCode(code: string, language: string): Promise<HighlightedLine[] | undefined> {
  if (code.length > MAX_HIGHLIGHT_CHARS) return undefined;
  const hl = await highlighter();
  if (!loaded.has(language)) {
    const loader = GRAMMAR_LOADERS[language];
    if (loader === undefined) return undefined;
    try {
      await hl.loadLanguage(loader);
      loaded.add(language);
    } catch (error: unknown) {
      console.warn(`[highlight] grammar unavailable: ${language}`, error);
      return undefined;
    }
  }
  const lines = code.split('\n');
  const plainLines = new Set<number>();
  lines.forEach((line, index) => {
    if (line.length > MAX_LINE_CHARS) plainLines.add(index);
  });
  const source = plainLines.size === 0 ? code : lines.map((line, index) => (plainLines.has(index) ? '' : line)).join('\n');
  const result = hl.codeToTokens(source, {
    lang: language,
    themes: { light: LIGHT_THEME, dark: DARK_THEME },
    defaultColor: false,
  });
  return result.tokens.map((tokens: ThemedToken[], index) =>
    plainLines.has(index)
      ? [{ content: lines[index] ?? '', light: undefined, dark: undefined }]
      : tokens.map((token) => ({
          content: token.content,
          light: token.htmlStyle?.['--shiki-light'],
          dark: token.htmlStyle?.['--shiki-dark'],
        })),
  );
}
