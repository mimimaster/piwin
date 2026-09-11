/**
 * Host IPC: detect / preview / apply a local Pi CLI working environment.
 */
import type { HostCommand, HostResponse } from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import { fail, ok } from '../response-helpers.js';
import {
  applyPiEnvironment,
  detectPiEnvironment,
  previewPiEnvironment,
} from '../pi-environment.js';
import { getSubscriptionAuthService } from './auth-commands.js';
import type { HostCommandContext } from './host-command-context.js';

const TYPES = new Set<HostCommand['type']>([
  'pi-environment/detect',
  'pi-environment/preview',
  'pi-environment/apply',
]);

export async function handlePiEnvironmentCommand(
  command: HostCommand,
  requestId: string | undefined,
  context: HostCommandContext,
): Promise<HostResponse | null> {
  if (!TYPES.has(command.type)) {
    return null;
  }
  const options = context.piwinRoot !== undefined ? { piwinRoot: context.piwinRoot } : {};
  try {
    switch (command.type) {
      case 'pi-environment/detect':
        return ok(requestId, command.type, await detectPiEnvironment(options));
      case 'pi-environment/preview':
        return ok(requestId, command.type, await previewPiEnvironment(options));
      case 'pi-environment/apply': {
        const result = await applyPiEnvironment(options);
        if (result.ok && !result.skipped) {
          const service = getSubscriptionAuthService(context);
          service.startWatch();
          await service.ensureLoggedInProviders();
        }
        return ok(requestId, command.type, result);
      }
      default:
        return null;
    }
  } catch (error) {
    return fail(requestId, command.type, formatError(error));
  }
}
