/**
 * KaTeX helpers for chat markdown (CE-MD-01).
 * Soft-fail: never throw into the chat shell; return source on error.
 * trust:false — no untrusted HTML from TeX.
 */

import katex from 'katex';

export type KatexRenderResult =
  | { ok: true; html: string }
  | { ok: false; error: string; source: string };

export function renderKatex(tex: string, displayMode: boolean): KatexRenderResult {
  const source = tex.trim();
  if (!source) {
    return { ok: false, error: 'Empty math expression', source: tex };
  }
  try {
    const html = katex.renderToString(source, {
      displayMode,
      throwOnError: true,
      strict: 'ignore',
      // Deny TeX that injects raw HTML into the parent document.
      trust: false,
      output: 'html',
    });
    return { ok: true, html };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message, source };
  }
}

export function isMathFenceLanguage(language: string): boolean {
  const primary = language.trim().toLowerCase().split(/\s+/)[0] ?? '';
  return primary === 'math' || primary === 'latex' || primary === 'katex' || primary === 'tex';
}

export function isMermaidFenceLanguage(language: string): boolean {
  const primary = language.trim().toLowerCase().split(/\s+/)[0] ?? '';
  return primary === 'mermaid';
}

export type InlineMathSegment =
  | { kind: 'text'; value: string }
  | { kind: 'code'; value: string }
  | { kind: 'strong'; value: string }
  | { kind: 'em'; value: string }
  | { kind: 'math'; value: string; display: boolean };

/**
 * Tokenize inline markdown with math priority over emphasis.
 * Scanner avoids fragile multi-escape RegExp sources for math delimiters.
 */
export function tokenizeInlineWithMath(text: string): InlineMathSegment[] {
  const segments: InlineMathSegment[] = [];
  let index = 0;
  let textStart = 0;

  const flushText = (end: number): void => {
    if (end > textStart) {
      segments.push({ kind: 'text', value: text.slice(textStart, end) });
    }
  };

  while (index < text.length) {
    const char = text[index] ?? '';

    // Inline code: `...`
    if (char === '`') {
      const close = text.indexOf('`', index + 1);
      if (close >= 0) {
        flushText(index);
        segments.push({ kind: 'code', value: text.slice(index + 1, close) });
        index = close + 1;
        textStart = index;
        continue;
      }
    }

    // Display math: $$...$$
    if (char === '$' && text[index + 1] === '$') {
      const close = text.indexOf('$$', index + 2);
      if (close >= 0) {
        flushText(index);
        segments.push({ kind: 'math', value: text.slice(index + 2, close), display: true });
        index = close + 2;
        textStart = index;
        continue;
      }
    }

    // Display math: \[...\]
    if (text.startsWith('\\[', index)) {
      const close = text.indexOf('\\]', index + 2);
      if (close >= 0) {
        flushText(index);
        segments.push({ kind: 'math', value: text.slice(index + 2, close), display: true });
        index = close + 2;
        textStart = index;
        continue;
      }
    }

    // Inline math: \(...\)
    if (text.startsWith('\\(', index)) {
      const close = text.indexOf('\\)', index + 2);
      if (close >= 0) {
        flushText(index);
        segments.push({ kind: 'math', value: text.slice(index + 2, close), display: false });
        index = close + 2;
        textStart = index;
        continue;
      }
    }

    // Inline math: $...$ (single dollar, no newlines)
    if (char === '$') {
      let close = index + 1;
      while (close < text.length && text[close] !== '$' && text[close] !== '\n') {
        close += 1;
      }
      if (close < text.length && text[close] === '$' && close > index + 1) {
        flushText(index);
        segments.push({ kind: 'math', value: text.slice(index + 1, close), display: false });
        index = close + 1;
        textStart = index;
        continue;
      }
    }

    // Strong: **...**
    if (char === '*' && text[index + 1] === '*') {
      const close = text.indexOf('**', index + 2);
      if (close >= 0) {
        flushText(index);
        segments.push({ kind: 'strong', value: text.slice(index + 2, close) });
        index = close + 2;
        textStart = index;
        continue;
      }
    }

    // Emphasis: *...*
    if (char === '*') {
      const close = text.indexOf('*', index + 1);
      if (close >= 0) {
        flushText(index);
        segments.push({ kind: 'em', value: text.slice(index + 1, close) });
        index = close + 1;
        textStart = index;
        continue;
      }
    }

    index += 1;
  }

  flushText(text.length);
  return segments;
}

/** Whole-paragraph display math ($$...$$ or \[...\]). */
export function extractStandaloneDisplayMath(paragraph: string): string | null {
  const trimmed = paragraph.trim();
  if (trimmed.startsWith('$$') && trimmed.endsWith('$$') && trimmed.length > 4) {
    return trimmed.slice(2, -2).trim();
  }
  if (trimmed.startsWith('\\[') && trimmed.endsWith('\\]') && trimmed.length > 4) {
    return trimmed.slice(2, -2).trim();
  }
  return null;
}
