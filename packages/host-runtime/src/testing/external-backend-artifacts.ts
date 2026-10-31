import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const REQUIRE_EXTERNAL_BACKENDS_ENV = 'PIWIN_REQUIRE_EXTERNAL_BACKENDS';
export const CLAUDE_BACKEND_ENV = 'PIWIN_CLAUDE_BACKEND';
export const CODEX_BACKEND_ENV = 'PIWIN_CODEX_BACKEND';
export const CLAUDE_CLI_ENV = 'CLAUDE_CLI';

export function envPath(name: string): string | undefined {
  const value = process.env[name];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function requireExternalBackends(): boolean {
  return process.env[REQUIRE_EXTERNAL_BACKENDS_ENV] === '1';
}

export type PinnedArtifact = {
  repo: string;
  id: string;
  sha256: string;
  byteSize: number;
  artifactPath: string;
};

export function readPinnedArtifact(repo: string): PinnedArtifact {
  const artifactPath = join(repo, 'dist', 'agent.mjs');
  const manifestPath = join(repo, 'piwin.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`missing piwin.json in ${repo}`);
  }
  if (!existsSync(artifactPath)) {
    throw new Error(`missing dist/agent.mjs in ${repo}`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    sessionBackend?: { id?: unknown; artifact?: { sha256?: unknown; byteSize?: unknown } };
  };
  const id = manifest.sessionBackend?.id;
  const sha256 = manifest.sessionBackend?.artifact?.sha256;
  const byteSize = manifest.sessionBackend?.artifact?.byteSize;
  if (typeof id !== 'string' || typeof sha256 !== 'string' || typeof byteSize !== 'number') {
    throw new Error(`invalid piwin.json in ${repo}`);
  }
  const bytes = readFileSync(artifactPath);
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== sha256 || bytes.byteLength !== byteSize) {
    throw new Error(`artifact pin mismatch in ${repo}: ${digest}/${bytes.byteLength} vs ${sha256}/${byteSize}`);
  }
  return { repo, id, sha256, byteSize, artifactPath };
}
