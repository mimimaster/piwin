/**
 * Route a parsed reserved slash command (`/compact`, `/handoff`) to its
 * composer handler. Shared by Send, steer, follow-up and queued send-now so a
 * reserved command never reaches the model as prompt text.
 */
import { normalizeCompactCustomInstructions } from '../slash';
import type { ReservedSlashCommandId } from '../slash/slash-types';
import type { UseComposerMediaArgs } from './composer-media-args';

/** `false` means the command did not run and the composer text should stay. */
export async function runComposerReservedCommand(
  parsed: { commandId: ReservedSlashCommandId; args: string },
  handlers: Pick<UseComposerMediaArgs, 'onCompact' | 'onHandoff'>,
): Promise<boolean | void> {
  const instructions = normalizeCompactCustomInstructions(parsed.args);
  if (parsed.commandId === 'handoff') {
    return handlers.onHandoff?.(instructions) ?? false;
  }
  return handlers.onCompact?.(instructions);
}
