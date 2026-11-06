import type { HostCommand } from '@piwin/contracts';

type UsageQuery = Extract<HostCommand, { type: 'usage/get-rollup' | 'usage/list-recent' }>;

/** Bounds remote usage queries while allowing routed model ids containing slashes. */
export function isSafeRemoteUsageCommand(command: UsageQuery): boolean {
  if (command.projectPath !== undefined) return false;
  if (command.modelId !== undefined && (typeof command.modelId !== 'string' || command.modelId.length === 0 || command.modelId.length > 512)) return false;
  if (command.type === 'usage/get-rollup') {
    return (command.topSessions === undefined || (Number.isSafeInteger(command.topSessions) && command.topSessions > 0 && command.topSessions <= 100))
      && (command.window === undefined || ((command.window.from === undefined || command.window.from.length <= 128) && (command.window.to === undefined || command.window.to.length <= 128)))
      && (command.timeZone === undefined || (typeof command.timeZone === 'string' && command.timeZone.length <= 64));
  }
  return (command.windowMinutes === undefined || (Number.isSafeInteger(command.windowMinutes) && command.windowMinutes > 0 && command.windowMinutes <= 1440))
    && (command.limit === undefined || (Number.isSafeInteger(command.limit) && command.limit > 0 && command.limit <= 500))
    && (command.offset === undefined || (Number.isSafeInteger(command.offset) && command.offset >= 0 && command.offset <= 100_000));
}
