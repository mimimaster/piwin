import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { discoverContextManifest } from './context-manifest-discovery.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true })));
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'piwin-context-manifest-'));
  temporaryRoots.push(root);
  return root;
}

describe('discoverContextManifest', () => {
  it('keeps general sessions independent from workspace project instructions', async () => {
    const root = await temporaryRoot();
    const workspace = join(root, 'workspace');
    const agentDir = join(root, 'agent');
    await mkdir(workspace, { recursive: true });
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(workspace, 'AGENTS.md'), 'workspace rules', 'utf8');
    await writeFile(join(agentDir, 'AGENTS.md'), 'user rules', 'utf8');
    await writeFile(join(agentDir, 'SYSTEM.md'), 'user system', 'utf8');

    const manifest = await discoverContextManifest({
      scope: { kind: 'general' },
      workingDirectory: workspace,
      agentDir,
      policy: {
        allowPiNativeInstructions: true,
        allowProjectAgentsFiles: false,
        allowProjectSystemPrompts: false,
      },
    });

    expect(manifest.agentsFiles).toEqual([
      { kind: 'agents', source: 'pi-native', absolutePath: join(agentDir, 'AGENTS.md') },
    ]);
    expect(manifest.systemPrompt?.absolutePath).toBe(join(agentDir, 'SYSTEM.md'));
  });

  it('freezes ancestor agents files and project .pi system prompts in Pi order', async () => {
    const root = await temporaryRoot();
    const project = join(root, 'project');
    const nested = join(project, 'packages', 'app');
    const agentDir = join(root, 'agent');
    await mkdir(join(project, '.pi'), { recursive: true });
    await mkdir(nested, { recursive: true });
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(root, 'AGENTS.md'), 'root rules', 'utf8');
    await writeFile(join(project, 'AGENTS.md'), 'project rules', 'utf8');
    await writeFile(join(nested, 'CLAUDE.md'), 'nested rules', 'utf8');
    await writeFile(join(project, '.pi', 'SYSTEM.md'), 'project system', 'utf8');
    await writeFile(join(project, '.pi', 'APPEND_SYSTEM.md'), 'project append', 'utf8');

    const manifest = await discoverContextManifest({
      scope: { kind: 'project', projectPath: project },
      workingDirectory: nested,
      agentDir,
      policy: {
        allowPiNativeInstructions: true,
        allowProjectAgentsFiles: true,
        allowProjectSystemPrompts: true,
      },
    });

    expect(manifest.agentsFiles.map((file) => file.absolutePath)).toEqual([
      join(root, 'AGENTS.md'),
      join(project, 'AGENTS.md'),
      join(nested, 'CLAUDE.md'),
    ]);
    expect(manifest.systemPrompt?.absolutePath).toBe(join(project, '.pi', 'SYSTEM.md'));
    expect(manifest.appendSystemPrompt?.absolutePath).toBe(
      join(project, '.pi', 'APPEND_SYSTEM.md'),
    );
  });

  it('excludes project context when the compiled policy blocks it', async () => {
    const root = await temporaryRoot();
    const project = join(root, 'project');
    const agentDir = join(root, 'agent');
    await mkdir(project, { recursive: true });
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(project, 'AGENTS.md'), 'untrusted rules', 'utf8');

    const manifest = await discoverContextManifest({
      scope: { kind: 'project', projectPath: project },
      workingDirectory: project,
      agentDir,
      policy: {
        allowPiNativeInstructions: false,
        allowProjectAgentsFiles: false,
        allowProjectSystemPrompts: false,
      },
    });

    expect(manifest).toEqual({ agentsFiles: [] });
  });
});
