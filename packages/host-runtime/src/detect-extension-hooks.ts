import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const PI_ON_EVENT = /\bpi\.on\(\s*['"]([A-Za-z_][\w-]*)['"]/g;

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

export async function readExtensionHookEvents(
  entryPath: string,
): Promise<readonly string[] | undefined> {
  const files = await resolveExtensionSourceFiles(entryPath);
  for (const file of files) {
    try {
      const events = detectExtensionHookEvents(await readFile(file, 'utf8'));
      if (events.length > 0) {
        return events;
      }
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
