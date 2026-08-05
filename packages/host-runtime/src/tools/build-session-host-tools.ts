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

import type { PermissionMode } from '@piwin/contracts';
import type { HostToolDefinition } from '@piwin/tools-web';
import { buildSessionTools, type ToolPermissionGate } from '../session-tools.js';
import { buildProcessTools, type ProcessToolPermissionGate } from '../process-tools.js';
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
import type { McpLifecycleManager } from '@piwin/mcp';
import type { BrowserSession } from '@piwin/browser';
import type { NoteStore, NoteIndex, SearchNotesOptions } from '@piwin/notes';
import type { CardStore } from '@piwin/flashcards';
import type { JobController } from '@piwin/contracts';
import type { PiwinConfig } from '@piwin/contracts';
import { getPiwinSessionPlanPath, getPiwinRoot } from '../paths.js';
import { getPiwinProjectsPath, getPiwinMediaDir } from '../paths.js';

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

  /** Config for tool availability checks (web, notes, flashcards, image-gen). */
  config?: PiwinConfig;

  /** Secret resolver for image generation. */
  secretResolver?: SecretResolver;

  /** Subagent run seam for the delegate tool. */
  subagentSeam?: SubagentRunSeam;

  /** Permission gate shared by all tools that need interactive approval. */
  requestPermission?: ToolPermissionGate;

  /** Static permission mode (from config). */
  permissionMode?: PermissionMode;
  /** Dynamic permission mode getter (from agent-mode override). */
  getPermissionMode?: () => PermissionMode;
};

/**
 * Compose the complete set of parent-owned Host tools for one session.
 * Returns concrete `HostToolDefinition[]` with real executors — not
 * name-only descriptors.
 *
 * Tools that cannot be initialized (missing browser session, missing
 * notes services, etc.) are simply omitted. The blueprint compiler must
 * not advertise a tool that this function did not return.
 */
export async function buildSessionHostTools(
  options: BuildSessionHostToolsOptions,
): Promise<HostToolDefinition[]> {
  const tools: HostToolDefinition[] = [];
  const rootDir = options.piwinRoot ? getPiwinRoot(options.piwinRoot) : undefined;

  // --- Web tools (web_search, web_fetch) ---
  if (options.config?.web) {
    const webRegistration = buildSessionTools({
      webConfig: options.config.web,
      ...(options.requestPermission ? { requestPermission: options.requestPermission } : {}),
      ...(options.projectPath ? { projectPath: options.projectPath } : {}),
      ...(rootDir
        ? { projectsFilePath: getPiwinProjectsPath(rootDir) }
        : {}),
    });
    tools.push(...webRegistration.tools);
  }

  // --- Filesystem + bash tools (read_file, write_file, list_directory, bash, run_bash) ---
  // These are Host-owned executors for the worker manifest. They supplement
  // (not replace) Pi's built-in read/grep/ls with parent-gated write/bash.
  // The SDK path uses gated-bash-tool.ts / gated-file-tools.ts to override
  // Pi built-ins by name; this module provides the worker/RPC equivalents.
  const fsTools = buildHostFilesystemTools({
    cwd: options.projectPath ?? rootDir ?? process.cwd(),
    ...(options.requestPermission ? { requestPermission: options.requestPermission } : {}),
    ...(options.permissionMode ? { permissionMode: options.permissionMode } : {}),
    ...(options.getPermissionMode ? { getPermissionMode: options.getPermissionMode } : {}),
  });
  tools.push(...fsTools);

  // --- Process tools (process_start, process_list, process_logs, process_stop) ---
  if (options.jobController) {
    const processTools = buildProcessTools({
      jobController: options.jobController,
      ...(options.requestPermission
        ? { requestPermission: options.requestPermission as ProcessToolPermissionGate }
        : {}),
      sessionId: options.sessionId,
      ...(options.projectPath ? { projectPath: options.projectPath } : {}),
    });
    tools.push(...processTools);
  }

  // --- Browser tools ---
  const browserSession = options.getBrowserSession?.();
  if (browserSession) {
    const browserTools = createBrowserToolDefinitions(browserSession, {
      ...(options.requestPermission ? { requestPermission: options.requestPermission } : {}),
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
        ...(options.requestPermission ? { requestPermission: options.requestPermission } : {}),
      });
      tools.push(...notesTools);
    } catch {
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
        ...(options.requestPermission ? { requestPermission: options.requestPermission } : {}),
      });
      tools.push(...flashcardTools);
    } catch {
      // Flashcard store unavailable — omit flashcard tools.
    }
  }

  // --- MCP gateway tool ---
  if (options.mcpManager && rootDir) {
    const mcpTool = buildMcpGatewayToolDefinition({
      piwinRoot: rootDir,
      lifecycleManager: options.mcpManager,
      ...(options.requestPermission ? { requestPermission: options.requestPermission } : {}),
    });
    tools.push(mcpTool);
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
      ...(options.requestPermission ? { requestPermission: options.requestPermission } : {}),
    });
    if (imageGenTool) {
      tools.push(imageGenTool);
    }
  }

  return tools;
}

/**
 * Extract descriptors from concrete tool definitions. This is the only
 * way to produce `HostToolDescriptor[]` for the blueprint compiler —
 * never generate descriptors from tool names alone.
 */
export function descriptorsFromTools(
  tools: readonly HostToolDefinition[],
): import('@piwin/contracts').HostToolDescriptor[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));
}
