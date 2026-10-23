/** macOS login keychain through the `security` CLI (generic passwords, account `piwin`). */
import { spawn } from 'node:child_process';

/**
 * macOS keychain via `security find-generic-password -w -s <service>`.
 * apiKeyRef format: `keychain:<service>` or bare service name.
 */
export async function readMacKeychain(service: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn('security', ['find-generic-password', '-w', '-s', service], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.on('error', () => resolve(null));
    child.on('close', (code) => {
      if (code !== 0) {
        resolve(null);
        return;
      }
      const value = stdout.trim();
      resolve(value.length > 0 ? value : null);
    });
  });
}

export async function writeMacKeychain(service: string, secret: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      'security',
      ['add-generic-password', '-U', '-a', 'piwin', '-s', service, '-w', secret],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      reject(error);
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `keychain write failed (exit ${code ?? 'unknown'})`));
    });
  });
}

export async function deleteMacKeychain(service: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('security', ['delete-generic-password', '-s', service], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      if (code === 0 || code === 44) {
        resolve();
        return;
      }
      reject(new Error(`keychain delete failed (exit ${code ?? 'unknown'})`));
    });
  });
}
