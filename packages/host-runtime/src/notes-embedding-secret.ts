/**
 * Resolve the notes embedding API key without logging values.
 * Precedence mirrors provider secrets: apiKeyRef (keychain) → apiKeyEnv → none.
 * Ollama needs no key; absence is not an error here — providers fail at
 * request time with a clear message if the endpoint requires auth.
 */
import { spawn } from 'node:child_process';
import type { NotesEmbeddingConfig } from '@piwin/contracts';

export async function resolveNotesEmbeddingApiKey(
  config: NotesEmbeddingConfig,
): Promise<string | undefined> {
  if (config.apiKeyRef?.trim()) {
    const fromKeychain = await readKeychain(config.apiKeyRef.trim());
    if (fromKeychain) {
      return fromKeychain;
    }
  }
  if (config.apiKeyEnv?.trim()) {
    const fromEnv = process.env[config.apiKeyEnv.trim()];
    if (typeof fromEnv === 'string' && fromEnv.length > 0) {
      return fromEnv;
    }
  }
  return undefined;
}

function readKeychain(ref: string): Promise<string | undefined> {
  if (process.platform !== 'darwin') {
    return Promise.resolve(undefined);
  }
  return new Promise((resolvePromise) => {
    const child = spawn('security', ['find-generic-password', '-s', ref, '-w'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    child.on('close', (code) => {
      resolvePromise(code === 0 && output.trim() ? output.trim() : undefined);
    });
    child.on('error', () => resolvePromise(undefined));
  });
}
