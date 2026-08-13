/**
 * Compose the concrete parent-owned Host tools for one session.
 *
 * This is the single source of truth for what Host tool executors exist.
 * The blueprint compiler derives model-visible descriptors from the output
 * of this function. A tool that has no executor here must not appear in any
 * session manifest.
 *
 * Authority: @piwin/host-runtime (product composition root).
 */

import type {
  HostToolRegistration,
  McpConfigDocument,
  McpToolMetadata,
  SessionPlan,
} from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import { buildSessionTools } from '../session-tools.js';
import { buildProcessTools } from '../process-tools.js';
import { createBrowserToolDefinitions } from '../browser-tools.js';
import { buildNotesTools } from '../notes-tools.js';
import { buildFlashcardTools } from '../flashcard-tools.js';
import { buildMcpGatewayToolDefinition } from '../mcp-gateway-tool.js';
import { createPlanCreateTool } from '../plan-create-tool.js';
import { createPlanStepTool } from '../plan-step-tool.js';
import { createSubagentRunTool, type SubagentRunSeam } from '../subagent-run-tool.js';
import { buildImageGenTool } from '../image-gen-tool.js';
import { buildVideoGenTool } from '../video-gen-tool.js';
import { buildArtifactInstructionsTool } from '../artifact-instructions-tool.js';
import { buildHostFilesystemTools } from './host-filesystem-tools.js';
import type { SecretResolver } from '../secret-resolver.js';
import {
  createMcpGenerationSnapshot,
  loadMcpConfig,
  type McpGenerationSnapshot,
  type McpLifecycleManager,
} from '@piwin/mcp';
import { resolveWebConfig } from '@piwin/tools-web';
import {
  findConfiguredModel,
  resolveNativeSearchAdapterSupport,
  resolveSearchRoute,
  shouldExposeExternalWebSearch,
} from '../capabilities/search-route-resolver.js';
import type { BrowserSession } from '@piwin/browser';
import type { NoteStore, NoteIndex, SearchNotesOptions } from '@piwin/notes';
import type { CardStore } from '@piwin/flashcards';
import type { JobController } from '@piwin/contracts';
import type { ModelRef, PiwinConfig } from '@piwin/contracts';
import { getPiwinSessionPlanPath, getPiwinRoot } from '../paths.js';
import { getPiwinMediaDir } from '../paths.js';
import { buildCachedMcpToolDefinitions } from '../mcp-cached-tool-definitions.js';
import {
  buildMcpCapabilityBrief,
  formatMcpGatewayToolDescription,
  type McpCapabilityBrief,
} from '../mcp-capability-brief.js';
import { compactModelToolDescriptor } from '../model-tool-descriptor.js';
import {
  buildHostToolboxRegistration,
  isHostToolboxTargetFamily,
} from '../host-toolbox.js';
import { buildWebSearchModelDelegate } from '../model-web-search-delegate.js';

/**
 * Lazy provider for notes services. The Host owns the lifecycle; this
 * callback lets the tool builder defer initialization until the first
 * tool call.
 */
export type NotesServicesProvider = () => Promise<{
  store: NoteStore;
  index: NoteIndex;
  searchOptions: SearchNotesOptions;
}>;

/** Lazy provider for the flashcard store. */
export type CardStoreProvider = () => Promise<CardStore>;

/** Lazy provider for the browser session. */
export type BrowserSessionProvider = () => BrowserSession | undefined;

export type HostToolCompositionDiagnostic = {
  capability: string;
  message: string;
};

/** Options for composing per-session Host tools. */
export type BuildSessionHostToolsOptions = {
  sessionId: string;
  piwinRoot?: string;
  projectPath?: string;

  /** Single Host Job authority for process tools. */
  jobController?: JobController | null;

  getBrowserSession?: BrowserSessionProvider;
  getNotesServices?: NotesServicesProvider;
  getCardStore?: CardStoreProvider;

  /** MCP lifecycle manager for the gateway tool. */
  mcpManager?: McpLifecycleManager | null;
  /** Runtime generation identity used to scope MCP transports. */
  runtimeGenerationId?: string;
  /** Frozen MCP config and enabled server ids for this runtime generation. */
  mcpConfig?: McpConfigDocument;
  /** Frozen MCP snapshot; preferred over the compatibility config field. */
  mcpSnapshot?: McpGenerationSnapshot;

  /** Config for tool availability checks (web, notes, flashcards, image-gen). */
  config?: PiwinConfig;

  /** Selected chat model for this generation (ADR 0043 search routing). */
  model?: ModelRef;

  /** Secret resolver for provider-backed media generation. */
  secretResolver?: SecretResolver;

  /** Subagent run seam for the delegate tool. */
  subagentSeam?: SubagentRunSeam;

  /** Publish mutations made by model-facing plan tools. */
  onPlanUpdated?: (plan: SessionPlan) => void;

  /** Observe optional capability failures while composing a generation. */
  onDiagnostic?: (diagnostic: HostToolCompositionDiagnostic) => void;
  /** Preserve the exact MCP capability brief on the frozen generation surface. */
  onMcpCapabilityBrief?: (brief: McpCapabilityBrief) => void;
};

/**
 * Compose the complete set of parent-owned Host tools for one session.
 * Returns concrete Host registrations with real executors — not
 * name-only descriptors.
 *
 * Tools that cannot be initialized (missing browser session, missing
 * notes services, etc.) are simply omitted. The blueprint compiler must
 * not advertise a tool that this function did not return.
 */
export async function buildSessionHostTools(
  options: BuildSessionHostToolsOptions,
): Promise<HostToolRegistration[]> {
  const tools: HostToolRegistration[] = [];
  const rootDir = getPiwinRoot(options.piwinRoot);

  let mcpDocument = options.mcpConfig;
  if (!mcpDocument && options.mcpManager) {
    try {
      mcpDocument = await loadMcpConfig(rootDir);
    } catch (error) {
      reportCompositionDiagnostic(options, 'mcp-config', error);
      // Invalid/unreadable MCP config fails closed: no MCP tool surface.
    }
  }
  const mcpSnapshot =
    options.mcpSnapshot ??
    createMcpGenerationSnapshot(
      mcpDocument ?? { mcpServers: {} },
      options.runtimeGenerationId ?? `${options.sessionId}:direct`,
    );
  const mcpConfig = mcpSnapshot.config;
  // --- Web tools (web_search, web_fetch) ---
  // ADR 0043: expose external web_search only when the resolved search route
  // selected the external backend for this generation's model/policy.
  if (options.config?.web) {
    const webSearchDelegate = options.secretResolver
      ? buildWebSearchModelDelegate(options.config, options.secretResolver)
      : undefined;
    const webRegistration = buildSessionTools({
      webConfig: options.config.web,
      ...(webSearchDelegate ? { webSearchDelegate } : {}),
    });
    const configuredModel = findConfiguredModel(options.config, options.model);
    const searchRoute = resolveSearchRoute({
      ...(configuredModel?.model ? { model: configuredModel.model } : {}),
      web: resolveWebConfig(options.config.web),
      adapter: resolveNativeSearchAdapterSupport(
        configuredModel?.provider.protocol,
        configuredModel?.model.nativeSearchAdapter,
      ),
      externalDelegateReady: Boolean(webSearchDelegate),
    });
    const webSearchReady = shouldExposeExternalWebSearch(searchRoute);
    tools.push(
      ...webRegistration.tools.filter(
        (tool) => tool.descriptor.name !== 'web_search' || webSearchReady,
      ),
    );
  }

  // --- Filesystem + bash tools (read_file, write_file, list_directory, bash, run_bash) ---
  // These are Host-owned executors for the worker manifest. They supplement
  // (not replace) Pi's built-in read/grep/ls with parent-gated write/bash.
  // Pi built-ins remain owned by the Pi backend; these registrations provide
  // the parent-owned surface shared by SDK and RPC execution.
  const fsTools = buildHostFilesystemTools({
    cwd: options.projectPath ?? rootDir ?? process.cwd(),
  });
  tools.push(...fsTools);

  // --- Process tools (process_start, process_list, process_logs, process_stop) ---
  if (options.jobController && options.config?.process?.enabled !== false) {
    const processTools = buildProcessTools({
      jobController: options.jobController,
      sessionId: options.sessionId,
      ...(options.projectPath ? { projectPath: options.projectPath } : {}),
    });
    tools.push(...processTools);
  }

  // --- Browser tools ---
  const browserSession = options.getBrowserSession?.();
  if (browserSession) {
    const browserTools = createBrowserToolDefinitions(browserSession, {
      projectRoot: options.projectPath ?? rootDir ?? process.cwd(),
    });
    tools.push(...browserTools);
  }

  // --- Notes tools ---
  if (options.getNotesServices && options.config?.notes?.enabled !== false) {
    try {
      const notesServices = await options.getNotesServices();
      const notesTools = buildNotesTools({
        store: notesServices.store,
        index: notesServices.index,
        enabled: true,
        ...(notesServices.searchOptions.embeddingProvider
          ? { embeddingProvider: notesServices.searchOptions.embeddingProvider }
          : {}),
        ...(notesServices.searchOptions.rerankProvider
          ? { rerankProvider: notesServices.searchOptions.rerankProvider }
          : {}),
        ...(notesServices.searchOptions.rrfK !== undefined
          ? { rrfK: notesServices.searchOptions.rrfK }
          : {}),
      });
      tools.push(...notesTools);
    } catch (error) {
      reportCompositionDiagnostic(options, 'notes', error);
      // Notes services unavailable — omit notes tools.
    }
  }

  // --- Flashcard tools ---
  if (options.getCardStore && options.config?.flashcards?.enabled !== false) {
    try {
      const cardStore = await options.getCardStore();
      const flashcardTools = buildFlashcardTools({
        store: cardStore,
        enabled: true,
      });
      tools.push(...flashcardTools);
    } catch (error) {
      reportCompositionDiagnostic(options, 'flashcards', error);
      // Flashcard store unavailable — omit flashcard tools.
    }
  }

  // --- MCP capability brief, gateway, and cached direct tools ---
  // Cache reads are metadata-only and must never connect or start an MCP
  // server. The brief is built once from this frozen generation's config and
  // the valid cache result, including the exact direct tool names.
  let cachedToolsByServer: Record<string, readonly McpToolMetadata[]> = {};
  let directMcpTools: HostToolRegistration[] = [];
  if (options.mcpManager) {
    try {
      const cachedMcpTools = await buildCachedMcpToolDefinitions({
        lifecycleManager: options.mcpManager,
        mcpConfig,
        mcpSnapshot,
      });
      cachedToolsByServer = cachedMcpTools.cachedToolsByServer;
      directMcpTools = cachedMcpTools.tools;
    } catch (error) {
      reportCompositionDiagnostic(options, 'mcp-cached-tools', error);
      // Cache failure degrades to config-only MCP guidance; the gateway remains
      // available and can still describe/call known selectors.
    }
  }

  const mcpCapabilityBrief = buildMcpCapabilityBrief({
    config: mcpConfig,
    cachedToolsByServer,
    directExposedNames: directMcpTools.map((tool) => tool.descriptor.name),
  });
  options.onMcpCapabilityBrief?.(mcpCapabilityBrief);

  if (options.mcpManager) {
    const mcpTool = buildMcpGatewayToolDefinition({
      lifecycleManager: options.mcpManager,
      mcpConfig,
      mcpSnapshot,
      description: formatMcpGatewayToolDescription(mcpCapabilityBrief),
    });
    tools.push(mcpTool, ...directMcpTools);
  }

  // --- Planning tools ---
  if (rootDir && options.projectPath) {
    const planPath = getPiwinSessionPlanPath(rootDir, options.sessionId);
    tools.push(
      createPlanCreateTool({
        sessionId: options.sessionId,
        projectPath: options.projectPath,
        planPath,
        ...(options.onPlanUpdated ? { onUpdated: options.onPlanUpdated } : {}),
      }),
    );
    tools.push(
      createPlanStepTool({
        sessionId: options.sessionId,
        planPath,
        ...(options.onPlanUpdated ? { onUpdated: options.onPlanUpdated } : {}),
      }),
    );
  }

  // --- Artifact instructions (full contract is lazy, not system-prompt resident) ---
  if (options.config?.artifact.enabled) {
    tools.push(buildArtifactInstructionsTool(options.config.artifact));
  }

  // --- Subagent run tool ---
  if (options.subagentSeam) {
    tools.push(
      createSubagentRunTool({
        sessionId: options.sessionId,
        seam: options.subagentSeam,
      }),
    );
  }

  // --- Image generation tool ---
  if (options.config && options.secretResolver && rootDir) {
    const imageGenTool = buildImageGenTool({
      piwinRoot: rootDir,
      sessionId: options.sessionId,
      config: options.config,
      mediaConfig: {
        mediaRoot: getPiwinMediaDir(rootDir),
        maxPasteBytes: 10 * 1024 * 1024,
        allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
      },
      secretResolver: options.secretResolver,
    });
    if (imageGenTool) {
      tools.push(imageGenTool);
    }
    const videoGenTool = buildVideoGenTool({
      piwinRoot: rootDir,
      sessionId: options.sessionId,
      config: options.config,
      mediaConfig: {
        mediaRoot: getPiwinMediaDir(rootDir),
        maxPasteBytes: 50 * 1024 * 1024,
        allowedMimeTypes: [
          'image/png',
          'image/jpeg',
          'image/webp',
          'video/mp4',
          'video/webm',
          'video/quicktime',
        ],
      },
      secretResolver: options.secretResolver,
    });
    if (videoGenTool) {
      tools.push(videoGenTool);
    }
  }

  const toolboxTargets = tools.filter((tool) => isHostToolboxTargetFamily(tool.family));
  if (toolboxTargets.length > 0) {
    tools.push(buildHostToolboxRegistration(toolboxTargets));
  }

  return tools;
}

/**
 * Extract descriptors from concrete tool registrations. This is the only
 * way to produce `HostToolDescriptor[]` for the blueprint compiler —
 * never generate descriptors from tool names alone.
 */
export function descriptorsFromTools(
  tools: readonly HostToolRegistration[],
): import('@piwin/contracts').HostToolDescriptor[] {
  return tools
    .filter((tool) => !isHostToolboxTargetFamily(tool.family))
    .map((tool) => compactModelToolDescriptor(tool.descriptor));
}

function reportCompositionDiagnostic(
  options: BuildSessionHostToolsOptions,
  capability: string,
  error: unknown,
): void {
  const message = formatError(error);
  const diagnostic = {
    capability,
    message: `${capability} composition failed; capability omitted or degraded: ${message}`,
  };
  options.onDiagnostic?.(diagnostic);
  if (!options.onDiagnostic) {
    console.warn(`[host-runtime] ${diagnostic.message}`);
  }
}
