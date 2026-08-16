/** Extension sets owned by the parser layer (scan capability). */

export const MARKDOWN_EXTENSIONS = ['.md', '.markdown', '.mdx'] as const;
export const TEXT_EXTENSIONS = ['.txt'] as const;
export const CODE_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.rs',
  '.go',
  '.java',
  '.kt',
  '.swift',
  '.c',
  '.h',
  '.cpp',
  '.hpp',
  '.cc',
  '.cs',
  '.rb',
  '.php',
  '.sh',
  '.bash',
  '.zsh',
  '.fish',
  '.ps1',
  '.lua',
  '.r',
  '.scala',
  '.clj',
  '.ex',
  '.exs',
  '.erl',
  '.hs',
  '.ml',
  '.vim',
  '.sql',
  '.graphql',
  '.gql',
  '.proto',
  '.thrift',
] as const;
export const CONFIG_EXTENSIONS = [
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
  '.dockerfile',
  '.makefile',
  '.cmake',
] as const;
export const UNSTRUCTURED_EXTENSIONS = ['.html', '.htm', '.doc', '.docx'] as const;
export const MINERU_EXTENSIONS = ['.pdf'] as const;

export function fileExtension(relativePath: string): string {
  const base = relativePath.split(/[\\/]/).pop() ?? relativePath;
  const lower = base.toLowerCase();
  if (lower === 'dockerfile') return '.dockerfile';
  if (lower === 'makefile') return '.makefile';
  const dot = lower.lastIndexOf('.');
  return dot < 0 ? '' : lower.slice(dot);
}
