import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createDefaultArtifactConfig,
  DEFAULT_AGENT_MODE_SYSTEM_PROMPT,
  type PiwinConfig,
} from '@piwin/contracts';
import { compileBlueprintForWorker } from './blueprint-compiler.js';
import { createExternalSearchWebConfig } from './blueprint-compiler-test-fixtures.js';
import { SettingsService } from './settings/settings-service.js';
import {
  listSystemPromptCandidateFiles,
  readSystemPromptFiles,
} from './system-prompt-files.js';

const tempDirs: string[] = [];

function makeTempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'piwin-sysprompts-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeConfig(overrides?: Partial<PiwinConfig>): PiwinConfig {
  return {
    hostMode: 'rpc',
    providers: [
      {
        id: 'openai-1',
        protocol: 'openai-compatible',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        apiKeyEnv: 'OPENAI_API_KEY',
        models: [{ id: 'gpt-4', label: 'GPT-4', reasoning: true, input: ['text'] }],
      },
    ],
    media: { maxPasteBytes: 10_000_000, allowedMimeTypes: ['image/png'] },
    artifact: {
      ...createDefaultArtifactConfig(),
      scopes: {
        general: { inline: true, canvas: true },
        project: { inline: false, canvas: false },
      },
    },
    web: createExternalSearchWebConfig(),
    skills: { extraPaths: [], disabledIds: [] },
    extensions: { extraPaths: [], disabledIds: [] },
    prompts: { extraPaths: [], disabledIds: [] },
    ...overrides,
  };
}

const emptyResources = async () => ({
  skillPaths: [],
  extensionPaths: [],
  promptPaths: [],
});

describe('system-prompts file stack compilation & persistence', () => {
  it('discovers .md and .txt candidate files in global system-prompts dir and project root', async () => {
    const root = makeTempRoot();
    const projectDir = makeTempRoot();
    const globalDir = join(root, 'system-prompts');
    mkdirSync(globalDir, { recursive: true });
    writeFileSync(join(globalDir, 'persona.md'), '# Persona\nBe thorough.', 'utf8');
    writeFileSync(join(globalDir, 'ignored.json'), '{}', 'utf8');
    writeFileSync(join(projectDir, 'rules.txt'), 'Always run tests.', 'utf8');
    mkdirSync(join(projectDir, 'node_modules'), { recursive: true });
    writeFileSync(join(projectDir, 'node_modules', 'noise.md'), 'ignore me', 'utf8');

    const listed = await listSystemPromptCandidateFiles({
      piwinRoot: root,
      projectPath: projectDir,
    });
    expect(listed.systemPromptsDir).toBe(globalDir);
    expect(listed.files.map((item) => ({ name: item.fileName, source: item.source }))).toEqual([
      { name: 'persona.md', source: 'global' },
      { name: 'rules.txt', source: 'project' },
    ]);

    const read = await readSystemPromptFiles({
      paths: [join(globalDir, 'persona.md'), join(projectDir, 'bad.json'), join(projectDir, 'missing.txt')],
      piwinRoot: root,
      projectPath: projectDir,
    });
    expect(read.files[0]).toMatchObject({ exists: true, content: '# Persona\nBe thorough.' });
    expect(read.files[1]?.exists).toBe(false);
    expect(read.files[1]?.error).toContain('.md and .txt');
    expect(read.files[2]?.exists).toBe(false);
  });

  it('persists preset file stacks and deletions without resurrection', async () => {
    const root = makeTempRoot();
    const service = new SettingsService({ piwinRoot: root });

    await service.update((cfg) => ({
      ...cfg,
      systemPrompts: {
        presets: [
          {
            id: 'reviewer',
            name: 'Reviewer',
            mode: 'append',
            filePaths: ['/tmp/a.md', '/tmp/b.txt'],
            updatedAt: '2026-11-17T00:00:00.000Z',
          },
        ],
        defaultPresetId: 'reviewer',
        projectPresetIds: { '/tmp/p1': 'reviewer' },
      },
    }));

    const deleted = await service.update((cfg) => ({
      ...cfg,
      systemPrompts: { presets: [] },
    }));

    expect(deleted.snapshot.config.systemPrompts).toBeUndefined();
  });

  it('compiles ordered file stacks, picks up external edits, falls back when missing, and isolates subagents', async () => {
    const root = makeTempRoot();
    const projectPath = makeTempRoot();
    const partOne = join(root, 'system-prompts', '01-role.md');
    const partTwo = join(projectPath, '02-rules.txt');
    const missingFile = join(projectPath, 'missing.md');
    mkdirSync(join(root, 'system-prompts'), { recursive: true });
    writeFileSync(partOne, 'Layer 1: Cite exact symbols.', 'utf8');
    writeFileSync(partTwo, 'Layer 2: Keep diffs minimal.', 'utf8');

    const baseConfig = makeConfig({
      systemPrompts: {
        presets: [
          {
            id: 'append-stack',
            name: 'Append Stack',
            mode: 'append',
            filePaths: [partOne, partTwo, missingFile],
            updatedAt: '2026-11-17T00:00:00.000Z',
          },
          {
            id: 'replace-stack',
            name: 'Replace Stack',
            mode: 'replace',
            filePaths: [partOne, partTwo],
            updatedAt: '2026-11-17T00:00:00.000Z',
          },
          {
            id: 'replace-missing',
            name: 'Broken Replace',
            mode: 'replace',
            filePaths: [missingFile],
            updatedAt: '2026-11-17T00:00:00.000Z',
          },
        ],
        defaultPresetId: 'append-stack',
      },
    });

    // Append mode preserves built-in default contract + joins valid stacked files in order.
    const appendCompiled = await compileBlueprintForWorker(
      { scope: { kind: 'project', projectPath } },
      { config: baseConfig, piwinRoot: root, discoverResources: emptyResources },
    );
    expect(appendCompiled.backendBlueprint.systemPromptOverride).toBeUndefined();
    const appended = appendCompiled.backendBlueprint.appendSystemPrompt ?? '';
    expect(appended).toContain(DEFAULT_AGENT_MODE_SYSTEM_PROMPT);
    expect(appended).toContain('Layer 1: Cite exact symbols.\n\nLayer 2: Keep diffs minimal.');
    expect(appendCompiled.sessionBlueprint.systemPromptSummary).toMatchObject({
      presetId: 'append-stack',
      presetName: 'Append Stack',
      presetMode: 'append',
      missingFilePaths: [missingFile],
    });

    // External file edit triggers live content change and new revisionSeed on next compile.
    writeFileSync(partTwo, 'Layer 2: Updated external rule.', 'utf8');
    const afterEdit = await compileBlueprintForWorker(
      { scope: { kind: 'project', projectPath } },
      { config: baseConfig, piwinRoot: root, discoverResources: emptyResources },
    );
    expect(afterEdit.backendBlueprint.appendSystemPrompt).toContain('Layer 2: Updated external rule.');
    expect(afterEdit.blueprint.snapshotId).not.toBe(appendCompiled.blueprint.snapshotId);

    // Replace mode injects compiled stack via systemPromptOverride and drops base agent contract.
    const replaceCompiled = await compileBlueprintForWorker(
      { scope: { kind: 'project', projectPath }, systemPromptPresetId: 'replace-stack' },
      { config: baseConfig, piwinRoot: root, discoverResources: emptyResources },
    );
    expect(replaceCompiled.backendBlueprint.systemPromptOverride).toBe(
      'Layer 1: Cite exact symbols.\n\nLayer 2: Updated external rule.',
    );
    expect(replaceCompiled.backendBlueprint.appendSystemPrompt ?? '').not.toContain(
      DEFAULT_AGENT_MODE_SYSTEM_PROMPT,
    );

    // Replace mode with all files missing safely falls back to built-in default instead of empty prompt.
    const brokenReplaceCompiled = await compileBlueprintForWorker(
      { scope: { kind: 'project', projectPath }, systemPromptPresetId: 'replace-missing' },
      { config: baseConfig, piwinRoot: root, discoverResources: emptyResources },
    );
    expect(brokenReplaceCompiled.backendBlueprint.systemPromptOverride).toBeUndefined();
    expect(brokenReplaceCompiled.backendBlueprint.appendSystemPrompt).toContain(
      DEFAULT_AGENT_MODE_SYSTEM_PROMPT,
    );

    // Subagent stays isolated from custom presets even when global default is set.
    const subagentCompiled = await compileBlueprintForWorker(
      { scope: { kind: 'project', projectPath }, parentSessionId: 'parent-1' },
      { config: baseConfig, piwinRoot: root, discoverResources: emptyResources },
    );
    expect(subagentCompiled.backendBlueprint.systemPromptOverride).toBeUndefined();
    expect(subagentCompiled.backendBlueprint.appendSystemPrompt ?? '').not.toContain(
      'Layer 1: Cite exact symbols.',
    );
  });
});
