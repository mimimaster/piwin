import { describe, expect, it } from 'vitest';
import type { CodeSearchAnswerFile } from './answer-parse.js';
import {
  CODE_SEARCH_NO_RANGES,
  CODE_SEARCH_NO_RESULTS,
  DEFAULT_CODE_SEARCH_SNIPPET_LINE_BUDGET,
  formatCodeSearchNoRanges,
  formatCodeSearchNoResults,
  formatCodeSearchResult,
  type CodeSearchLineReader,
} from './result-format.js';

function fileFixture(path: string, ranges: Array<[number, number]>): CodeSearchAnswerFile {
  return {
    path,
    absolutePath: `/root/${path}`,
    ranges: ranges.map(([start, end]) => ({ start, end })),
  };
}

function reader(files: Record<string, string>): CodeSearchLineReader {
  return async (absolutePath: string) => {
    const content = files[absolutePath];
    return content === undefined ? undefined : content.split('\n');
  };
}

const READER = reader({
  '/root/styles/app.css': [
    '.mcp-toggle {',
    '  position: relative;',
    '  display: inline-block;',
    '}',
  ].join('\n'),
  '/root/src/short.ts': 'export const a = 1;',
});

describe('formatCodeSearchResult', () => {
  it('renders the verified Devin framing verbatim', async () => {
    const output = await formatCodeSearchResult({
      commandSummaries: ['Grepped mcp-toggle in .', 'Read styles/app.css'],
      files: [fileFixture('styles/app.css', [[1, 3]])],
      includeSnippets: true,
      lineMaxChars: 250,
      readLines: READER,
    });

    expect(output).toBe(
      [
        'A search subagent explored the codebase, running these commands:',
        '- Grepped mcp-toggle in .',
        '- Read styles/app.css',
        '',
        'It believes the snippets below are relevant to your search. Be careful evaluating their relevance — the subagent can make mistakes — and follow up with your normal grep/glob/read tools to fill in anything it missed:',
        '',
        '<file path="styles/app.css" total_lines=4>',
        '1|.mcp-toggle {',
        '2|  position: relative;',
        '3|  display: inline-block;',
        '</file>',
      ].join('\n'),
    );
  });

  it('right-aligns line numbers to the width of total_lines', async () => {
    const longFile = Array.from({ length: 455 }, (_, index) => `line ${index + 1}`);
    const output = await formatCodeSearchResult({
      commandSummaries: ['Read big.ts'],
      files: [fileFixture('big.ts', [[95, 97]])],
      includeSnippets: true,
      lineMaxChars: 250,
      readLines: reader({ '/root/big.ts': longFile.join('\n') }),
    });
    expect(output).toContain('<file path="big.ts" total_lines=455>');
    expect(output).toContain(' 95|line 95');
    expect(output).toContain(' 97|line 97');
  });

  it('renders multiple ranges of one file inside a single file element', async () => {
    const output = await formatCodeSearchResult({
      commandSummaries: ['Read multi.ts'],
      files: [fileFixture('multi.ts', [[1, 2], [4, 4]])],
      includeSnippets: true,
      lineMaxChars: 250,
      readLines: reader({ '/root/multi.ts': ['a', 'b', 'c', 'd'].join('\n') }),
    });
    const blocks = output.match(/<file /g) ?? [];
    expect(blocks).toHaveLength(1);
    expect(output).toContain('1|a\n2|b\n4|d');
    expect(output).not.toContain('3|c');
  });

  it('clamps a range that runs past the end of the file', async () => {
    const output = await formatCodeSearchResult({
      commandSummaries: ['Read short.ts'],
      files: [fileFixture('src/short.ts', [[1, 99]])],
      includeSnippets: true,
      lineMaxChars: 250,
      readLines: READER,
    });
    expect(output).toContain('1|export const a = 1;');
    expect(output).not.toContain('2|');
  });

  it('reports an unreadable file instead of failing the whole result', async () => {
    const output = await formatCodeSearchResult({
      commandSummaries: ['Read gone.ts'],
      files: [fileFixture('gone.ts', [[1, 5]])],
      includeSnippets: true,
      lineMaxChars: 250,
      readLines: reader({}),
    });
    expect(output).toContain('<file path="gone.ts" total_lines=0>');
    expect(output).toContain('(unreadable)');
  });

  it('truncates over-long snippet lines with the observed marker', async () => {
    const output = await formatCodeSearchResult({
      commandSummaries: ['Read wide.ts'],
      files: [fileFixture('wide.ts', [[1, 1]])],
      includeSnippets: true,
      lineMaxChars: 10,
      readLines: reader({ '/root/wide.ts': 'x'.repeat(30) }),
    });
    expect(output).toContain(`1|${'x'.repeat(10)}… (20 chars truncated)`);
  });

  it('honors the snippet line budget and reports the shortfall', async () => {
    const lines = Array.from({ length: 40 }, (_, index) => `line ${index + 1}`);
    const output = await formatCodeSearchResult({
      commandSummaries: ['Read many.ts'],
      files: [fileFixture('many.ts', [[1, 40]])],
      includeSnippets: true,
      lineMaxChars: 250,
      snippetLineBudget: 10,
      readLines: reader({ '/root/many.ts': lines.join('\n') }),
    });
    // Line numbers are right-aligned to total_lines=40, so allow leading spaces.
    const body = output.split('\n').filter((line) => /^\s*\d+\|/.test(line));
    expect(body).toHaveLength(10);
    expect(output).toContain('… (30 lines truncated)');
  });

  it('exposes piwin\'s default snippet budget', () => {
    expect(DEFAULT_CODE_SEARCH_SNIPPET_LINE_BUDGET).toBe(500);
  });

  it('falls back to a path and range list when snippets are disabled', async () => {
    const output = await formatCodeSearchResult({
      commandSummaries: ['Grepped app in src'],
      files: [fileFixture('src/a.ts', [[1, 5], [9, 12]]), fileFixture('src/b.ts', [[2, 2]])],
      includeSnippets: false,
      lineMaxChars: 250,
      readLines: READER,
    });
    expect(output).toBe(
      [
        'A search subagent explored the codebase, running these commands:',
        '- Grepped app in src',
        '',
        'It believes the snippets below are relevant to your search. Be careful evaluating their relevance — the subagent can make mistakes — and follow up with your normal grep/glob/read tools to fill in anything it missed:',
        '',
        '  src/a.ts (L1-5, L9-12)',
        '  src/b.ts (L2-2)',
      ].join('\n'),
    );
  });
});

describe('formatCodeSearchNoResults', () => {
  it('uses the verbatim no-results sentence', () => {
    expect(formatCodeSearchNoResults()).toBe(CODE_SEARCH_NO_RESULTS);
    expect(formatCodeSearchNoResults()).toBe(
      'Fast-context search did not find relevant code. Verify with your normal grep/glob/read tools.',
    );
  });

  it('surfaces refused paths when the subagent drifted out of the root', () => {
    const output = formatCodeSearchNoResults(['/etc/hosts', '../../secrets.ts']);
    expect(output).toContain(CODE_SEARCH_NO_RESULTS);
    expect(output).toContain('Refused paths outside the search root: /etc/hosts, ../../secrets.ts');
  });
});

describe('formatCodeSearchNoRanges', () => {
  it('includes a bounded raw response', () => {
    expect(formatCodeSearchNoRanges('no idea')).toBe(`${CODE_SEARCH_NO_RANGES}\nno idea`);
  });

  it('truncates a long raw response to a bounded preview', () => {
    const output = formatCodeSearchNoRanges('x'.repeat(600));
    // Exactly the first 500 characters, then the truncation marker.
    expect(output).toBe(`${CODE_SEARCH_NO_RANGES}\n${'x'.repeat(500)}… (truncated)`);
  });

  it('omits the response when blank', () => {
    expect(formatCodeSearchNoRanges('   ')).toBe(CODE_SEARCH_NO_RANGES);
  });
});
