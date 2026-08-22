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
import { handlePermissionRulesCommand } from './permission-rules-commands.js';
import { handlePreviewCommand } from './preview-commands.js';
import { handleMediaIngestCommand } from './media-ingest-commands.js';
import { handleBrowserCommand } from './browser-commands.js';
import { handlePluginCommand } from './plugin-commands.js';
import { handleSessionProductCommand } from './session-product-commands.js';
import { handleSessionPackCommand } from './session-pack-commands.js';
import type { SessionPackCommandContext } from './session-pack-commands.js';
import { handleSessionColdStorageCommand } from './session-cold-storage-commands.js';
import type { SessionColdStorageCommandContext } from './session-cold-storage-commands.js';
import { handleUsageCommand } from './usage-commands.js';
import type { SessionProductCommandContext } from './session-product-commands.js';
import { handleSideChatCommand } from './side-chat-commands.js';
import { handleWalkthroughList, handleWalkthroughGenerate } from './walkthrough-commands.js';
import { handleKnowledgeCommand } from './knowledge-commands.js';
import { handleSubagentCommand } from './subagent-commands.js';

export type DomainDispatchContext = HostCommandContext & {
  sessionProduct: SessionProductCommandContext;
  sessionPack?: SessionPackCommandContext;
  sessionColdStorage?: SessionColdStorageCommandContext;
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

  if (context.sessionColdStorage) {
    const cold = await handleSessionColdStorageCommand(
      command,
      requestId,
      context.sessionColdStorage,
    );
    if (cold) return cold;
  }

  const sideChat = await handleSideChatCommand(command, requestId, context.sessionProduct);
  if (sideChat) return sideChat;

  const project = await handleProjectCommand(command, requestId, context.piwinRoot);
  if (project) return project;

  const permissionRules = await handlePermissionRulesCommand(command, requestId, context);
  if (permissionRules) return permissionRules;

  const preview = await handlePreviewCommand(command, requestId, context.piwinRoot);
  if (preview) return preview;

  const mediaIngest = await handleMediaIngestCommand(command, requestId, context);
  if (mediaIngest) return mediaIngest;

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
