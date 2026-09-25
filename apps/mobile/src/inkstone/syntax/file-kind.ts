/**
 * How the phone previews a Host file, decided from its path alone. Language
 * ids are Shiki grammar ids; anything unknown previews as plain text rather
 * than being guessed into another grammar.
 */
export type FilePreviewKind =
  | { kind: 'code'; language: string }
  | { kind: 'markdown' }
  | { kind: 'image'; mimeType: string }
  | { kind: 'text' };

export const EXTENSION_LANGUAGES: Record<string, string> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  json: 'json',
  jsonc: 'jsonc',
  json5: 'json5',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  htm: 'html',
  vue: 'vue',
  svelte: 'svelte',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  swift: 'swift',
  m: 'objective-c',
  mm: 'objective-cpp',
  c: 'c',
  h: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  lua: 'lua',
  dart: 'dart',
  scala: 'scala',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  fish: 'fish',
  ps1: 'powershell',
  sql: 'sql',
  graphql: 'graphql',
  gql: 'graphql',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  ini: 'ini',
  xml: 'xml',
  plist: 'xml',
  svg: 'xml',
  proto: 'proto',
  diff: 'diff',
  patch: 'diff',
  dockerfile: 'dockerfile',
  tf: 'hcl',
  hcl: 'hcl',
  nix: 'nix',
  zig: 'zig',
  ex: 'elixir',
  exs: 'elixir',
  erl: 'erlang',
  hs: 'haskell',
  ml: 'ocaml',
  r: 'r',
  jl: 'julia',
  vim: 'viml',
  makefile: 'make',
  mk: 'make',
  cmake: 'cmake',
  gradle: 'groovy',
  groovy: 'groovy',
  tex: 'latex',
};

export const FILENAME_LANGUAGES: Record<string, string> = {
  dockerfile: 'dockerfile',
  makefile: 'make',
  gnumakefile: 'make',
  'cmakelists.txt': 'cmake',
  '.gitignore': 'ini',
  '.editorconfig': 'ini',
  '.npmrc': 'ini',
  '.zshrc': 'bash',
  '.bashrc': 'bash',
};

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

export function filePreviewKind(path: string): FilePreviewKind {
  const name = (path.split('/').pop() ?? path).toLowerCase();
  const byName = FILENAME_LANGUAGES[name];
  if (byName !== undefined) return { kind: 'code', language: byName };
  const dot = name.lastIndexOf('.');
  const extension = dot > 0 ? name.slice(dot + 1) : '';
  if (extension === 'md' || extension === 'markdown' || extension === 'mdx') return { kind: 'markdown' };
  const mime = IMAGE_MIME[extension];
  if (mime !== undefined) return { kind: 'image', mimeType: mime };
  const language = EXTENSION_LANGUAGES[extension];
  return language !== undefined ? { kind: 'code', language } : { kind: 'text' };
}

/**
 * Grammar for a Markdown fence label (`ts`, `python`, `sh`…). Unknown labels
 * are passed through so Shiki can try them; an empty label stays plain.
 */
export function fenceLanguage(label: string | undefined): string | undefined {
  const value = label?.trim().toLowerCase() ?? '';
  if (value.length === 0 || value === 'text' || value === 'plaintext' || value === 'txt') return undefined;
  return EXTENSION_LANGUAGES[value] ?? (value === 'shell' || value === 'console' ? 'bash' : value);
}
