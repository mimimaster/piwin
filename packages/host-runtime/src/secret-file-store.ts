/**
 * File-backed Host secret store under `<piwinRoot>/secrets/<service>`.
 * Directory 0700, files 0600 — enforced on POSIX; on Windows the mode is a
 * no-op, which is why the Windows defaults migrate these files out.
 */
import { chmod, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** `keychain:<service>` or a bare service name → a name safe as a file or keychain item. */
export function secretServiceName(ref: string): string {
  const service = ref.startsWith('keychain:') ? ref.slice('keychain:'.length) : ref;
  const safe = service.trim().replace(/[^A-Za-z0-9._-]+/g, '_');
  if (!safe) {
    throw new Error('Invalid keychain service name');
  }
  return safe;
}

function secretFilePath(root: string, service: string): string {
  return join(root, 'secrets', service);
}

export async function readFileSecret(root: string, service: string): Promise<string | null> {
  try {
    const raw = await readFile(secretFilePath(root, service), 'utf8');
    const value = raw.trim();
    return value.length > 0 ? value : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function deleteFileSecret(root: string, service: string): Promise<void> {
  try {
    await unlink(secretFilePath(root, service));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
}

export async function writeFileSecret(
  root: string,
  service: string,
  secret: string,
): Promise<void> {
  const dir = join(root, 'secrets');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const file = secretFilePath(root, service);
  await writeFile(file, secret, { encoding: 'utf8', mode: 0o600 });
  await chmod(file, 0o600);
  await chmod(dir, 0o700);
}
