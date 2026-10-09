import { style } from './tui-style.js';

type LanguageSyntax = {
  keywords: ReadonlySet<string>;
  /** Line comment openers; `#` and `//` cover nearly everything shown in chat. */
  lineComment?: '#' | '//' | '--';
  blockComment: boolean;
  /** Python-style `"""` and `'''` strings that span lines. */
  tripleQuotes: boolean;
};

const words = (list: string): ReadonlySet<string> => new Set(list.split(/\s+/).filter(Boolean));

const C_FAMILY_KEYWORDS = words(
  'if else for while do switch case break continue return function const let var class new this super import export from default async await try catch finally throw typeof instanceof in of void null undefined true false interface type enum extends implements public private protected static readonly abstract namespace as yield delete',
);

const SYNTAX: Record<string, LanguageSyntax> = {
  python: {
    keywords: words(
      'def class return if elif else for while in not and or is import from as with try except finally raise pass break continue lambda yield async await global nonlocal None True False del assert',
    ),
    lineComment: '#',
    blockComment: false,
    tripleQuotes: true,
  },
  javascript: { keywords: C_FAMILY_KEYWORDS, lineComment: '//', blockComment: true, tripleQuotes: false },
  rust: {
    keywords: words(
      'fn let mut const static struct enum impl trait pub use mod crate self Self super match if else for while loop in return break continue as ref move where type unsafe async await dyn true false',
    ),
    lineComment: '//',
    blockComment: true,
    tripleQuotes: false,
  },
  go: {
    keywords: words(
      'func var const type struct interface package import return if else for range switch case default break continue go defer chan map select fallthrough goto nil true false',
    ),
    lineComment: '//',
    blockComment: true,
    tripleQuotes: false,
  },
  shell: {
    keywords: words('if then else elif fi for while do done case esac function in return export local echo cd set unset'),
    lineComment: '#',
    blockComment: false,
    tripleQuotes: false,
  },
  json: { keywords: words('true false null'), blockComment: false, tripleQuotes: false },
  sql: {
    keywords: words(
      'select from where insert into values update set delete create table alter drop join left right inner outer on group by order having limit as and or not null primary key distinct union',
    ),
    lineComment: '--',
    blockComment: true,
    tripleQuotes: false,
  },
  yaml: { keywords: words('true false null'), lineComment: '#', blockComment: false, tripleQuotes: false },
};

const ALIASES: Record<string, string> = {
  py: 'python',
  python3: 'python',
  js: 'javascript',
  jsx: 'javascript',
  ts: 'javascript',
  tsx: 'javascript',
  typescript: 'javascript',
  mjs: 'javascript',
  java: 'javascript',
  c: 'javascript',
  cpp: 'javascript',
  'c++': 'javascript',
  cs: 'javascript',
  csharp: 'javascript',
  kotlin: 'javascript',
  swift: 'javascript',
  rs: 'rust',
  golang: 'go',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  shell: 'shell',
  yml: 'yaml',
  toml: 'yaml',
  jsonc: 'json',
};

/**
 * Colors the parts of code a reader scans for: comments, strings, numbers and
 * keywords. It is a lexer, not a parser: wrong on exotic syntax, never wrong
 * about where a line ends. Unknown languages come back uncolored.
 */
export function highlightCode(code: string, lang?: string): string[] {
  const key = lang?.trim().toLowerCase();
  const syntax = key === undefined ? undefined : SYNTAX[ALIASES[key] ?? key];
  if (syntax === undefined) return code.split('\n');
  return paintLines(code, syntax);
}

type Paint = (text: string) => string;

function paintLines(code: string, syntax: LanguageSyntax): string[] {
  const lines: string[] = [''];
  const emit = (text: string, paint?: Paint): void => {
    // A token can span lines (block comment, triple quotes); each line is painted on its own.
    text.split('\n').forEach((part, index) => {
      if (index > 0) lines.push('');
      if (part.length === 0) return;
      lines[lines.length - 1] += paint === undefined ? part : paint(part);
    });
  };
  const lexer = buildLexer(syntax);
  let position = 0;
  for (const match of code.matchAll(lexer)) {
    const index = match.index ?? 0;
    if (index > position) emit(code.slice(position, index));
    const groups = match.groups ?? {};
    const text = match[0];
    if (groups.comment !== undefined) emit(text, style.gray);
    else if (groups.string !== undefined) emit(text, style.green);
    else if (groups.number !== undefined) emit(text, style.yellow);
    else if (groups.word !== undefined && syntax.keywords.has(text)) emit(text, style.magenta);
    else emit(text);
    position = index + text.length;
  }
  if (position < code.length) emit(code.slice(position));
  return lines;
}

function buildLexer(syntax: LanguageSyntax): RegExp {
  const comment = [
    syntax.lineComment === undefined ? undefined : `${escapeRegExp(syntax.lineComment)}[^\\n]*`,
    syntax.blockComment ? '\\/\\*[\\s\\S]*?(?:\\*\\/|$)' : undefined,
  ].filter((part): part is string => part !== undefined);
  const string = [
    syntax.tripleQuotes ? `"""[\\s\\S]*?(?:"""|$)|'''[\\s\\S]*?(?:'''|$)` : undefined,
    `"(?:\\\\.|[^"\\\\\\n])*"?`,
    `'(?:\\\\.|[^'\\\\\\n])*'?`,
    '`(?:\\\\.|[^`\\\\])*`?',
  ].filter((part): part is string => part !== undefined);
  const parts = [
    ...(comment.length === 0 ? [] : [`(?<comment>${comment.join('|')})`]),
    `(?<string>${string.join('|')})`,
    '(?<number>\\b\\d[\\d_]*(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b|\\b0x[0-9a-fA-F]+\\b)',
    '(?<word>[A-Za-z_][A-Za-z0-9_]*)',
  ];
  return new RegExp(parts.join('|'), 'g');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
