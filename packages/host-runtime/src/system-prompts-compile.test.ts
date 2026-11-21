import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyBuiltinSystemPromptStack,
  ARTIFACT_INSTRUCTIONS_TOOL_NAME,
  createDefaultArtifactConfig,
  DEFAULT_AGENT_MODE_SYSTEM_PROMPT,
  type ExecutionRunRecord,
  type HostToolDescriptor,
  type PiwinConfig,
  type PromptInput,
} from '@piwin/contracts';
import { applyAgentPromptContext } from './commands/agent-prompt-context.js';
import type { SessionLiveContext } from './commands/session-live-context.js';
import { compileBlueprintForWorker } from './blueprint-compiler.js';
import { createExternalSearchWebConfig } from './blueprint-compiler-test-fixtures.js';
import { createModelPromptAssembly } from './model-context-assembly.js';
import { SettingsService } from './settings/settings-service.js';
import {
  listSystemPromptCandidateFiles,
  readSystemPromptFiles,
} from './system-prompt-files.js';
import { resolveBuiltinSystemPrompt } from './system-prompts-compile.js';

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

  it('persists builtinStacks without presets and resets cleanly back to default', async () => {
    const root = makeTempRoot();
    const service = new SettingsService({ piwinRoot: root });

    const saved = await service.update((cfg) =>
      applyBuiltinSystemPromptStack(cfg, 'agent.default', {
        includeBuiltin: false,
        filePaths: ['/tmp/custom-agent.md'],
      }),
    );
    expect(saved.snapshot.config.systemPrompts?.builtinStacks?.['agent.default']).toEqual({
      includeBuiltin: false,
      filePaths: ['/tmp/custom-agent.md'],
    });

    const cleared = await service.update((cfg) =>
      applyBuiltinSystemPromptStack(cfg, 'agent.default', {
        includeBuiltin: true,
        filePaths: [],
      }),
    );
    expect(cleared.snapshot.config.systemPrompts).toBeUndefined();
  });

  it('compiles builtinStacks for append, replace, and empty cleared slots (agent + artifact)', async () => {
    const root = makeTempRoot();
    const projectPath = makeTempRoot();
    const agentExtra = join(root, 'system-prompts', 'agent-extra.md');
    const artifactExtra = join(projectPath, 'artifact-rules.txt');
    mkdirSync(join(root, 'system-prompts'), { recursive: true });
    writeFileSync(agentExtra, 'Agent stacked layer.', 'utf8');
    writeFileSync(artifactExtra, 'Custom artifact policy.', 'utf8');

    // 1. includeBuiltin: true + stacked file appends after built-in default
    const appendedConfig = makeConfig({
      artifact: {
        ...createDefaultArtifactConfig(),
        scopes: {
          general: { inline: true, canvas: true },
          project: { inline: true, canvas: true },
        },
      },
      systemPrompts: {
        presets: [],
        builtinStacks: {
          'agent.default': { includeBuiltin: true, filePaths: [agentExtra] },
          'artifact.decision': { includeBuiltin: false, filePaths: [artifactExtra] },
        },
      },
    });
    const artifactDescriptors: HostToolDescriptor[] = [
      { name: ARTIFACT_INSTRUCTIONS_TOOL_NAME, description: 'Artifact instructions', parameters: {} },
    ];
    const artifactFamilyIndex = new Map([['artifact', [ARTIFACT_INSTRUCTIONS_TOOL_NAME]]] as const);
    const compiledAppended = await compileBlueprintForWorker(
      { scope: { kind: 'project', projectPath } },
      {
        config: appendedConfig,
        piwinRoot: root,
        discoverResources: emptyResources,
        hostToolDescriptors: artifactDescriptors,
        hostToolFamilyIndex: artifactFamilyIndex,
      },
    );
    expect(compiledAppended.backendBlueprint.appendSystemPrompt).toContain(
      `${DEFAULT_AGENT_MODE_SYSTEM_PROMPT}\n\nAgent stacked layer.`,
    );
    expect(compiledAppended.backendBlueprint.appendSystemPrompt).toContain('Custom artifact policy.');
    expect(compiledAppended.backendBlueprint.appendSystemPrompt).not.toContain('## Decision Criteria');
    expect(compiledAppended.sessionBlueprint.systemPromptSummary?.builtinModified).toBe(true);

    // 2. includeBuiltin: false + stacked file replaces built-in default
    const replacedConfig = applyBuiltinSystemPromptStack(appendedConfig, 'agent.default', {
      includeBuiltin: false,
      filePaths: [agentExtra],
    });
    const resolvedReplaced = await resolveBuiltinSystemPrompt({
      config: replacedConfig,
      slotId: 'agent.default',
      piwinRoot: root,
      projectPath,
    });
    expect(resolvedReplaced.effectiveContent).toBe('Agent stacked layer.');

    // 3. includeBuiltin: false + empty filePaths disables built-in slot cleanly
    let emptiedConfig = applyBuiltinSystemPromptStack(replacedConfig, 'agent.default', {
      includeBuiltin: false,
      filePaths: [],
    });
    emptiedConfig = applyBuiltinSystemPromptStack(emptiedConfig, 'artifact.decision', {
      includeBuiltin: false,
      filePaths: [],
    });
    const compiledEmpty = await compileBlueprintForWorker(
      { scope: { kind: 'project', projectPath } },
      {
        config: emptiedConfig,
        piwinRoot: root,
        discoverResources: emptyResources,
        hostToolDescriptors: artifactDescriptors,
        hostToolFamilyIndex: artifactFamilyIndex,
      },
    );
    expect(compiledEmpty.backendBlueprint.appendSystemPrompt ?? '').not.toContain(
      DEFAULT_AGENT_MODE_SYSTEM_PROMPT,
    );
    expect(compiledEmpty.backendBlueprint.appendSystemPrompt ?? '').not.toContain(
      '## Decision Criteria',
    );
    expect(compiledEmpty.backendBlueprint.appendSystemPrompt).toContain(
      '## HTML Artifact Runtime Contract',
    );
    expect(compiledEmpty.sessionBlueprint.systemPromptSummary?.builtinModified).toBe(true);
  });

  it('skips per-turn agent/goal preambles when builtinStacks empties them instead of falling back', async () => {
    const root = makeTempRoot();
    const goalFile = join(root, 'goal-extra.md');
    writeFileSync(goalFile, 'Custom goal contract.', 'utf8');

    const emptyAgentCfg = makeConfig({
      systemPrompts: {
        presets: [],
        builtinStacks: {
          'agent.default': { includeBuiltin: false, filePaths: [] },
          'agent.goal': { includeBuiltin: false, filePaths: [goalFile] },
        },
      },
    });

    const makeFakeContext = (cfg: PiwinConfig): SessionLiveContext =>
      ({
        piwinRoot: root,
        loadConfig: async () => cfg,
        setSessionPermissionOverride: () => {},
        clearSessionPermissionOverride: () => {},
        listKnownSubagentProfileIds: async () => [],
        setRunOrchestrationScheme: () => {},
        getRunSignal: () => undefined,
        isPromptPreparationAborted: () => false,
        push: () => {},
        sessionFilesTouched: new Map<string, string>(),
      }) as unknown as SessionLiveContext;

    const fakeRun = { id: 'run-1', status: 'running' } as unknown as ExecutionRunRecord;

    const agentPromptInput: PromptInput = { text: 'Fix bug', agentMode: 'agent' };
    await applyAgentPromptContext(
      makeFakeContext(emptyAgentCfg),
      { sessionId: 'sess-missing', input: agentPromptInput },
      fakeRun,
      createModelPromptAssembly(),
      agentPromptInput,
      'Fix bug',
    );
    expect(agentPromptInput.text).toBe('Fix bug');

    const goalPromptInput: PromptInput = { text: 'Ship feature', agentMode: 'goal' };
    await applyAgentPromptContext(
      makeFakeContext(emptyAgentCfg),
      { sessionId: 'sess-missing', input: goalPromptInput },
      fakeRun,
      createModelPromptAssembly(),
      goalPromptInput,
      'Ship feature',
    );
    expect(goalPromptInput.text).toContain('Custom goal contract.');
    expect(goalPromptInput.text).not.toContain('Autonomous Goal Execution Loop');
  });
});
