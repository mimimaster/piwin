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
import { persistAndInspectBrowserScreenshot } from '../browser-screenshot-inspect.js';
import { createFastDecider } from '../browser-fast-decider.js';
import { primaryModelSupportsImage } from '../vision-delegation.js';
import { buildNotesTools } from '../notes-tools.js';
import { buildKnowledgeTools } from '../knowledge-tools.js';
import type { FolderRag } from '@piwin/doc-rag';
import { createDefaultPiwinConfig } from '../config-store.js';
import { buildFlashcardTools } from '../flashcard-tools.js';
import { buildExtensionTools, type ExtensionApplyOutcome } from '../extension-tools.js';
import { createPlanCreateTool } from '../plan-create-tool.js';
import { createPlanPresentTool } from '../plan-present-tool.js';
import { createPlanStepTool } from '../plan-step-tool.js';
import { createSubagentRunTool, type SubagentRunSeam } from '../subagent-run-tool.js';
import { createSubagentStartTool } from '../subagent-start-tool.js';
import { createSubagentContinueTool } from '../subagent-continue-tool.js';
import { createSubagentResultApplyTool } from '../subagent-result-apply-tool.js';
import { createSubagentVerificationSubmitTool } from '../subagent-verification-submit-tool.js';
import { createSubagentWaitTool } from '../subagent-wait-tool.js';
import { createSubagentCancelTool } from '../subagent-cancel-tool.js';
import {
  createSubagentResultReadTool,
  type SubagentResultReadService,
} from '../subagent-result-read-tool.js';
import { createSubagentReviewSubmitTool } from '../subagent-review-submit-tool.js';
import type { SubagentReviewService } from '../subagent-review-service.js';
import type { SubagentReviewCapabilityScope } from '../subagent-review-context.js';
import { buildImageGenTool } from '../image-gen-tool.js';
import { buildVideoGenTool } from '../video-gen-tool.js';
import { buildArtifactInstructionsTool } from '../artifact-instructions-tool.js';
import {
  buildHostFilesystemTools,
  type BuildHostFilesystemToolsOptions,
} from './host-filesystem-tools.js';
import type { SecretResolver } from '../secret-resolver.js';
import {
  createMcpGenerationSnapshot,
  loadMcpConfig,
  type McpGenerationSnapshot,
  type McpLifecycleManager,
} from '@piwin/mcp';
import { resolveWebConfig, type FetchCache } from '@piwin/tools-web';
import {
  findConfiguredModel,
  resolveNativeSearchAdapterSupport,
  resolveSearchRoute,
  shouldExposeExternalWebSearch,
} from '../capabilities/search-route-resolver.js';
import type { BrowserSession } from '@piwin/browser';
import type { NoteStore } from '@piwin/notes';
import type { CardStore } from '@piwin/flashcards';
import type { JobController } from '@piwin/contracts';
import type { ModelRef, PiwinConfig } from '@piwin/contracts';
import { getPiwinSessionDir, getPiwinSessionPlanPath, getPiwinRoot } from '../paths.js';
import { getPiwinMediaDir } from '../paths.js';
import { buildCachedMcpToolDefinitions } from '../mcp-cached-tool-definitions.js';
import { buildMcpCapabilityBrief, type McpCapabilityBrief } from '../mcp-capability-brief.js';
import { compactModelToolDescriptor } from '../model-tool-descriptor.js';
import { isHostToolboxTargetFamily } from '../host-toolbox.js';
import { buildHostToolboxRegistration } from '../tool-catalog/catalog-tool.js';
import { createToolCatalogService } from '../tool-catalog/catalog-service.js';
import { buildWebSearchModelDelegate } from '../model-web-search-delegate.js';
import { buildWebFetchExtractDelegate } from '../model-web-fetch-extract-delegate.js';
import { buildWebPageRenderer } from '../model-web-page-renderer.js';
import { buildWebDocumentExtractor } from '../model-web-document-extractor.js';
import { createSessionFetchSpillStore } from '../fetch-spill-store.js';
import { getWebSearchLogStore } from '../web-search-log-store.js';

/**
 * Lazy provider for notes services. The Host owns the lifecycle; this
 * callback lets the tool builder defer initialization until the first
 * tool call.
 */
export type NotesServicesProvider = () => Promise<{
  store: NoteStore;
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
  getFolderRag?: () => Promise<FolderRag>;
  isIndexing?: (folderKey: string) => boolean;

  /** MCP lifecycle manager for catalog search/describe/call/status. */
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

  /** Host-only reviewer scope. Never accepted from model input. */
  reviewScope?: SubagentReviewCapabilityScope;
  resultService?: SubagentResultReadService;
  reviewService?: SubagentReviewService;
  reviewerInvocationId?: string;

  /** Publish mutations made by model-facing plan tools. */
  onPlanUpdated?: (plan: SessionPlan) => void;

  /** Host-scoped extracted-page cache shared across session generations. */
  fetchCache?: FetchCache;

  /** Observe optional capability failures while composing a generation. */
  onDiagnostic?: (diagnostic: { capability: string; message: string }) => void;
  /** Preserve the exact MCP capability brief on the frozen generation surface. */
  onMcpCapabilityBrief?: (brief: McpCapabilityBrief) => void;

  turnChange?: BuildHostFilesystemToolsOptions['turnChange'];
  workspaceWrite?: BuildHostFilesystemToolsOptions['workspaceWrite'];

  /**
   * Schedule `extensions/apply` for this session after `extension_install`
   * stages + enables a revision. Absent → the extension tools are omitted.
   */
  applyExtensions?: (when: 'after-current-run') => Promise<ExtensionApplyOutcome>;
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
    const webFetchExtractDelegate = options.secretResolver
      ? buildWebFetchExtractDelegate(options.config, options.secretResolver)
      : undefined;
    const webRegistration = buildSessionTools({
      webConfig: options.config.web,
      ...(webSearchDelegate ? { webSearchDelegate } : {}),
      ...(webFetchExtractDelegate ? { webFetchExtractDelegate } : {}),
      ...(options.config.web.fetchFallback === 'browser'
        ? { pageRenderer: buildWebPageRenderer() }
        : {}),
      documentExtractor: buildWebDocumentExtractor(),
      spillStore: createSessionFetchSpillStore(getPiwinSessionDir(rootDir, options.sessionId)),
      searchLog: getWebSearchLogStore(rootDir),
      ...(options.fetchCache ? { fetchCache: options.fetchCache } : {}),
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
  const fsCwd = options.projectPath ?? rootDir ?? process.cwd();
  const fsTools = buildHostFilesystemTools({
    cwd: fsCwd,
    ...(options.turnChange ? { turnChange: options.turnChange } : {}),
    ...(options.workspaceWrite ? { workspaceWrite: options.workspaceWrite } : {}),
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
    const mediaRoot = getPiwinMediaDir(rootDir);
    const primarySupportsImage = options.config
      ? primaryModelSupportsImage(findConfiguredModel(options.config, options.model)?.model.input)
      : false;
    const fastDeciderConfig = options.config?.browser?.fastDecider;
    const browserTools = createBrowserToolDefinitions(browserSession, {
      projectRoot: options.projectPath ?? rootDir ?? process.cwd(),
      ...(fastDeciderConfig ? { fastDecider: createFastDecider(fastDeciderConfig) } : {}),
      inspectScreenshot: async ({ jpegBytes, width, height, signal }) =>
        persistAndInspectBrowserScreenshot({
          jpegBytes,
          width,
          height,
          sessionId: options.sessionId,
          mediaRoot,
          primarySupportsImage,
          signal,
          ...(options.config ? { config: options.config } : {}),
          ...(options.secretResolver ? { secretResolver: options.secretResolver } : {}),
        }),
    });
    tools.push(...browserTools);
  }

  // --- Knowledge tools (replace note_search / note_list / note_read) ---
  const registerKnowledgeTools = Boolean(options.getFolderRag);
  if (registerKnowledgeTools && options.getFolderRag) {
    tools.push(
      ...buildKnowledgeTools({
        sessionId: options.sessionId,
        ...(options.piwinRoot !== undefined ? { piwinRoot: options.piwinRoot } : { piwinRoot: rootDir }),
        getFolderRag: options.getFolderRag,
        ...(options.getNotesServices ? { getNotesServices: options.getNotesServices } : {}),
        loadConfig: async () => options.config ?? createDefaultPiwinConfig(),
        ...(options.isIndexing ? { isIndexing: options.isIndexing } : {}),
        ...(options.getCardStore ? { getCardStore: options.getCardStore } : {}),
      }),
    );
  }

  // --- Notes tools ---
  if (options.getNotesServices && options.config?.notes?.enabled !== false) {
    try {
      const notesServices = await options.getNotesServices();
      if (options.getFolderRag) {
        const rag = await options.getFolderRag();
        const notesTools = buildNotesTools({
          store: notesServices.store,
          rag,
          enabled: true,
          ...(options.piwinRoot !== undefined
            ? { piwinRoot: options.piwinRoot }
            : { piwinRoot: rootDir }),
          ...(registerKnowledgeTools ? { includeReadTools: false } : {}),
        });
        tools.push(...notesTools);
      }
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

  // --- Pi Extension install/list tools (root sessions only) ---
  if (options.applyExtensions && options.config?.extensions?.agentInstall !== false) {
    const extensionTools = buildExtensionTools({
      enabled: true,
      piwinRoot: rootDir ?? options.piwinRoot ?? process.cwd(),
      sessionId: options.sessionId,
      ...(options.config?.extensions ? { extensionsConfig: options.config.extensions } : {}),
      applyExtensions: options.applyExtensions,
    });
    tools.push(...extensionTools);
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
      // Cache failure degrades to config-only MCP guidance; the catalog remains
      // available through piwin_toolbox and can still describe/call known selectors.
    }
  }

  const mcpCapabilityBrief = buildMcpCapabilityBrief({
    config: mcpConfig,
    cachedToolsByServer,
    directExposedNames: directMcpTools.map((tool) => tool.descriptor.name),
  });
  options.onMcpCapabilityBrief?.(mcpCapabilityBrief);

  if (options.mcpManager) {
    tools.push(...directMcpTools);
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
    tools.push(createPlanPresentTool({ sessionId: options.sessionId, planPath }));
    tools.push(
      createPlanStepTool({
        sessionId: options.sessionId,
        planPath,
        ...(options.onPlanUpdated ? { onUpdated: options.onPlanUpdated } : {}),
      }),
    );
  }

  // --- Artifact instructions (same contract as the resident system prompt) ---
  if (options.config?.artifact.enabled) {
    tools.push(buildArtifactInstructionsTool(options.config.artifact));
  }

  // --- Subagent run / start / wait / cancel ---
  if (options.subagentSeam) {
    const seam = options.subagentSeam;
    tools.push(
      createSubagentRunTool({
        sessionId: options.sessionId,
        seam,
      }),
      createSubagentStartTool({
        sessionId: options.sessionId,
        seam,
      }),
      createSubagentContinueTool({
        sessionId: options.sessionId,
        seam,
      }),
      createSubagentResultApplyTool({
        sessionId: options.sessionId,
        seam,
        ...(options.projectPath ? { workspacePath: options.projectPath } : {}),
      }),
      createSubagentVerificationSubmitTool({
        sessionId: options.sessionId,
        seam,
      }),
      createSubagentWaitTool({
        sessionId: options.sessionId,
        seam,
      }),
      createSubagentCancelTool({
        sessionId: options.sessionId,
        seam,
      }),
    );
  }

  if (options.reviewScope && options.resultService) {
    tools.push(
      createSubagentResultReadTool({
        scope: options.reviewScope,
        resultService: options.resultService,
      }),
    );
    if (options.reviewService) {
      tools.push(
        createSubagentReviewSubmitTool({
          scope: options.reviewScope,
          reviewerSessionId: options.sessionId,
          service: options.reviewService,
          ...(options.reviewerInvocationId
            ? { invocationId: options.reviewerInvocationId }
            : {}),
        }),
      );
    }
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
  const catalog = options.mcpManager
    ? createToolCatalogService({
        lifecycleManager: options.mcpManager,
        mcpConfig,
        mcpSnapshot,
      })
    : undefined;
  if (toolboxTargets.length > 0 || catalog) {
    tools.push(
      buildHostToolboxRegistration(toolboxTargets, {
        ...(catalog ? { catalog } : {}),
        mcpBrief: mcpCapabilityBrief,
      }),
    );
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
