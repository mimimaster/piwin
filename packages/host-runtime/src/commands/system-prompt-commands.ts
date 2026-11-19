/**
 * Host commands for discovering and reading `.md` / `.txt` system prompt files.
 */
import type { HostCommand, HostResponse } from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import { fail, ok } from '../response-helpers.js';
import {
  listSystemPromptCandidateFiles,
  readSystemPromptFiles,
} from '../system-prompt-files.js';

export async function handleSystemPromptCommand(
  command: HostCommand,
  requestId: string | undefined,
  piwinRoot?: string,
): Promise<HostResponse | null> {
  if (command.type === 'system-prompts/list-files') {
    try {
      const data = await listSystemPromptCandidateFiles({
        piwinRoot,
        projectPath: command.projectPath,
      });
      return ok(requestId, 'system-prompts/list-files', data);
    } catch (error) {
      return fail(requestId, 'system-prompts/list-files', formatError(error));
    }
  }

  if (command.type === 'system-prompts/read-files') {
    try {
      const data = await readSystemPromptFiles({
        paths: command.paths,
        piwinRoot,
        projectPath: command.projectPath,
      });
      return ok(requestId, 'system-prompts/read-files', data);
    } catch (error) {
      return fail(requestId, 'system-prompts/read-files', formatError(error));
    }
  }

  return null;
}
