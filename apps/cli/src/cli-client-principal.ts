import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

type PrincipalStore = {
  principals: Record<string, string>;
};

export async function readCliClientPrincipalId(
  piwinRoot: string,
  hostTarget: string,
): Promise<string> {
  const path = join(piwinRoot, 'clients', 'cli-principal.json');
  const store = await readStore(path);
  const existing = store.principals[hostTarget]?.trim();
  if (existing !== undefined && existing.length > 0) {
    return existing;
  }
  const created = randomUUID();
  store.principals[hostTarget] = created;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  return created;
}

async function readStore(path: string): Promise<PrincipalStore> {
  try {
    const raw = JSON.parse(await readFile(path, 'utf8')) as PrincipalStore;
    if (raw && typeof raw === 'object' && raw.principals && typeof raw.principals === 'object') {
      return { principals: { ...raw.principals } };
    }
  } catch {
    // First use or unreadable store: start empty.
  }
  return { principals: {} };
}
