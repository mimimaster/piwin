/**
 * `skills/update`: re-install a git-installed skill from its recorded origin.
 * Kept out of catalog-commands so that module stays under the size cap.
 */
import type { HostCommand, HostResponse, SkillsUpdateData } from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import { SkillUpdateError, updateSkillFromOrigin } from '@piwin/skills';
import { getPiwinRoot } from '../paths.js';
import { fail, ok } from '../response-helpers.js';
import { loadCatalogResources } from './catalog-resources.js';
import type { HostCommandContext } from './host-command-context.js';

export async function handleSkillUpdateCommand(
  command: HostCommand,
  requestId: string | undefined,
  context: Pick<HostCommandContext, 'piwinRoot'>,
  update: typeof updateSkillFromOrigin = updateSkillFromOrigin,
): Promise<HostResponse | null> {
  if (command.type !== 'skills/update') return null;
  const skillId = command.skillId.trim();
  if (!skillId) return fail(requestId, 'skills/update', 'skillId is required');
  const rootDir = getPiwinRoot(context.piwinRoot);
  const skill = (await loadCatalogResources(rootDir)).skills.find((entry) => entry.id === skillId);
  if (!skill) return fail(requestId, 'skills/update', `Skill not found: ${skillId}`);
  try {
    const data: SkillsUpdateData = await update({ piwinRoot: rootDir, skill });
    return ok(requestId, 'skills/update', data);
  } catch (error) {
    // Refusals (pinned, no origin) and git failures both reach the user as text.
    return fail(
      requestId,
      'skills/update',
      error instanceof SkillUpdateError ? error.message : formatError(error),
    );
  }
}
