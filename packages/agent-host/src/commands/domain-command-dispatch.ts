/**
 * Chains domain host command handlers (everything except live session runtime).
 */
import type { HostCommand, HostResponse } from '@piwin/contracts';
import type { HostCommandContext } from './host-command-context.js';
import { handleCatalogCommand } from './catalog-commands.js';
import { handleMcpCommand } from './mcp-commands.js';
import { handleGitCommand } from './git-commands.js';
import { handlePlanCommand } from './plan-commands.js';
import { handleProcessCommand } from './process-commands.js';
import { handlePtyCommand } from './pty-commands.js';
import { handleAutomationCommand } from './automation-commands.js';
import { handleResolveCommand } from './resolve-commands.js';
import { handleProjectCommand } from './project-commands.js';
import { handleSessionProductCommand } from './session-product-commands.js';
import { handleUsageCommand } from './usage-commands.js';
import type { SessionProductCommandContext } from './session-product-commands.js';

export type DomainDispatchContext = HostCommandContext & {
  sessionProduct: SessionProductCommandContext;
};

export async function dispatchDomainCommands(
  command: HostCommand,
  requestId: string | undefined,
  context: DomainDispatchContext,
): Promise<HostResponse | null> {
  const product = await handleSessionProductCommand(command, requestId, context.sessionProduct);
  if (product) return product;

  const project = await handleProjectCommand(command, requestId, context.piwinRoot);
  if (project) return project;

  const usage = await handleUsageCommand(command, requestId, context);
  if (usage) return usage;

  for (const handler of [
    handleCatalogCommand,
    handleMcpCommand,
    handleGitCommand,
    handlePlanCommand,
    handleProcessCommand,
    handlePtyCommand,
    handleAutomationCommand,
    handleResolveCommand,
  ] as const) {
    const result = await handler(command, requestId, context);
    if (result) {
      return result;
    }
  }
  return null;
}
