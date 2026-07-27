import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { McpMetadataDocument } from '@piwin/contracts';

export function getMcpMetadataPath(piwinRoot: string): string {
  return join(piwinRoot, 'mcp-metadata.json');
}

export function createEmptyMcpMetadataDocument(): McpMetadataDocument {
  return { version: 1, servers: {} };
}

export async function loadMcpMetadataDocument(
  piwinRoot: string,
): Promise<McpMetadataDocument> {
  const filePath = getMcpMetadataPath(piwinRoot);
  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return createEmptyMcpMetadataDocument();
    }
    const record = parsed as Record<string, unknown>;
    if (record.version !== 1 || !record.servers || typeof record.servers !== 'object') {
      return createEmptyMcpMetadataDocument();
    }
    return {
      version: 1,
      servers: record.servers as McpMetadataDocument['servers'],
    };
  } catch (error) {
    if (isNotFound(error)) {
      return createEmptyMcpMetadataDocument();
    }
    throw error;
  }
}

/** Atomic write: temp file then rename. */
export async function saveMcpMetadataDocument(
  piwinRoot: string,
  document: McpMetadataDocument,
): Promise<void> {
  const filePath = getMcpMetadataPath(piwinRoot);
  await mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, filePath);
}

function isNotFound(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === 'ENOENT',
  );
}
