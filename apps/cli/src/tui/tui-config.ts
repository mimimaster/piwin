import { readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveKeybindings, type Keybindings } from './keybindings.js';
import { DEFAULT_STATUS_TEMPLATE, unknownStatusFields } from './status-template.js';

export type TuiConfig = {
  keybindings: Keybindings;
  statusTemplate: string;
  /** What was wrong in the files, in words a person can act on. Empty when all is well. */
  problems: string[];
};

/**
 * Client-side TUI settings, read once at start: `keybindings.json`
 * (`{"sessions": "alt+s"}`) and `tui.json` (`{"statusLine": "{model} · {context}"}`)
 * under the product root. Missing files mean defaults; unreadable or wrong
 * entries are reported and defaulted, never fatal.
 */
export function loadTuiConfig(piwinRoot: string): TuiConfig {
  const problems: string[] = [];
  const keys = readJson(path.join(piwinRoot, 'keybindings.json'), problems);
  const settings = readJson(path.join(piwinRoot, 'tui.json'), problems);
  const resolved = resolveKeybindings(keys);
  problems.push(...resolved.problems);
  return { keybindings: resolved.bindings, statusTemplate: pickStatusTemplate(settings, problems), problems };
}

function pickStatusTemplate(settings: unknown, problems: string[]): string {
  if (typeof settings !== 'object' || settings === null) return DEFAULT_STATUS_TEMPLATE;
  const template = (settings as { statusLine?: unknown }).statusLine;
  if (template === undefined) return DEFAULT_STATUS_TEMPLATE;
  if (typeof template !== 'string' || template.trim().length === 0) {
    problems.push('tui.json 的 statusLine 要写成模板字符串，已使用默认状态栏');
    return DEFAULT_STATUS_TEMPLATE;
  }
  const unknown = unknownStatusFields(template);
  if (unknown.length > 0) {
    problems.push(`tui.json 的 statusLine 里没有 ${unknown.map((name) => `{${name}}`).join('、')}，已使用默认状态栏`);
    return DEFAULT_STATUS_TEMPLATE;
  }
  return template;
}

function readJson(file: string, problems: string[]): unknown {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    problems.push(`${path.basename(file)} 读不了：${(error as Error).message}`);
    return undefined;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    problems.push(`${path.basename(file)} 不是合法的 JSON，已使用默认设置`);
    return undefined;
  }
}
