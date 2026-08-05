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

import type { HostToolRegistration, McpConfigDocument } from '@piwin/contracts';
import { buildSessionTools } from '../session-tools.js';
import { buildProcessTools } from '../process-tools.js';
import { createBrowserToolDefinitions } from '../browser-tools.js';
import { buildNotesTools } from '../notes-tools.js';
import { buildFlashcardTools } from '../flashcard-tools.js';
import { buildMcpGatewayToolDefinition } from '../mcp-gateway-tool.js';
import { createPlanCreateTool } from '../plan-create-tool.js';
import { createPlanStepTool } from '../plan-step-tool.js';
import { createSubagentRunTool, type SubagentRunSeam } from '../subagent-run-tool.js';
import { buildImageGenTool, type ImageGenToolOptions } from '../image-gen-tool.js';
import { buildHostFilesystemTools } from './host-filesystem-tools.js';
import type { SecretResolver } from '../secret-resolver.js';
import {
  createMcpGenerationSnapshot,
  listEnabledServers,
  loadMcpConfig,
  type McpGenerationSnapshot,
  type McpLifecycleManager,
} from '@piwin/mcp';
import { resolveWebConfig } from '@piwin/tools-web';
import type { BrowserSession } from '@piwin/browser';
import type { NoteStore, NoteIndex, SearchNotesOptions } from '@piwin/notes';
import type { CardStore } from '@piwin/flashcards';
import type { JobController } from '@piwin/contracts';
import type { PiwinConfig } from '@piwin/contracts';
import { getPiwinSessionPlanPath, getPiwinRoot } from '../paths.js';
import { getPiwinMediaDir } from '../paths.js';
import { buildCachedMcpToolDefinitions } from '../mcp-cached-tool-definitions.js';

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
  mcpEnabledServerIds?: readonly string[];

  /** Config for tool availability checks (web, notes, flashcards, image-gen). */
  config?: PiwinConfig;

  /** Secret resolver for image generation. */
  secretResolver?: SecretResolver;

  /** Subagent run seam for the delegate tool. */
  subagentSeam?: SubagentRunSeam;

  /** Observe optional capability failures while composing a generation. */
  onDiagnostic?: (diagnostic: HostToolCompositionDiagnostic) => void;
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
  const mcpEnabledServerIds =
    options.mcpEnabledServerIds ?? listEnabledServers(mcpConfig).map((server) => server.id);

  // --- Web tools (web_search, web_fetch) ---
  if (options.config?.web) {
    const webRegistration = buildSessionTools({
      webConfig: options.config.web,
    });
    const webSearchReady = resolveWebConfig(options.config.web).searchSources.some(
      (source) => source.enabled,
    );
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

  // --- MCP gateway tool ---
  if (options.mcpManager && mcpEnabledServerIds.length > 0) {
    const mcpTool = buildMcpGatewayToolDefinition({
      lifecycleManager: options.mcpManager,
      mcpConfig,
      mcpSnapshot,
    });
    tools.push(mcpTool);
    try {
      const cachedMcpTools = await buildCachedMcpToolDefinitions({
        lifecycleManager: options.mcpManager,
        mcpConfig,
        mcpSnapshot,
      });
      tools.push(...cachedMcpTools.tools);
    } catch (error) {
      reportCompositionDiagnostic(options, 'mcp-cached-tools', error);
      // Cached direct exposure is optional; the gateway remains available.
    }
  }

  // --- Planning tools ---
  if (rootDir && options.projectPath) {
    const planPath = getPiwinSessionPlanPath(rootDir, options.sessionId);
    tools.push(
      createPlanCreateTool({
        sessionId: options.sessionId,
        projectPath: options.projectPath,
        planPath,
        onUpdated: (plan) => {
          // Plan updates are pushed via the host push channel; the caller
          // (HostRuntime) wires this through the session live context.
        },
      }),
    );
    tools.push(
      createPlanStepTool({
        sessionId: options.sessionId,
        planPath,
        onUpdated: (plan) => {
          // Same as above — HostRuntime handles push wiring.
        },
      }),
    );
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
  return tools.map((tool) => ({
    name: tool.descriptor.name,
    description: tool.descriptor.description,
    parameters: tool.descriptor.parameters,
  }));
}

function reportCompositionDiagnostic(
  options: BuildSessionHostToolsOptions,
  capability: string,
  error: unknown,
): void {
  const message = error instanceof Error ? error.message : String(error);
  const diagnostic = {
    capability,
    message: `${capability} composition failed; capability omitted or degraded: ${message}`,
  };
  options.onDiagnostic?.(diagnostic);
  if (!options.onDiagnostic) {
    console.warn(`[host-runtime] ${diagnostic.message}`);
  }
}
