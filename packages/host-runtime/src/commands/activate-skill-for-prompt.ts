/**
 * Explicit Skill activation for session/prompt (Agent Skills Tier-2).
 *
 * Slash / structured skillId means the harness activates the skill: load
 * SKILL.md and inject instructions into the model-facing prompt. Discovery
 * catalog (name+description) stays separate; this path does not require the
 * session ResourceLoader (Conversation / general sessions included).
 */
import {
  extractSkillUserRequest,
  formatSkillPrompt,
  readExplicitSkillIntent,
  stripSkillMarkdownFrontmatter,
  type SkillsConfig,
} from '@piwin/contracts';
import { ensureBundledSkillsInstalled, readSkillPreview } from '@piwin/skills';
import { loadPiwinConfig } from '../config-store.js';
import { loadDiscoveredResources } from '../discovered-resources.js';
import { getPiAgentDir, getPiwinRoot } from '../paths.js';

export type ActivateSkillForPromptInput = {
  text: string;
  skillId: string;
  piwinRoot?: string;
  /** Project scope only — enables project-local skill discovery. */
  projectPath?: string;
};

export type ActivateSkillForPromptResult =
  | {
      ok: true;
      text: string;
      skillName: string;
      skillId: string;
      /** Model-facing skill body (frontmatter stripped). */
      skillBody: string;
    }
  | {
      ok: false;
      reason: string;
    };

/**
 * Expand a prompt that carries structured `skillId` with the installed
 * SKILL.md body. Returns ok:false when the skill cannot be read — caller
 * keeps the original thin prompt.
 */
export async function activateSkillForPrompt(
  input: ActivateSkillForPromptInput,
): Promise<ActivateSkillForPromptResult> {
  const skillId = input.skillId.trim();
  if (!skillId) {
    return { ok: false, reason: 'empty-skill-id' };
  }
  const rootDir = getPiwinRoot(input.piwinRoot);
  await ensureBundledSkillsInstalled(rootDir);
  const config = await loadPiwinConfig(rootDir);
  const skillsConfig: SkillsConfig | undefined = config.skills;
  const projectPath = input.projectPath?.trim() || undefined;
  const discovered = await loadDiscoveredResources({
    piwinRoot: rootDir,
    ...(projectPath ? { projectPath } : {}),
    ...(config.extensions ? { extensionsConfig: config.extensions } : {}),
    ...(skillsConfig ? { skillsConfig } : {}),
    ...(config.prompts ? { promptsConfig: config.prompts } : {}),
  });
  const preview = await readSkillPreview({
    piwinRoot: rootDir,
    ...(skillsConfig ? { skillsConfig } : {}),
    skillId,
    ...(projectPath ? { projectPath } : {}),
    discoveredSkills: discovered.skills,
    additionalAuthorizedRoots: [getPiAgentDir()],
  });
  if (preview.status !== 'ready') {
    return {
      ok: false,
      reason: preview.reason ?? 'unavailable',
    };
  }
  const skillBody = stripSkillMarkdownFrontmatter(preview.content);
  if (!skillBody) {
    return { ok: false, reason: 'empty-body' };
  }
  const extracted = extractSkillUserRequest(input.text);
  const slashIntent = readExplicitSkillIntent(input.text);
  const slashRequest =
    slashIntent && slashIntent.skillId.toLowerCase() === skillId.toLowerCase()
      ? slashIntent.userRequest.trim() || '(no additional user request)'
      : undefined;
  const userRequest =
    extracted ?? slashRequest ?? (input.text.trim() || '(no additional user request)');
  return {
    ok: true,
    text: formatSkillPrompt(preview.name, preview.skillId, userRequest, { skillBody }),
    skillName: preview.name,
    skillId: preview.skillId,
    skillBody,
  };
}
