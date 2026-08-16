import { CODE_FALLBACK_MAX_LINES } from '../limits.js';

export type LegacyCodeSpan = {
  content: string;
  startLine: number;
  endLine: number;
};

const BLOCK_START =
  /^\s*(export\s+)?(async\s+)?(function|class|struct|enum|interface|type|impl|def|fn|func|pub\s+fn|pub\s+struct|pub\s+enum|public\s+|private\s+|protected\s+|static\s+)/;

/** Existing language-list fallback. chunker_id = legacy-code-v1. */
export function splitLegacyCode(content: string): LegacyCodeSpan[] {
  const lines = content.split('\n');
  const spans: LegacyCodeSpan[] = [];
  let current: string[] = [];
  let startLine = 1;

  const flush = (endLine: number): void => {
    const text = current.join('\n').trim();
    if (text.length > 0) {
      spans.push({ content: text, startLine, endLine });
    }
    current = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const lineNo = index + 1;
    if (BLOCK_START.test(line) && current.length > 0) {
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
  return spans;
}
