import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { ExtensionCapabilities, ExtensionCompatibility } from '@piwin/contracts';

const PI_ON_EVENT = /\bpi\.on\(\s*['"]([A-Za-z_][\w-]*)['"]/g;
/** `pi.registerCommand("name", …)` — Pi's current signature. */
const REGISTER_COMMAND_BY_NAME = /\bregisterCommand\s*\(\s*['"]([A-Za-z0-9][\w:.-]*)['"]/g;
/** `pi.registerCommand({ name: "name", … })` — the object form some extensions use. */
const REGISTER_COMMAND_BY_OBJECT =
  /\bregisterCommand\s*\(\s*\{[^}]{0,200}?\bname\s*:\s*['"]([A-Za-z0-9][\w:.-]*)['"]/g;
const REGISTER_TOOL_BY_OBJECT =
  /\bregisterTool\s*\(\s*\{[^}]{0,200}?\bname\s*:\s*['"]([A-Za-z0-9][\w:.-]*)['"]/g;

const TUI_PATTERNS: readonly RegExp[] = [
  /\b(?:ctx\.)?ui\.custom\s*\(/,
  /\brenderCall\b/,
  /\brenderResult\b/,
  /\bregisterMessageRenderer\b/,
  /\bregisterEntryRenderer\b/,
  /\bregisterMarkdownTransformer\b/,
  /\bregisterTheme\b/,
  /\bsetTheme\b/,
  /\bregisterShortcut\b/,
  /\bregisterKeybinding\b/,
  /\bkeybinding\b/,
  /\bsetEditorComponent\b/,
  /\baddAutocompleteProvider\b/,
  /\bonTerminalInput\b/,
  /\b(?:ctx\.)?reload\s*\(/,
  // Only component-factory widgets are TUI: `setWidget(key, (tui, theme) => …)`,
  // `function`, or `new Component(…)`. Text lines (`string[]`) are bridged
  // (ADR 0080), and so is `setStatus`.
  /\bsetWidget\s*\(\s*[^,()]+,\s*(?:\([^()]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>|async\b|function\b|new\s)/,
  /\bsetHeader\b/,
  /\bsetFooter\b/,
];

const TERMINAL_REQUIRED_PATTERNS: readonly RegExp[] = [
  /\bprocess\.stdin\.setRawMode\s*\(/,
  /\b(?:from|require\s*\()\s*['"](?:blessed|neo-blessed)['"]/,
];

const AGENT_PATTERNS: readonly RegExp[] = [
  /\b(?:pi\.)?registerTool\b/,
  /\b(?:pi\.)?registerProvider\b/,
  /\b(?:pi\.)?registerCommand\b/,
  /\bpi\.on\s*\(/,
  /\b(?:ctx\.)?ui\.(?:confirm|select|input|notify)\s*\(/,
];

/**
 * Static scan of Pi `pi.on('event')` registrations.
 * Listing must never execute extension modules.
 */
export function detectExtensionHookEvents(source: string): string[] {
  const events = new Set<string>();
  for (const match of source.matchAll(PI_ON_EVENT)) {
    const event = match[1];
    if (event) {
      events.add(event);
    }
  }
  return [...events];
}

/** Slash command names an extension registers, for the composer `/` menu (ADR 0080). */
export function detectExtensionCommands(source: string): string[] {
  return collectMatches(source, [REGISTER_COMMAND_BY_NAME, REGISTER_COMMAND_BY_OBJECT]);
}

export function classifyExtensionSource(source: string): ExtensionCompatibility {
  if (TERMINAL_REQUIRED_PATTERNS.some((pattern) => pattern.test(source))) {
    return { tier: 'incompatible', incompatibilityReason: 'requires-terminal-tty' };
  }
  const hasTui = TUI_PATTERNS.some((pattern) => pattern.test(source));
  const hasAgent = AGENT_PATTERNS.some((pattern) => pattern.test(source));
  const tier = hasTui ? (hasAgent ? 'degraded' : 'incompatible') : 'compatible';
  const capabilities = detectCapabilities(source);
  return capabilities ? { tier, capabilities } : { tier };
}

function detectCapabilities(source: string): ExtensionCapabilities | undefined {
  const tools = collectMatches(source, [REGISTER_TOOL_BY_OBJECT]);
  const hooks = detectExtensionHookEvents(source);
  const commands = detectExtensionCommands(source);
  if (tools.length === 0 && hooks.length === 0 && commands.length === 0) return undefined;
  return { tools, hooks, ...(commands.length > 0 ? { commands } : {}) };
}

function collectMatches(source: string, patterns: readonly RegExp[]): string[] {
  const names = new Set<string>();
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match[1]) names.add(match[1]);
    }
  }
  return [...names];
}

export async function readExtensionHookEvents(
  entryPath: string,
): Promise<readonly string[] | undefined> {
  const source = await readExtensionEntrySource(entryPath);
  if (source === undefined) {
    return undefined;
  }
  const events = detectExtensionHookEvents(source);
  return events.length > 0 ? events : undefined;
}

export async function readExtensionCompatibility(entryPath: string): Promise<ExtensionCompatibility> {
  const source = await readExtensionEntrySource(entryPath);
  if (source === undefined) {
    return { tier: 'unverified' };
  }
  return classifyExtensionSource(source);
}

async function readExtensionEntrySource(entryPath: string): Promise<string | undefined> {
  const files = await resolveExtensionSourceFiles(entryPath);
  for (const file of files) {
    try {
      return await readFile(file, 'utf8');
    } catch {
      continue;
    }
  }
  return undefined;
}

async function resolveExtensionSourceFiles(entryPath: string): Promise<string[]> {
  try {
    const entryStat = await stat(entryPath);
    if (entryStat.isDirectory()) {
      return [join(entryPath, 'index.ts'), join(entryPath, 'index.js')];
    }
    if (entryStat.isFile()) {
      return [entryPath];
    }
  } catch {
    return [];
  }
  return [];
}
