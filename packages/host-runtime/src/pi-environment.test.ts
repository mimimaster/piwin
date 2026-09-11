import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyPiEnvironment,
  detectPiEnvironment,
  previewPiEnvironment,
} from './pi-environment.js';

async function seedPiHome(): Promise<string> {
  const agentDir = await mkdtemp(join(tmpdir(), 'pi-cli-home-'));
  await writeFile(
    join(agentDir, 'auth.json'),
    JSON.stringify({ 'openai-codex': { type: 'oauth' }, xai: { type: 'oauth' } }),
    'utf8',
  );
  await mkdir(join(agentDir, 'extensions'), { recursive: true });
  await writeFile(
    join(agentDir, 'extensions', 'hello.ts'),
    "pi.on('tool_call', () => {});\n",
    'utf8',
  );
  await mkdir(join(agentDir, 'skills', 'demo'), { recursive: true });
  await writeFile(
    join(agentDir, 'skills', 'demo', 'SKILL.md'),
    '---\nname: demo\ndescription: Demo skill\n---\n',
    'utf8',
  );
  return agentDir;
}

describe('pi environment ingest', () => {
  it('skips detect/preview/apply on a custom product root', async () => {
    const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-custom-'));
    const piAgentDir = await seedPiHome();
    const detect = await detectPiEnvironment({
      piwinRoot,
      piAgentDir,
      defaultProductRoot: join(tmpdir(), 'not-this-root'),
    });
    expect(detect).toEqual({ available: false, reason: 'non-default-root' });
    const preview = await previewPiEnvironment({
      piwinRoot,
      piAgentDir,
      defaultProductRoot: join(tmpdir(), 'not-this-root'),
    });
    expect(preview.available).toBe(false);
    expect(preview.missingProviderIds).toEqual([]);
    const apply = await applyPiEnvironment({
      piwinRoot,
      piAgentDir,
      defaultProductRoot: join(tmpdir(), 'not-this-root'),
    });
    expect(apply.ok).toBe(false);
    expect(apply.skipped).toBe(true);
    expect(apply.copiedProviderIds).toEqual([]);
    await expect(readFile(join(piwinRoot, 'pi-agent', 'auth.json'), 'utf8')).rejects.toThrow();
  });

  it('previews missing oauth keys and merges them on apply', async () => {
    const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-default-'));
    const piAgentDir = await seedPiHome();
    await mkdir(join(piwinRoot, 'pi-agent'), { recursive: true });
    await writeFile(
      join(piwinRoot, 'pi-agent', 'auth.json'),
      JSON.stringify({ 'openai-codex': { type: 'oauth', token: 'host' } }),
      'utf8',
    );
    const detect = await detectPiEnvironment({
      piwinRoot,
      piAgentDir,
      defaultProductRoot: piwinRoot,
    });
    expect(detect.available).toBe(true);
    const preview = await previewPiEnvironment({
      piwinRoot,
      piAgentDir,
      defaultProductRoot: piwinRoot,
    });
    expect(preview.missingProviderIds).toEqual(['xai']);
    expect(preview.followedExtensionCount).toBeGreaterThan(0);
    expect(preview.followedSkillCount).toBeGreaterThan(0);
    const apply = await applyPiEnvironment({
      piwinRoot,
      piAgentDir,
      defaultProductRoot: piwinRoot,
    });
    expect(apply.ok).toBe(true);
    expect(apply.copiedProviderIds).toEqual(['xai']);
    expect(JSON.parse(await readFile(join(piwinRoot, 'pi-agent', 'auth.json'), 'utf8'))).toEqual({
      'openai-codex': { type: 'oauth', token: 'host' },
      xai: { type: 'oauth' },
    });
    expect(apply.receiptPath).toBe(join(piwinRoot, 'pi-agent', 'ingest-receipt.json'));
    const receipt = JSON.parse(await readFile(apply.receiptPath ?? '', 'utf8')) as {
      copiedProviderIds: string[];
      sourcePath: string;
    };
    expect(receipt.copiedProviderIds).toEqual(['xai']);
    expect(receipt.sourcePath).toBe(piAgentDir);
  });
});
