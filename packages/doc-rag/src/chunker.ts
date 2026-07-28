/**
 * Document chunker — splits file content into `DocChunk` units for indexing.
 *
 * v1 strategy (spec §8.2):
 * - Markdown: split on headings / paragraphs / fenced code blocks.
 * - Code: function/class-oriented split; fallback ~200 lines.
 * - Plain text: double-newline paragraphs.
 * - Unsupported extension: skipped at scan time (not an error here).
 *
 * `supportedExtensions` is owned by the chunker instance — never a shared
 * hardcoded constant in apps (spec invariant 4 / P5).
 */
import type { DocChunk, DocChunker } from '@piwin/contracts';
import { CODE_FALLBACK_MAX_LINES } from './limits.js';

/** Language map for known extensions. */
const EXTENSION_LANGUAGE: ReadonlyMap<string, string> = new Map([
  ['.md', 'markdown'],
  ['.markdown', 'markdown'],
  ['.mdx', 'markdown'],
  ['.txt', 'text'],
  ['.ts', 'typescript'],
  ['.tsx', 'typescript'],
  ['.js', 'javascript'],
  ['.jsx', 'javascript'],
  ['.mjs', 'javascript'],
  ['.cjs', 'javascript'],
  ['.py', 'python'],
  ['.rs', 'rust'],
  ['.go', 'go'],
  ['.java', 'java'],
  ['.kt', 'kotlin'],
  ['.swift', 'swift'],
  ['.c', 'c'],
  ['.h', 'c'],
  ['.cpp', 'cpp'],
  ['.hpp', 'cpp'],
  ['.cc', 'cpp'],
  ['.cs', 'csharp'],
  ['.rb', 'ruby'],
  ['.php', 'php'],
  ['.sh', 'shell'],
  ['.bash', 'shell'],
  ['.zsh', 'shell'],
  ['.fish', 'shell'],
  ['.ps1', 'powershell'],
  ['.lua', 'lua'],
  ['.r', 'r'],
  ['.scala', 'scala'],
  ['.clj', 'clojure'],
  ['.ex', 'elixir'],
  ['.exs', 'elixir'],
  ['.erl', 'erlang'],
  ['.hs', 'haskell'],
  ['.ml', 'ocaml'],
  ['.vim', 'vim'],
  ['.sql', 'sql'],
  ['.graphql', 'graphql'],
  ['.gql', 'graphql'],
  ['.proto', 'proto'],
  ['.thrift', 'thrift'],
  ['.dockerfile', 'dockerfile'],
  ['.makefile', 'makefile'],
  ['.cmake', 'cmake'],
  ['.yaml', 'yaml'],
  ['.yml', 'yaml'],
  ['.toml', 'toml'],
  ['.json', 'json'],
  ['.json5', 'json5'],
  ['.jsonc', 'jsonc'],
  ['.ini', 'ini'],
  ['.cfg', 'ini'],
  ['.conf', 'ini'],
  ['.properties', 'ini'],
]);

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdx']);
const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.rs', '.go', '.java', '.kt', '.swift',
  '.c', '.h', '.cpp', '.hpp', '.cc', '.cs',
  '.rb', '.php', '.sh', '.bash', '.zsh', '.fish', '.ps1',
  '.lua', '.r', '.scala', '.clj', '.ex', '.exs', '.erl',
  '.hs', '.ml', '.vim', '.sql', '.graphql', '.gql',
  '.proto', '.thrift',
]);

const PLAIN_TEXT_EXTENSIONS = new Set(['.txt']);

/** All extensions this chunker can process. */
const SUPPORTED_EXTENSIONS: readonly string[] = Object.freeze([
  ...new Set([
    ...MARKDOWN_EXTENSIONS,
    ...CODE_EXTENSIONS,
    ...PLAIN_TEXT_EXTENSIONS,
    '.dockerfile',
    '.makefile',
    '.cmake',
    '.yaml',
    '.yml',
    '.toml',
    '.json',
    '.json5',
    '.jsonc',
    '.ini',
    '.cfg',
    '.conf',
    '.properties',
  ]),
]);

/** Filename-based language overrides (e.g. `Dockerfile`, `Makefile`). */
const FILENAME_LANGUAGE: ReadonlyMap<string, string> = new Map([
  ['dockerfile', 'dockerfile'],
  ['makefile', 'makefile'],
  ['justfile', 'makefile'],
  ['rakefile', 'ruby'],
  ['gemfile', 'ruby'],
]);

export function detectLanguage(filePath: string): string {
  const base = filePath.split(/[\\/]/).pop() ?? filePath;
  const lower = base.toLowerCase();
  const byName = FILENAME_LANGUAGE.get(lower);
  if (byName) return byName;
  const dot = lower.lastIndexOf('.');
  if (dot < 0) return 'text';
  const ext = lower.slice(dot);
  return EXTENSION_LANGUAGE.get(ext) ?? 'text';
}

export function isSupportedExtension(filePath: string): boolean {
  const base = filePath.split(/[\\/]/).pop() ?? filePath;
  const lower = base.toLowerCase();
  if (FILENAME_LANGUAGE.has(lower)) return true;
  const dot = lower.lastIndexOf('.');
  if (dot < 0) return false;
  const ext = lower.slice(dot);
  return SUPPORTED_EXTENSIONS.includes(ext);
}

/** Default v1 chunker. */
export function createDefaultChunker(): DocChunker {
  return {
    supportedExtensions: SUPPORTED_EXTENSIONS,
    chunk(filePath: string, content: string): DocChunk[] {
      const language = detectLanguage(filePath);
      const base = (filePath.split(/[\\/]/).pop() ?? filePath).toLowerCase();
      if (FILENAME_LANGUAGE.has(base)) {
        return chunkPlainText(filePath, content, FILENAME_LANGUAGE.get(base) ?? 'text');
      }
      if (MARKDOWN_EXTENSIONS.has(extOf(filePath))) {
        return chunkMarkdown(filePath, content);
      }
      if (CODE_EXTENSIONS.has(extOf(filePath))) {
        return chunkCode(filePath, content, language);
      }
      if (PLAIN_TEXT_EXTENSIONS.has(extOf(filePath))) {
        return chunkPlainText(filePath, content, language);
      }
      // Config / data files: treat as plain text.
      return chunkPlainText(filePath, content, language);
    },
  };
}

function extOf(filePath: string): string {
  const base = filePath.split(/[\\/]/).pop() ?? filePath;
  const lower = base.toLowerCase();
  const dot = lower.lastIndexOf('.');
  return dot < 0 ? '' : lower.slice(dot);
}

/** Markdown: split on ATX headings, then paragraphs, preserving fenced blocks. */
function chunkMarkdown(filePath: string, content: string): DocChunk[] {
  const lines = content.split('\n');
  const chunks: DocChunk[] = [];
  let current: string[] = [];
  let startLine = 1;
  let inFence = false;

  const flush = (endLineExclusive: number): void => {
    const text = current.join('\n').trim();
    if (text.length > 0) {
      chunks.push({
        filePath,
        content: text,
        startLine,
        endLine: endLineExclusive,
        language: 'markdown',
      });
    }
    current = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const lineNo = index + 1;
    const fenceMatch = /^(\s*)(```|~~~)/.exec(line);
    if (fenceMatch) {
      inFence = !inFence;
      current.push(line);
      continue;
    }
    if (!inFence) {
      const heading = /^(#{1,6})\s/.exec(line);
      if (heading && current.length > 0) {
        flush(lineNo - 1);
        startLine = lineNo;
      }
    }
    current.push(line);
  }
  flush(lines.length);
  return chunks;
}

/** Code: split on top-level function/class/struct declarations; fallback ~200 lines. */
function chunkCode(filePath: string, content: string, language: string): DocChunk[] {
  const lines = content.split('\n');
  const chunks: DocChunk[] = [];

  // Patterns that signal a new top-level block. Conservative — we'd rather
  // over-split than merge unrelated functions.
  const blockStart = /^\s*(export\s+)?(async\s+)?(function|class|struct|enum|interface|type|impl|def|fn|func|pub\s+fn|pub\s+struct|pub\s+enum|public\s+|private\s+|protected\s+|static\s+)/;

  let current: string[] = [];
  let startLine = 1;

  const flush = (endLineExclusive: number): void => {
    const text = current.join('\n').trim();
    if (text.length > 0) {
      chunks.push({
        filePath,
        content: text,
        startLine,
        endLine: endLineExclusive,
        language,
      });
    }
    current = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const lineNo = index + 1;
    if (blockStart.test(line) && current.length > 0) {
      flush(lineNo - 1);
      startLine = lineNo;
    }
    current.push(line);
    if (current.length >= CODE_FALLBACK_MAX_LINES) {
      flush(lineNo);
      startLine = lineNo + 1;
    }
  }
  flush(lines.length);
  return chunks;
}

/** Plain text: split on double-newline paragraphs. */
function chunkPlainText(filePath: string, content: string, language: string): DocChunk[] {
  const paragraphs = content.split(/\n\s*\n/);
  const chunks: DocChunk[] = [];
  let lineCursor = 1;
  for (const paragraph of paragraphs) {
    const text = paragraph.trim();
    if (text.length === 0) {
      // Account for the consumed separator lines.
      lineCursor += paragraph.split('\n').length + 1;
      continue;
    }
    const lineCount = paragraph.split('\n').length;
    chunks.push({
      filePath,
      content: text,
      startLine: lineCursor,
      endLine: lineCursor + lineCount - 1,
      language,
    });
    lineCursor += lineCount + 1; // +1 for the blank-line separator
  }
  return chunks;
}
