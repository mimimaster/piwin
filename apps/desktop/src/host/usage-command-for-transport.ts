import type { HostCommand } from '@piwin/contracts';

type UsageQuery = Extract<HostCommand, { type: 'usage/get-rollup' | 'usage/list-recent' }>;

/** Preserve usage query dimensions; remote clients cannot submit local paths. */
export function usageCommandForTransport(command: UsageQuery, transport: string): UsageQuery {
  const projectPath = command.projectPath ?? (command.scope?.kind === 'project' ? command.scope.projectPath : undefined);
  const common = {
    ...(command.modelId !== undefined ? { modelId: command.modelId } : {}),
    ...(transport !== 'remote' && projectPath ? { projectPath } : {}),
  };
  if (command.type === 'usage/get-rollup') {
    return { type: command.type, ...common,
      ...(command.window ? { window: command.window } : {}),
      ...(command.topSessions !== undefined ? { topSessions: command.topSessions } : {}),
      ...(command.timeZone !== undefined ? { timeZone: command.timeZone } : {}),
    };
  }
  return { type: command.type, ...common,
    ...(command.windowMinutes !== undefined ? { windowMinutes: command.windowMinutes } : {}),
    ...(command.limit !== undefined ? { limit: command.limit } : {}),
    ...(command.offset !== undefined ? { offset: command.offset } : {}),
  };
}
