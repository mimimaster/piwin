/**
 * Web Worker for off-thread Shiki syntax tokenization.
 *
 * Runs Shiki tokenization off the main UI thread and transfers token results
 * packed as compact Uint32Array binary buffers to minimize main-thread GC and layout locks.
 */
import { createHighlighter, createJavaScriptRegexEngine, type Highlighter } from 'shiki';
import {
  encodeTokensToCompact,
  type HighlightWorkerRequest,
  type HighlightWorkerResponse,
} from './highlight-protocol.js';

const DARK_THEME = 'github-dark' as const;
const LIGHT_THEME = 'github-light' as const;

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

let highlighterPromise: Promise<Highlighter> | null = null;
const loadedLanguages = new Set<string>(PRELOAD_LANGS);

async function getWorkerHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: [DARK_THEME, LIGHT_THEME],
      langs: [...PRELOAD_LANGS],
      engine: createJavaScriptRegexEngine(),
    });
  }
  return highlighterPromise;
}

if (typeof self !== 'undefined') {
  self.onmessage = async (event: MessageEvent<HighlightWorkerRequest>) => {
    const req = event.data;
    if (!req || typeof req.code !== 'string') {
      return;
    }

    try {
      const hl = await getWorkerHighlighter();
      let lang = req.language;
      if (!loadedLanguages.has(lang)) {
        try {
          await hl.loadLanguage(lang as never);
          loadedLanguages.add(lang);
        } catch (error: unknown) {
          console.warn(`[highlight-worker] Unable to load '${lang}', using typescript.`, error);
          lang = 'typescript';
        }
      }

      const result = hl.codeToTokens(req.code, {
        lang: lang as never,
        theme: req.theme,
      });

      const lineStart = req.lineStart ?? 0;
      const lineEnd = req.lineEnd ?? result.tokens.length;
      const { palette, runs } = encodeTokensToCompact(
        result.tokens.slice(lineStart, lineEnd),
        lineStart,
      );

      const response: HighlightWorkerResponse = {
        requestId: req.requestId,
        sourceHash: req.sourceHash,
        lineStart,
        lineEnd,
        palette,
        runs,
      };

      // Transfer Uint32Array buffer for zero-copy IPC
      self.postMessage(response, { transfer: [runs.buffer] });
    } catch (error: unknown) {
      console.warn('[highlight-worker] Tokenization failed, keeping plain source.', error);
      // In case of error, produce plain-text token fallback in worker
      const lines = req.code.split('\n');
      const { palette, runs } = encodeTokensToCompact(
        lines.slice(req.lineStart ?? 0, req.lineEnd).map((line) => [{ content: line, offset: 0 }]),
        req.lineStart ?? 0,
      );
      const response: HighlightWorkerResponse = {
        requestId: req.requestId,
        sourceHash: req.sourceHash,
        lineStart: req.lineStart ?? 0,
        lineEnd: req.lineEnd ?? lines.length,
        palette,
        runs,
      };
      self.postMessage(response, { transfer: [runs.buffer] });
    }
  };
}
