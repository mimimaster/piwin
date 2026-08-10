import { describe, expect, it } from 'vitest';
import { parsePetInstallInput } from './pet-install-input.js';

describe('parsePetInstallInput', () => {
  it('accepts bare slugs', () => {
    expect(parsePetInstallInput('guga')).toEqual({ kind: 'slug', slug: 'guga' });
    expect(parsePetInstallInput('  Blankie ')).toEqual({ kind: 'slug', slug: 'blankie' });
    expect(parsePetInstallInput('round-puff-pink')).toEqual({
      kind: 'slug',
      slug: 'round-puff-pink',
    });
  });

  it('parses npx codex-pets add <slug>', () => {
    expect(parsePetInstallInput('npx codex-pets add guga')).toEqual({
      kind: 'slug',
      slug: 'guga',
    });
    expect(parsePetInstallInput('npx --yes codex-pets@latest add round-puff-pink')).toEqual({
      kind: 'slug',
      slug: 'round-puff-pink',
    });
  });

  it('parses npx codexpethub install <slug>', () => {
    expect(parsePetInstallInput('npx codexpethub install guga')).toEqual({
      kind: 'slug',
      slug: 'guga',
    });
    expect(parsePetInstallInput('npx -y codexpethub install blankie')).toEqual({
      kind: 'slug',
      slug: 'blankie',
    });
  });

  it('parses commands without npx prefix', () => {
    expect(parsePetInstallInput('codex-pets add guga')).toEqual({
      kind: 'slug',
      slug: 'guga',
    });
    expect(parsePetInstallInput('codexpethub install guga')).toEqual({
      kind: 'slug',
      slug: 'guga',
    });
  });

  it('rejects garbage and path-like input', () => {
    expect(parsePetInstallInput('')).toMatchObject({ kind: 'error' });
    expect(parsePetInstallInput('../evil')).toMatchObject({ kind: 'error' });
    expect(parsePetInstallInput('npx codex-pets add')).toMatchObject({ kind: 'error' });
  });
});
