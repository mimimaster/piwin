import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CLAUDE_BACKEND_ENV,
  envPath,
  readPinnedArtifact,
  REQUIRE_EXTERNAL_BACKENDS_ENV,
  requireExternalBackends,
} from './external-backend-artifacts.js';

const originalEnv = { ...process.env };

afterEach(() => {
  for (const key of [CLAUDE_BACKEND_ENV, REQUIRE_EXTERNAL_BACKENDS_ENV]) {
    const previous = originalEnv[key];
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
});

describe('external backend artifact pins', () => {
  it('does not invent a workstation path when the env var is absent', () => {
    delete process.env[CLAUDE_BACKEND_ENV];
    expect(envPath(CLAUDE_BACKEND_ENV)).toBeUndefined();
  });

  it('treats blank env values as unset', () => {
    process.env[CLAUDE_BACKEND_ENV] = '   ';
    expect(envPath(CLAUDE_BACKEND_ENV)).toBeUndefined();
  });

  it('requireExternalBackends is opt-in and not implied by a path existing', () => {
    delete process.env[REQUIRE_EXTERNAL_BACKENDS_ENV];
    expect(requireExternalBackends()).toBe(false);
    process.env[REQUIRE_EXTERNAL_BACKENDS_ENV] = '1';
    expect(requireExternalBackends()).toBe(true);
  });

  it('fails when the declared digest does not match the artifact bytes', () => {
    const repo = mkdtempSync(join(tmpdir(), 'piwin-artifact-pin-'));
    mkdirSync(join(repo, 'dist'));
    const bytes = Buffer.from('candidate-artifact\n');
    writeFileSync(join(repo, 'dist', 'agent.mjs'), bytes);
    writeFileSync(join(repo, 'piwin.json'), `${JSON.stringify({
      sessionBackend: {
        id: 'claude-code',
        artifact: { sha256: 'deadbeef', byteSize: bytes.byteLength },
      },
    })}\n`);
    expect(() => readPinnedArtifact(repo)).toThrow(/artifact pin mismatch/);
  });

  it('returns the pin when digest and size match', () => {
    const repo = mkdtempSync(join(tmpdir(), 'piwin-artifact-pin-ok-'));
    mkdirSync(join(repo, 'dist'));
    const bytes = Buffer.from('candidate-artifact-ok\n');
    writeFileSync(join(repo, 'dist', 'agent.mjs'), bytes);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    writeFileSync(join(repo, 'piwin.json'), `${JSON.stringify({
      sessionBackend: {
        id: 'codex',
        artifact: { sha256, byteSize: bytes.byteLength },
      },
    })}\n`);
    expect(readPinnedArtifact(repo)).toEqual({
      repo,
      id: 'codex',
      sha256,
      byteSize: bytes.byteLength,
      artifactPath: join(repo, 'dist', 'agent.mjs'),
    });
  });
});
