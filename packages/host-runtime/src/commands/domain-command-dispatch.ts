/**
 * Chains domain host command handlers (everything except live session runtime).
 */
import type { HostCommand, HostResponse } from '@piwin/contracts';
import type { HostCommandContext } from './host-command-context.js';
import { handleCatalogCommand } from './catalog-commands.js';
import { handleMarketplaceSearchCommand } from './marketplace-search-commands.js';
import { handleMcpCommand } from './mcp-commands.js';
import { handleMarketplaceCatalogCommand } from './marketplace-catalog-commands.js';
import { handleCapabilityRemovalCommand } from './capability-removal-commands.js';
import { handleGitCommand } from './git-commands.js';
import { handlePlanCommand } from './plan-commands.js';
import { handleJobCommand } from './job-commands.js';
import { handleAutomationCommand } from './automation-commands.js';
import { handleResolveCommand } from './resolve-commands.js';
import { handleProjectCommand } from './project-commands.js';
import { handlePermissionRulesCommand } from './permission-rules-commands.js';
import { handlePreviewCommand } from './preview-commands.js';
import { handleMediaIngestCommand } from './media-ingest-commands.js';
import { handleMediaSaveCommand } from './media-save-commands.js';
import { handleMediaListCommand } from './media-list-commands.js';
import { handleBrowserCommand } from './browser-commands.js';
import { handlePluginCommand } from './plugin-commands.js';
import { handleSessionProductCommand } from './session-product-commands.js';
import { handleSessionPackCommand } from './session-pack-commands.js';
import type { SessionPackCommandContext } from './session-pack-commands.js';
import { handleSessionColdStorageCommand } from './session-cold-storage-commands.js';
import type { SessionColdStorageCommandContext } from './session-cold-storage-commands.js';
import { handleUsageCommand } from './usage-commands.js';
import { handleWebSearchLogCommand } from './web-search-log-commands.js';
import type { SessionProductCommandContext } from './session-product-commands.js';
import { handleSideChatCommand } from './side-chat-commands.js';
import { handleWalkthroughList, handleWalkthroughGenerate } from './walkthrough-commands.js';
import { handleKnowledgeCommand } from './knowledge-commands.js';
import { handleFlashcardStudyCommand } from './flashcard-study-commands.js';
import { handleSubagentCommand } from './subagent-commands.js';
import { handleTurnChangeCommand } from './turn-change-commands.js';
import { handleAuthCommand } from './auth-commands.js';
import { handlePiEnvironmentCommand } from './pi-environment-commands.js';
import { handleVoiceLiveCommand } from './voice-live-commands.js';
import { handleSessionComposerProfileCommand } from './session-composer-profile-command.js';
import { loadPiwinConfig } from '../config-store.js';

export type DomainDispatchContext = HostCommandContext &
  import('./voice-live-commands.js').VoiceLiveCommandContext & {
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
  const auth = await handleAuthCommand(command, requestId, context);
  if (auth) return auth;

  const piEnvironment = await handlePiEnvironmentCommand(command, requestId, context);
  if (piEnvironment) return piEnvironment;

  const voiceLive = await handleVoiceLiveCommand(command, requestId, context);
  if (voiceLive) return voiceLive;

  const product = await handleSessionProductCommand(command, requestId, context.sessionProduct);
  if (product) return product;

  const composerProfile = await handleSessionComposerProfileCommand(command, requestId, {
    ...(context.piwinRoot === undefined ? {} : { piwinRoot: context.piwinRoot }),
    push: context.push,
    loadConfig: () => loadPiwinConfig(context.piwinRoot),
  });
  if (composerProfile) return composerProfile;

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

  const mediaSave = await handleMediaSaveCommand(command, requestId, context);
  if (mediaSave) return mediaSave;

  const mediaList = await handleMediaListCommand(command, requestId, context);
  if (mediaList) return mediaList;

  const usage = await handleUsageCommand(command, requestId, context);
  if (usage) return usage;

  const webSearchLog = await handleWebSearchLogCommand(command, requestId, context);
  if (webSearchLog) return webSearchLog;

  const marketplaceSearch = await handleMarketplaceSearchCommand(command, requestId, {
    ...(context.piwinRoot === undefined ? {} : { piwinRoot: context.piwinRoot }),
  });
  if (marketplaceSearch) return marketplaceSearch;

  const study = await handleFlashcardStudyCommand(command, requestId, context.flashcardStudy);
  if (study) return study;

  const knowledge = await handleKnowledgeCommand(command, requestId, context.knowledge);
  if (knowledge) return knowledge;

  const subagent = await handleSubagentCommand(command, requestId, context.subagent);
  if (subagent) return subagent;

  const turnChange = await handleTurnChangeCommand(command, requestId, context);
  if (turnChange) return turnChange;

  for (const handler of [
    handleCatalogCommand,
    handleMarketplaceCatalogCommand,
    handleCapabilityRemovalCommand,
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
