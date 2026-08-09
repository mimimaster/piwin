/**
 * Shiki-backed syntax highlighting singleton for desktop rendering.
 *
 * Design notes:
 * - Single shared highlighter (lazy-created) to avoid repeating WASM/grammar
 *   init. Languages load on demand (`ensureLanguage`) so we don't bundle every
 *   grammar upfront; first use of a language pays a one-time load cost.
 * - Two themes: `github-dark` for dark mode, `github-light` for light mode.
 *   Theme is read from `document.documentElement.dataset.themeMode` so it
 *   tracks the active desktop appearance without extra React context.
 * - `useHighlight` returns `null` until the first tokens are ready (plain-text
 *   fallback). Theme switches keep the previous tokens painted until the new
 *   highlight resolves, avoiding a plain-text flash / reflow.
 */
import {
  createElement,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type { Highlighter, ThemedToken } from 'shiki';

const DARK_THEME = 'github-dark' as const;
const LIGHT_THEME = 'github-light' as const;

/** Languages preloaded at highlighter creation (cheap, very common). */
const PRELOAD_LANGS = [
  'typescript',
  'javascript',
  'tsx',
  'jsx',
  'json',
  'bash',
  'css',
  'html',
  'markdown',
  'diff',
] as const;

/** Map of common fence-label aliases → shiki language ids. */
const LANG_ALIASES: Record<string, string> = {
  ts: 'typescript',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  rb: 'ruby',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  md: 'markdown',
  rs: 'rust',
  go: 'go',
  kt: 'kotlin',
  'c++': 'cpp',
  'c#': 'csharp',
  cs: 'csharp',
  text: 'typescript',
  plaintext: 'typescript',
  '': 'typescript',
};

let highlighterPromise: Promise<Highlighter> | null = null;
const loadedLanguages = new Set<string>(PRELOAD_LANGS);

/** Pick a shiki theme that contrasts with the active desktop mode. */
export function getShikiTheme(): typeof DARK_THEME | typeof LIGHT_THEME {
  const root = typeof document !== 'undefined' ? document.documentElement : null;
  return root?.dataset.themeMode === 'light' ? LIGHT_THEME : DARK_THEME;
}

function getThemeSnapshot(): typeof DARK_THEME | typeof LIGHT_THEME {
  return getShikiTheme();
}

function subscribeToTheme(callback: () => void): () => void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
    return () => {};
  }
  const target = document.documentElement;
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.attributeName === 'data-theme-mode') {
        callback();
        return;
      }
    }
  });
  observer.observe(target, { attributes: true, attributeFilter: ['data-theme-mode'] });
  return () => observer.disconnect();
}

/** React hook that tracks the active shiki theme across desktop mode switches. */
export function useShikiTheme(): typeof DARK_THEME | typeof LIGHT_THEME {
  return useSyncExternalStore(subscribeToTheme, getThemeSnapshot, () => DARK_THEME);
}

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    // Module loading is part of the lazy boundary too. A static createHighlighter
    // import makes WebKit parse Shiki, TextMate, and language loaders even when
    // every visible code block is still streaming or plain text.
    highlighterPromise = import('shiki').then(({ createHighlighter }) =>
      createHighlighter({
        themes: [DARK_THEME, LIGHT_THEME],
        langs: [...PRELOAD_LANGS],
      }),
    );
  }
  return highlighterPromise;
}

/** Normalize a fence label to a shiki language id. */
export function normalizeLanguage(raw: string): string {
  const lower = raw.trim().toLowerCase();
  if (LANG_ALIASES[lower]) return LANG_ALIASES[lower]!;
  return lower;
}

/** Ensure a language grammar is loaded; no-op if already loaded. */
export async function ensureLanguage(rawLang: string): Promise<string> {
  const lang = normalizeLanguage(rawLang);
  if (loadedLanguages.has(lang)) return lang;
  const hl = await getHighlighter();
  try {
    await hl.loadLanguage(lang as never);
    loadedLanguages.add(lang);
  } catch {
    // Unknown language — fall back to typescript so we still get reasonable
    // tokenization rather than throwing and breaking the render.
    return 'typescript';
  }
  return lang;
}

/** Tokens for one source line. */
export type TokenLine = ThemedToken[];

/**
 * Highlight a whole code block into per-line tokens.
 * Returns `null` if the language is unknown AND fallback also fails (rare).
 */
export async function highlightCode(code: string, rawLang: string): Promise<TokenLine[]> {
  const lang = await ensureLanguage(rawLang);
  const hl = await getHighlighter();
  const result = hl.codeToTokens(code, { lang: lang as never, theme: getShikiTheme() });
  return result.tokens;
}

/**
 * Highlight a single line independently (used for diff lines, where each line
 * is fragmented and must be colored in isolation). The input is the code
 * content with any diff marker already stripped by the caller.
 */
export async function highlightLine(text: string, rawLang: string): Promise<TokenLine> {
  const lines = await highlightCode(text, rawLang);
  return lines[0] ?? ([{ content: text, offset: 0 }] as TokenLine);
}

/**
 * React hook: highlights `code` with `lang`, returning per-line tokens or
 * `null` while pending. Re-runs when `code` or `lang` change.
 */
function isDomAlive(): boolean {
  return typeof document !== 'undefined' && typeof window !== 'undefined';
}

function isTestEnv(): boolean {
  return (typeof process !== 'undefined' && process.env && process.env.VITEST === 'true') || false;
}

export function useHighlight(code: string, lang: string, enabled = true): TokenLine[] | null {
  const [tokens, setTokens] = useState<TokenLine[] | null>(null);
  const theme = useShikiTheme();
  const sourceIdentityRef = useRef<string | null>(enabled ? `${lang}::${code}` : null);

  useEffect(() => {
    if (!enabled) {
      sourceIdentityRef.current = null;
      setTokens((currentTokens) => (currentTokens === null ? currentTokens : null));
      return;
    }
    if (isTestEnv()) {
      // Skip async shiki in unit tests to avoid post-teardown render races.
      // Consumers render the plain-text fallback.
      return;
    }
    let cancelled = false;
    const nextIdentity = `${lang}::${code}`;
    // Drop stale tokens only when source identity changes. Theme flips keep
    // the previous highlight painted so code blocks do not flash/reflow.
    if (sourceIdentityRef.current !== nextIdentity) {
      sourceIdentityRef.current = nextIdentity;
      setTokens(null);
    }
    void highlightCode(code, lang)
      .then((result) => {
        if (!cancelled && isDomAlive()) setTokens(result);
      })
      .catch(() => {
        if (!cancelled && isDomAlive()) setTokens(null);
      });
    return () => {
      cancelled = true;
    };
  }, [code, enabled, lang, theme]);

  return enabled ? tokens : null;
}

/**
 * React hook: highlights many lines independently (no marker stripping).
 * Returns a map from line index → tokens, or `null` while pending.
 * Re-runs when inputs change. Used by diff renderers where each line's code
 * content is highlighted in isolation against the source language.
 */
export function useHighlightLines(lines: string[], lang: string): Map<number, TokenLine> | null {
  const [result, setResult] = useState<Map<number, TokenLine> | null>(null);
  const theme = useShikiTheme();
  const sourceIdentityRef = useRef(`${lang}::${lines.join('\n')}`);

  useEffect(() => {
    if (isTestEnv()) {
      return;
    }
    let cancelled = false;
    const nextIdentity = `${lang}::${lines.join('\n')}`;
    // Keep previous line tokens across theme flips; clear only on source change.
    if (sourceIdentityRef.current !== nextIdentity) {
      sourceIdentityRef.current = nextIdentity;
      setResult(null);
    }
    void Promise.all(lines.map((line) => highlightLine(line, lang)))
      .then((tokenLines) => {
        if (cancelled || !isDomAlive()) return;
        const map = new Map<number, TokenLine>();
        tokenLines.forEach((tl, index) => map.set(index, tl));
        setResult(map);
      })
      .catch(() => {
        if (!cancelled && isDomAlive()) setResult(null);
      });
    return () => {
      cancelled = true;
    };
  }, [lines, lang, theme]);

  return result;
}

/** Infer a shiki language id from a file path's extension. */
export function languageFromPath(path: string): string {
  const extMatch = /\.([a-zA-Z0-9]+)$/.exec(path);
  const ext = extMatch && extMatch[1] ? extMatch[1].toLowerCase() : '';
  return normalizeLanguage(ext);
}

/** Render a single line's tokens as colored spans. */
export function TokenSpans({ tokens }: { tokens: TokenLine }): ReactNode {
  return tokens.map((token, index) =>
    createElement(
      'span',
      { key: index, style: token.color ? { color: token.color } : undefined },
      token.content,
    ),
  );
}
