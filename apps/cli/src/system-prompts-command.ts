import {
  BUILTIN_SYSTEM_PROMPTS,
  createDefaultSystemPromptsConfig,
  readBuiltinSystemPromptValue,
  resolveActiveSystemPromptSelection,
  SYSTEM_PROMPT_BUILTIN_ID,
  SYSTEM_PROMPT_INHERIT_ID,
  type BuiltinSystemPromptSlotId,
} from '@piwin/contracts';
import { getPiwinRoot, loadPiwinConfig, savePiwinConfig } from '@piwin/host-runtime';
import { parseOptionalProject } from './cli-args.js';

/**
 * `piwin system-prompts` subcommand: list, show, and switch system prompt presets.
 */
export async function commandSystemPrompts(argv: string[]): Promise<void> {
  const sub = argv[1] ?? 'list';
  const root = getPiwinRoot();
  const projectPath = parseOptionalProject(argv) ?? undefined;
  const config = await loadPiwinConfig(root);
  const systemPrompts = config.systemPrompts ?? createDefaultSystemPromptsConfig();

  if (sub === 'list') {
    const active = resolveActiveSystemPromptSelection({ config, projectPath });
    console.log(`Active (${projectPath ? `project ${projectPath}` : 'global'}): ${active.sourceKind} -> ${active.effectiveSelectionId}`);
    console.log('');
    console.log('Custom Presets:');
    if (systemPrompts.presets.length === 0) {
      console.log('  (none)');
    } else {
      for (const preset of systemPrompts.presets) {
        const isGlobal = systemPrompts.defaultPresetId === preset.id ? ' [global-default]' : '';
        console.log(`  ${preset.id}\t[${preset.mode}]\t${preset.name}${isGlobal}`);
      }
    }
    console.log('');
    console.log('Built-in Prompts:');
    for (const slot of BUILTIN_SYSTEM_PROMPTS) {
      const value = readBuiltinSystemPromptValue(config, slot.slotId);
      const tag = !slot.overridable
        ? '[read-only]'
        : value.isOverridden
          ? '[custom]'
          : '[default]';
      console.log(`  ${slot.slotId}\t${tag}\t${slot.titleEn}`);
    }
    return;
  }

  if (sub === 'show') {
    const targetId = argv[2];
    if (!targetId) {
      console.error('Usage: piwin system-prompts show <preset-id|slot-id>');
      process.exitCode = 1;
      return;
    }
    const preset = systemPrompts.presets.find((item) => item.id === targetId);
    if (preset) {
      console.log(`id: ${preset.id}`);
      console.log(`name: ${preset.name}`);
      console.log(`mode: ${preset.mode}`);
      console.log(`updatedAt: ${preset.updatedAt}`);
      console.log('---');
      console.log(preset.content);
      return;
    }
    const builtin = BUILTIN_SYSTEM_PROMPTS.find((item) => item.slotId === targetId);
    if (builtin) {
      const value = readBuiltinSystemPromptValue(config, builtin.slotId as BuiltinSystemPromptSlotId);
      console.log(`slotId: ${builtin.slotId}`);
      console.log(`title: ${builtin.titleEn} (${builtin.titleZh})`);
      console.log(`overridable: ${builtin.overridable}`);
      console.log(`overridden: ${value.isOverridden}`);
      console.log('---');
      console.log(value.effectiveContent);
      return;
    }
    console.error(`Unknown system prompt id or slot: ${targetId}`);
    process.exitCode = 1;
    return;
  }

  if (sub === 'use') {
    const rawTarget = argv[2];
    if (!rawTarget) {
      console.error('Usage: piwin system-prompts use <preset-id|default|inherit> [--project <path>]');
      process.exitCode = 1;
      return;
    }
    const normalized =
      rawTarget === 'default' || rawTarget === SYSTEM_PROMPT_BUILTIN_ID
        ? SYSTEM_PROMPT_BUILTIN_ID
        : rawTarget;

    if (
      normalized !== SYSTEM_PROMPT_BUILTIN_ID &&
      normalized !== SYSTEM_PROMPT_INHERIT_ID &&
      !systemPrompts.presets.some((item) => item.id === normalized)
    ) {
      console.error(`Unknown preset id: ${rawTarget}`);
      process.exitCode = 1;
      return;
    }

    const current = await loadPiwinConfig(root);
    const currentSp = current.systemPrompts ?? createDefaultSystemPromptsConfig();
    let nextConfig = current;
    if (projectPath) {
      const nextProjects = { ...(currentSp.projectPresetIds ?? {}) };
      if (normalized === SYSTEM_PROMPT_INHERIT_ID) {
        delete nextProjects[projectPath];
      } else {
        nextProjects[projectPath] = normalized;
      }
      const { projectPresetIds: _prev, ...rest } = currentSp;
      nextConfig = {
        ...current,
        systemPrompts:
          Object.keys(nextProjects).length > 0
            ? { ...rest, projectPresetIds: nextProjects }
            : rest,
      };
    } else {
      const { defaultPresetId: _prevDefault, ...rest } = currentSp;
      const clearGlobal =
        normalized === SYSTEM_PROMPT_BUILTIN_ID || normalized === SYSTEM_PROMPT_INHERIT_ID;
      nextConfig = {
        ...current,
        systemPrompts: clearGlobal ? rest : { ...rest, defaultPresetId: normalized },
      };
    }
    await savePiwinConfig(nextConfig, root);
    console.log(
      projectPath
        ? `Updated project (${projectPath}) system prompt -> ${normalized}`
        : `Updated global default system prompt -> ${normalized}`,
    );
    return;
  }

  console.error(`Unknown system-prompts subcommand: ${sub}`);
  console.error('Usage: piwin system-prompts list | show <id> | use <preset-id|default|inherit> [--project <path>]');
  process.exitCode = 1;
}
