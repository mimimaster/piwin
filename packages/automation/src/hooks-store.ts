import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { HookDefinition, HooksDocument } from '@piwin/contracts';

function emptyDoc(): HooksDocument {
  return { version: 1, hooks: [] };
}

export function getHooksStorePath(piwinRoot: string): string {
  return join(piwinRoot, 'automation', 'hooks.json');
}

export async function loadHooks(filePath: string): Promise<HooksDocument> {
  try {
    const raw = await readFile(filePath, 'utf8');
    if (!raw.trim()) return emptyDoc();
    const parsed = JSON.parse(raw) as HooksDocument;
    if (!parsed || !Array.isArray(parsed.hooks)) return emptyDoc();
    return { version: 1, hooks: parsed.hooks };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyDoc();
    throw error;
  }
}

export async function saveHooks(filePath: string, document: HooksDocument): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
}

export async function setHooks(filePath: string, hooks: HookDefinition[]): Promise<HooksDocument> {
  const document: HooksDocument = { version: 1, hooks };
  await saveHooks(filePath, document);
  return document;
}
