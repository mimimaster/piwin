/**
 * Single catalog seam for Host list IPC and Blueprint compilation.
 * Piwin scanners first, then read-only Pi-native inventory.
 */
import type {
  ExtensionSummary,
  ExtensionsConfig,
  PromptTemplateSummary,
  PromptsConfig,
  SkillSummary,
  SkillsConfig,
} from '@piwin/contracts';
import { isExtensionBlueprintEligible } from '@piwin/contracts';
import { scanSkills } from '@piwin/skills';
import { scanExtensions } from './extension-scanner.js';
import { loadPiNativeInventory } from './pi-package-inventory.js';
import { getPiAgentDir, isDefaultPiwinRoot } from './paths.js';
import { scanPrompts } from './prompt-scanner.js';

export type LoadDiscoveredResourcesOptions = {
  piwinRoot: string;
  /** Pi CLI inventory path. Session OAuth dir is `{PIWIN_ROOT}/pi-agent`, not this. */
  agentDir?: string;
  /**
   * Follow user-global `~/.pi/agent` packages. Defaults to the default product
   * root only so test-host / custom PIWIN_ROOT stay isolated.
   */
  followPiNativeInventory?: boolean;
  projectPath?: string;
  extensionsConfig?: ExtensionsConfig;
  skillsConfig?: SkillsConfig;
  promptsConfig?: PromptsConfig;
  bundledSkillsRoot?: string;
};

export type DiscoveredResourceLists = {
  extensions: ExtensionSummary[];
  skills: SkillSummary[];
  prompts: PromptTemplateSummary[];
};

export async function loadDiscoveredResources(
  options: LoadDiscoveredResourcesOptions,
): Promise<DiscoveredResourceLists> {
  const projectPath = options.projectPath?.trim() || undefined;
  const extensionsConfig = options.extensionsConfig;
  const skillsConfig = options.skillsConfig;
  const promptsConfig = options.promptsConfig;
  const followPiNativeInventory =
    options.followPiNativeInventory ?? isDefaultPiwinRoot(options.piwinRoot);

  const [piwinExtensions, piwinSkills, piwinPrompts, native] = await Promise.all([
    scanExtensions({
      piwinRoot: options.piwinRoot,
      ...(projectPath ? { projectPath } : {}),
      ...(extensionsConfig ? { extensionsConfig } : {}),
    }),
    scanSkills({
      piwinRoot: options.piwinRoot,
      ...(projectPath ? { projectPath } : {}),
      ...(skillsConfig ? { skillsConfig } : {}),
      ...(options.bundledSkillsRoot ? { bundledRoot: options.bundledSkillsRoot } : {}),
    }),
    scanPrompts({
      piwinRoot: options.piwinRoot,
      ...(projectPath ? { projectPath } : {}),
      ...(promptsConfig ? { promptsConfig } : {}),
    }),
    followPiNativeInventory || projectPath
      ? loadPiNativeInventory({
          ...(followPiNativeInventory
            ? { agentDir: options.agentDir ?? getPiAgentDir() }
            : {}),
          includeUserGlobal: followPiNativeInventory,
          ...(projectPath ? { projectPath } : {}),
        })
      : Promise.resolve({ extensions: [], skills: [], prompts: [], diagnostics: [] }),
  ]);

  const extensionDisabled = new Set(
    (extensionsConfig?.disabledIds ?? []).map((id) => id.toLowerCase()),
  );
  const skillDisabled = new Set((skillsConfig?.disabledIds ?? []).map((id) => id.toLowerCase()));
  const promptDisabled = new Set((promptsConfig?.disabledIds ?? []).map((id) => id.toLowerCase()));

  return {
    extensions: [
      ...piwinExtensions,
      ...native.extensions.map((item) => {
        const userEnabled = !extensionDisabled.has(item.id.toLowerCase());
        return {
          ...item,
          enabled: userEnabled && isExtensionBlueprintEligible(item.compatibility),
          configuredEnabled: userEnabled,
        };
      }),
    ],
    skills: [
      ...piwinSkills,
      ...native.skills.map((item) => ({
        ...item,
        enabled: !skillDisabled.has(item.id.toLowerCase()),
      })),
    ],
    prompts: [
      ...piwinPrompts,
      ...native.prompts.map((item) => ({
        ...item,
        enabled: !promptDisabled.has(item.id.toLowerCase()),
      })),
    ],
  };
}
