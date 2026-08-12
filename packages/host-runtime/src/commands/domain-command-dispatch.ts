/**
 * Chains domain host command handlers (everything except live session runtime).
 */
import type { HostCommand, HostResponse } from '@piwin/contracts';
import type { HostCommandContext } from './host-command-context.js';
import { handleCatalogCommand } from './catalog-commands.js';
import { handleMcpCommand } from './mcp-commands.js';
import { handleGitCommand } from './git-commands.js';
import { handlePlanCommand } from './plan-commands.js';
import { handleJobCommand } from './job-commands.js';
import { handleAutomationCommand } from './automation-commands.js';
import { handleResolveCommand } from './resolve-commands.js';
import { handleProjectCommand } from './project-commands.js';
import { handleBrowserCommand } from './browser-commands.js';
import { handlePluginCommand } from './plugin-commands.js';
import { handleSessionProductCommand } from './session-product-commands.js';
import { handleSessionPackCommand } from './session-pack-commands.js';
import type { SessionPackCommandContext } from './session-pack-commands.js';
import { handleUsageCommand } from './usage-commands.js';
import type { SessionProductCommandContext } from './session-product-commands.js';
import { handleSideChatCommand } from './side-chat-commands.js';
import { handleWalkthroughList, handleWalkthroughGenerate } from './walkthrough-commands.js';
import { handleKnowledgeCommand } from './knowledge-commands.js';
import { handleSubagentCommand } from './subagent-commands.js';

export type DomainDispatchContext = HostCommandContext & {
  sessionProduct: SessionProductCommandContext;
  sessionPack?: SessionPackCommandContext;
};

export async function dispatchDomainCommands(
  command: HostCommand,
  requestId: string | undefined,
  context: DomainDispatchContext,
): Promise<HostResponse | null> {
  // Walkthrough list/generate are short control commands handled before the
  // rest of the domain chain. walkthrough/cancel is handled even earlier in
  // HostRuntime.handleCommand so it bypasses the normal dispatch entirely.
  if (command.type === 'walkthrough/list' && context.walkthrough) {
    return handleWalkthroughList(command, requestId, context.walkthrough.context);
  }
  if (command.type === 'walkthrough/generate' && context.walkthrough) {
    return handleWalkthroughGenerate(
      command,
      requestId,
      context.walkthrough.context,
      context.walkthrough.registry,
    );
  }

  const product = await handleSessionProductCommand(command, requestId, context.sessionProduct);
  if (product) return product;

  if (context.sessionPack) {
    const pack = await handleSessionPackCommand(command, requestId, context.sessionPack);
    if (pack) return pack;
  }

  const sideChat = await handleSideChatCommand(command, requestId, context.sessionProduct);
  if (sideChat) return sideChat;

  const project = await handleProjectCommand(command, requestId, context.piwinRoot);
  if (project) return project;

  const usage = await handleUsageCommand(command, requestId, context);
  if (usage) return usage;

  const knowledge = await handleKnowledgeCommand(command, requestId, context.knowledge);
  if (knowledge) return knowledge;

  const subagent = await handleSubagentCommand(command, requestId, context.subagent);
  if (subagent) return subagent;

  for (const handler of [
    handleCatalogCommand,
    handleMcpCommand,
    handleGitCommand,
    handlePlanCommand,
    handleJobCommand,
    handleAutomationCommand,
    handleResolveCommand,
    handleBrowserCommand,
    handlePluginCommand,
  ] as const) {
    const result = await handler(command, requestId, context);
    if (result) {
      return result;
    }
  }
  return null;
}
