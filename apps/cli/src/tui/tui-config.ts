import { readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveKeybindings, type Keybindings } from './keybindings.js';
import { DEFAULT_STATUS_TEMPLATES, unknownStatusFields, type StatusTemplates } from './status-template.js';

export type TuiConfig = {
  keybindings: Keybindings;
  /** Status line template per width tier (wide ≥120, medium ≥80, narrow). */
  statusTemplates: StatusTemplates;
  /** Show the estimated session cost (`"showCost": true`); hidden by default. */
  showCost: boolean;
  /** What was wrong in the files, in words a person can act on. Empty when all is well. */
  problems: string[];
};

/**
 * Client-side TUI settings, read once at start: `keybindings.json`
 * (`{"sessions": "alt+s"}`) and `tui.json` (`{"statusLine": "{model} · {context}"}`, or
 * `{"statusLine": {"wide": …, "medium": …, "narrow": …}, "showCost": true}`)
 * under the product root. Missing files mean defaults; unreadable or wrong
 * entries are reported and defaulted, never fatal.
 */
export function loadTuiConfig(piwinRoot: string): TuiConfig {
  const problems: string[] = [];
  const keys = readJson(path.join(piwinRoot, 'keybindings.json'), problems);
  const settings = readJson(path.join(piwinRoot, 'tui.json'), problems);
  const resolved = resolveKeybindings(keys);
  problems.push(...resolved.problems);
  return {
    keybindings: resolved.bindings,
    statusTemplates: pickStatusTemplates(settings, problems),
    showCost: pickShowCost(settings, problems),
    problems,
  };
}

function pickShowCost(settings: unknown, problems: string[]): boolean {
  if (typeof settings !== 'object' || settings === null) return false;
  const value = (settings as { showCost?: unknown }).showCost;
  if (value === undefined) return false;
  if (typeof value !== 'boolean') {
    problems.push('tui.json 的 showCost 要写成 true 或 false，已隐藏费用');
    return false;
  }
  return value;
}

function pickStatusTemplates(settings: unknown, problems: string[]): StatusTemplates {
  if (typeof settings !== 'object' || settings === null) return DEFAULT_STATUS_TEMPLATES;
  const template = (settings as { statusLine?: unknown }).statusLine;
  if (template === undefined) return DEFAULT_STATUS_TEMPLATES;
  // One string is the line at every width; an object can set each tier.
  const tiers: Partial<Record<keyof StatusTemplates, unknown>> =
    typeof template === 'string'
      ? { wide: template, medium: template, narrow: template }
      : typeof template === 'object' && template !== null && !Array.isArray(template)
        ? (template as Partial<Record<keyof StatusTemplates, unknown>>)
        : { wide: 0 };
  const picked: StatusTemplates = { ...DEFAULT_STATUS_TEMPLATES };
  for (const tier of ['wide', 'medium', 'narrow'] as const) {
    const value = tiers[tier];
    if (value === undefined) continue;
    if (typeof value !== 'string' || value.trim().length === 0) {
      problems.push('tui.json 的 statusLine 要写成模板字符串，已使用默认状态栏');
      return DEFAULT_STATUS_TEMPLATES;
    }
    const unknown = unknownStatusFields(value);
    if (unknown.length > 0) {
      problems.push(`tui.json 的 statusLine 里没有 ${unknown.map((name) => `{${name}}`).join('、')}，已使用默认状态栏`);
      return DEFAULT_STATUS_TEMPLATES;
    }
    picked[tier] = value;
  }
  return picked;
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
