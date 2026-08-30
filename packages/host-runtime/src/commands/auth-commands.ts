import type { HostCommand, HostResponse } from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import { fail, ok } from '../response-helpers.js';
import { SubscriptionAuthService } from '../subscription-auth-service.js';
import type { HostCommandContext } from './host-command-context.js';

const TYPES = new Set<HostCommand['type']>([
  'auth/status',
  'auth/login',
  'auth/respond',
  'auth/cancel',
  'auth/claim',
  'auth/logout',
]);

const services = new Map<string, SubscriptionAuthService>();

export function getSubscriptionAuthService(
  context: Pick<HostCommandContext, 'piwinRoot' | 'push' | 'subscriptionAuth'>,
): SubscriptionAuthService {
  if (context.subscriptionAuth) {
    context.subscriptionAuth.bindPush(context.push);
    return context.subscriptionAuth;
  }
  const key = context.piwinRoot ?? '';
  const existing = services.get(key);
  if (existing) {
    existing.bindPush(context.push);
    return existing;
  }
  const created = new SubscriptionAuthService(
    context.piwinRoot !== undefined ? { piwinRoot: context.piwinRoot } : {},
  );
  created.bindPush(context.push);
  services.set(key, created);
  return created;
}

export async function handleAuthCommand(
  command: HostCommand,
  requestId: string | undefined,
  context: HostCommandContext,
): Promise<HostResponse | null> {
  if (!TYPES.has(command.type)) {
    return null;
  }
  const service = getSubscriptionAuthService(context);
  try {
    switch (command.type) {
      case 'auth/status':
        return ok(requestId, command.type, await service.status());
      case 'auth/login': {
        const result = await service.login({
          providerId: command.input.providerId,
          ownerDeviceId: command.input.ownerDeviceId,
          ...(command.input.relocateChannelId !== undefined
            ? { relocateChannelId: command.input.relocateChannelId }
            : {}),
          ...(command.input.preferLoopback !== undefined
            ? { preferLoopback: command.input.preferLoopback }
            : {}),
        });
        if ('error' in result) {
          return fail(requestId, command.type, result.error, { code: result.code });
        }
        return ok(requestId, command.type, result);
      }
      case 'auth/respond': {
        const result = await service.respond(
          command.input.loginId,
          command.input.promptId,
          command.input.value,
          resolveDeviceId(context, command.input.ownerDeviceId),
        );
        if (result.error && result.code) {
          return fail(requestId, command.type, result.error, { code: result.code });
        }
        return ok(requestId, command.type, {});
      }
      case 'auth/cancel': {
        const result = await service.cancel(
          command.loginId,
          resolveDeviceId(context, command.ownerDeviceId),
        );
        if (result.error && result.code) {
          return fail(requestId, command.type, result.error, { code: result.code });
        }
        return ok(requestId, command.type, {});
      }
      case 'auth/claim': {
        const result = await service.claim(
          command.input.loginId,
          requireDeviceId(context, command.input.ownerDeviceId),
        );
        if (result.error && result.code) {
          return fail(requestId, command.type, result.error, { code: result.code });
        }
        return ok(requestId, command.type, {});
      }
      case 'auth/logout': {
        const result = await service.logout(command.input.providerId, context.cancelRunsForProvider);
        if (result.error && result.code) {
          return fail(requestId, command.type, result.error, { code: result.code });
        }
        return ok(requestId, command.type, {});
      }
      default:
        return null;
    }
  } catch (error) {
    const code =
      error instanceof Error && 'code' in error && typeof error.code === 'string'
        ? error.code
        : 'auth-store-unreadable';
    return fail(requestId, command.type, formatError(error), { code });
  }
}

function resolveDeviceId(context: HostCommandContext, commandOwner?: string): string {
  return commandOwner ?? context.devicePrincipalId ?? 'local';
}

function requireDeviceId(context: HostCommandContext, commandOwner?: string): string {
  return commandOwner ?? context.devicePrincipalId ?? 'local';
}
