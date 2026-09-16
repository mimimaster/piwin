import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { ExtensionCompatibility } from '@piwin/contracts';

const PI_ON_EVENT = /\bpi\.on\(\s*['"]([A-Za-z_][\w-]*)['"]/g;

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
  /\bsetWidget\b/,
  /\bsetHeader\b/,
  /\bsetFooter\b/,
  /\bsetStatus\b/,
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

export function classifyExtensionSource(source: string): ExtensionCompatibility {
  if (TERMINAL_REQUIRED_PATTERNS.some((pattern) => pattern.test(source))) {
    return { tier: 'incompatible', incompatibilityReason: 'requires-terminal-tty' };
  }
  const hasTui = TUI_PATTERNS.some((pattern) => pattern.test(source));
  const hasAgent = AGENT_PATTERNS.some((pattern) => pattern.test(source));
  if (hasTui && hasAgent) {
    return { tier: 'degraded' };
  }
  if (hasTui) {
    return { tier: 'incompatible' };
  }
  return { tier: 'compatible' };
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
