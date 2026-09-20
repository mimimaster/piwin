/**
 * Lexical "does this bash command write outside the project root?" check.
 *
 * Not a shell parser and not an OS sandbox. `cd` / `ls` / `cat` / `echo` never
 * trip this check. Other stages that reference a path outside `projectRoot`
 * (`tee /tmp/x`, `rm -rf /tmp/foo`) stay `ask`. Quoted operators stay intact;
 * `$(…)` is not expanded.
 */
import { homedir } from 'node:os';
import path from 'node:path';
import { escapesRoot } from '@piwin/project';
import { splitBashCommandChain } from './bash-command-chain.js';

const BENIGN_DEVICE_PATHS = new Set([
  '/dev/null',
  '/dev/stdin',
  '/dev/stdout',
  '/dev/stderr',
  '/dev/tty',
]);

/** Read / navigate / echo: never trip leave-workspace, even with absolute operands. */
const NEVER_ASK_PROGRAMS = new Set(['cd', 'ls', 'cat', 'echo']);

export function bashCommandEscapesProjectRoot(command: string, projectRoot: string): boolean {
  const root = projectRoot.trim();
  if (root.length === 0) {
    return false;
  }
  for (const piece of splitBashCommandChain(command)) {
    for (const stage of splitPipelineStages(piece)) {
      if (stageEscapesProjectRoot(stage, root)) {
        return true;
      }
    }
  }
  return false;
}

export function extractPathLikeTokens(command: string): string[] {
  const tokens: string[] = [];
  for (const raw of splitUnquotedWords(command)) {
    const unquoted = stripWrappingQuotes(raw);
    if (unquoted.length === 0) {
      continue;
    }
    const equals = unquoted.indexOf('=');
    if (equals > 0) {
      const value = unquoted.slice(equals + 1);
      if (isPathLike(value)) {
        tokens.push(value);
      }
    }
    if (isPathLike(unquoted)) {
      tokens.push(unquoted);
    }
  }
  return tokens;
}

function stageEscapesProjectRoot(stage: string, projectRoot: string): boolean {
  const program = stageProgram(stage);
  if (NEVER_ASK_PROGRAMS.has(program)) {
    return false;
  }
  const tokens = extractPathLikeTokens(stage);
  for (const token of tokens) {
    const resolved = resolveCommandPathToken(token, projectRoot);
    if (resolved === undefined) {
      continue;
    }
    if (BENIGN_DEVICE_PATHS.has(path.resolve(resolved))) {
      continue;
    }
    if (escapesRoot(projectRoot, resolved)) {
      return true;
    }
  }
  return false;
}

function stageProgram(stage: string): string {
  const first = splitUnquotedWords(stage)[0];
  if (first === undefined) {
    return '';
  }
  return path.basename(stripWrappingQuotes(first)).toLowerCase();
}

function splitPipelineStages(command: string): string[] {
  const stages: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaped = false;
  let previous = '';

  const flush = (): void => {
    const trimmed = current.trim();
    if (trimmed.length > 0) {
      stages.push(trimmed);
    }
    current = '';
  };

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index]!;
    if (escaped) {
      current += character;
      escaped = false;
      previous = character;
      continue;
    }
    if (character === '\\' && quote !== "'") {
      current += character;
      escaped = true;
      previous = character;
      continue;
    }
    if (quote !== null) {
      current += character;
      if (character === quote) {
        quote = null;
      }
      previous = character;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      current += character;
      previous = character;
      continue;
    }
    if (character === '|' && command[index + 1] !== '|' && previous !== '>') {
      flush();
      previous = character;
      continue;
    }
    current += character;
    previous = character;
  }
  flush();
  return stages.length > 0 ? stages : [command.trim()].filter((item) => item.length > 0);
}

function isPathLike(token: string): boolean {
  if (token.length === 0 || token === '-' || token === '--') {
    return false;
  }
  if (token.startsWith('http://') || token.startsWith('https://')) {
    return false;
  }
  if (token === '~' || token.startsWith('~/')) {
    return true;
  }
  if (token === '$HOME' || token === '${HOME}') {
    return true;
  }
  if (token.startsWith('$HOME/') || token.startsWith('${HOME}')) {
    return true;
  }
  if (token.startsWith('file://')) {
    return true;
  }
  if (token.startsWith('/')) {
    return true;
  }
  if (/^[A-Za-z]:[\\/]/.test(token)) {
    return true;
  }
  return token.split(/[\\/]/).includes('..');
}

function resolveCommandPathToken(token: string, projectRoot: string): string | undefined {
  let candidate = expandHomePrefix(token) ?? token;
  if (candidate.startsWith('file://')) {
    try {
      candidate = new URL(candidate).pathname;
    } catch {
      return undefined;
    }
  }
  return path.resolve(projectRoot, candidate);
}

function expandHomePrefix(token: string): string | undefined {
  const home = homedir();
  if (token === '~') {
    return home;
  }
  if (token.startsWith('~/')) {
    return `${home}${token.slice(1)}`;
  }
  if (token === '$HOME' || token === '${HOME}') {
    return home;
  }
  if (token.startsWith('$HOME/')) {
    return `${home}${token.slice('$HOME'.length)}`;
  }
  if (token.startsWith('${HOME}')) {
    return `${home}${token.slice('${HOME}'.length)}`;
  }
  return undefined;
}

function stripWrappingQuotes(token: string): string {
  if (token.length < 2) {
    return token;
  }
  const start = token[0];
  const end = token[token.length - 1];
  if ((start === '"' || start === "'") && start === end) {
    return token.slice(1, -1);
  }
  return token;
}

/**
 * Split on unquoted whitespace and redirect operators. `2>/tmp/err` becomes
 * `2` + `/tmp/err` so the path token is visible.
 */
function splitUnquotedWords(command: string): string[] {
  const words: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaped = false;

  const flush = (): void => {
    if (current.length > 0) {
      words.push(current);
      current = '';
    }
  };

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index]!;
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === '\\' && quote !== "'") {
      current += character;
      escaped = true;
      continue;
    }
    if (quote !== null) {
      current += character;
      if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      current += character;
      continue;
    }
    if (character === '>' || character === '<') {
      flush();
      if (character === '>' && command[index + 1] === '>') {
        index += 1;
      }
      continue;
    }
    if (/\s/.test(character)) {
      flush();
      continue;
    }
    current += character;
  }
  flush();
  return words;
}
