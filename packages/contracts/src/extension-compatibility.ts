/**
 * Compatibility classification and degradation contracts for Pi Extensions.
 *
 * In piwin, extensions are not judged by a naive binary blacklist. Many
 * real-world community packages (e.g. `pi-web-access`, `pi-mcp-adapter`)
 * export essential Agent tools or hooks while also attaching auxiliary
 * TUI widgets, shortcuts, or themes.
 *
 * Instead of discarding packages that touch unsupported surface, piwin
 * uses a 4-tier grading system combined with granular degradation tags:
 *
 * 1. `compatible`: Clean agent tools/hooks with zero unsupported surface.
 * 2. `degraded`: Usable core capabilities, but auxiliary presentation
 *    features (shortcuts, custom renderers, TUI widgets) are no-oped or fallback.
 * 3. `incompatible`: Package has no agent capabilities (e.g. pure theme),
 *    or primary execution strictly blocks on unsupported TUI features.
 * 4. `unverified`: Package has not been indexed or static scan confidence is low
 *    (e.g. minified bundles, unresolved dynamic imports).
 */

/**
 * 4-tier compatibility classification.
 */
export type ExtensionCompatibilityTier =
  | 'compatible'
  | 'degraded'
  | 'incompatible'
  | 'unverified';

/**
 * Granular tags for non-essential features that degrade in piwin's desktop/worker runtime.
 */
export type ExtensionDegradationTag =
  /**
   * Package declares theme definitions or calls `setTheme` / `registerTheme`.
   * In desktop, custom Pi TUI themes are ignored.
   */
  | 'theme'
  /**
   * Package registers keyboard shortcuts (`registerShortcut`, `registerKeybinding`).
   * In desktop, terminal hotkeys do not register, but underlying tools remain callable.
   */
  | 'shortcut'
  /**
   * Package provides custom TUI message/tool rendering (`renderCall`, `renderResult`, `registerMessageRenderer`).
   * In desktop, outputs fall back to standard Markdown / JSON card rendering.
   */
  | 'custom-renderer'
  /**
   * Package attempts to set TUI header, footer, or status bars (`setWidget`, `setFooter`, `setHeader`, `setStatus`).
   * In desktop, these calls are safe no-ops and do not affect tool logic.
   */
  | 'tui-widget'
  /**
   * Package hooks into terminal editor or input (`setEditorComponent`, `addAutocompleteProvider`, `onTerminalInput`).
   * In desktop, terminal editor integrations are no-oped.
   */
  | 'editor'
  /**
   * Package registers slash commands (`registerCommand`).
   * In desktop, commands are callable if invoked, but are not yet listed in the composer `/` menu.
   */
  | 'slash-command-unlisted'
  /**
   * Package calls `ctx.reload()` or `.reload()`.
   * In piwin, native in-process reload is unsupported; hot activation goes through
   * `SessionRuntimeReplacementEngine` instead.
   */
  | 'native-reload'
  /**
   * Package calls `ctx.ui.custom(...)` as an auxiliary or optional UI component.
   * If `ctx.ui.custom` is in the primary execution flow and cannot be skipped,
   * the tier becomes 'incompatible' with reason 'fatal-custom-tui'.
   */
  | 'tui-custom-ui';

/**
 * How piwin behaves when an extension hits a degraded feature.
 */
export type ExtensionDegradationBehavior =
  | 'no-op'
  | 'fallback-default'
  | 'ignored'
  | 'unlisted-menu'
  | 'managed-reload';

/**
 * Structured details for one degradation detected in an extension.
 */
export type ExtensionDegradationItem = {
  /** The standard degradation tag. */
  tag: ExtensionDegradationTag;
  /** Short label suitable for badges (e.g. "快捷键失效", "渲染降级"). */
  labelZh: string;
  labelEn: string;
  /** Detailed explanation for the user on what degrades and what still works. */
  descriptionZh: string;
  descriptionEn: string;
  /** Concrete runtime behavior piwin applies to keep the agent stable. */
  behavior: ExtensionDegradationBehavior;
  /** Statically detected method names or AST symbols (e.g. `['ctx.ui.setHeader']`). */
  matchedSymbols?: string[];
};

/**
 * Primary root cause when an extension is classified as `incompatible`.
 */
export type ExtensionIncompatibilityReason =
  /** Package defines no tools, hooks, providers, or dialogs (e.g. pure theme or CLI app). */
  | 'no-agent-capabilities'
  /** Core tool execution unconditionally blocks on `ctx.ui.custom()` or interactive TUI modal. */
  | 'fatal-custom-tui'
  /** Extension requires raw terminal TTY mode (`process.stdin.setRawMode`) or curses/blessed layout. */
  | 'requires-terminal-tty'
  /** Package is a standalone CLI binary or server, not an agent runtime extension module. */
  | 'cli-distribution-only'
  /** Package manifest is corrupted, entry file missing, or syntax parse failed. */
  | 'parse-error';

/**
 * Standard interactive dialog methods supported across Desktop prompt and CLI TTY.
 */
export type ExtensionSupportedDialog = 'confirm' | 'select' | 'input' | 'notify';

/**
 * Fingerprint of usable Agent capabilities exposed by an extension.
 */
export type ExtensionCapabilities = {
  /** Statically detected tools registered via `pi.registerTool(...)`. */
  tools: string[];
  /** Lifecycle and event hooks registered via `pi.on(...)`. */
  hooks: string[];
  /** Model / auth providers registered via `pi.registerProvider(...)`. */
  providers?: string[];
  /** Interactive dialogs used via `ctx.ui.*` that piwin bridges. */
  dialogs?: ExtensionSupportedDialog[];
  /** Extension slash commands registered via `pi.registerCommand(...)`. */
  commands?: string[];
};

/**
 * Confidence and scope metadata for compatibility analysis.
 */
export type ExtensionScanMetadata = {
  /**
   * Confidence level of the static assessment.
   * - `high`: AST traversal on unminified TypeScript/ESM source files.
   * - `medium`: Heuristic scan on unbundled code (potential false positives/negatives).
   * - `low`: Minified/single-line bundle or dynamic property access (`ui[method]`).
   */
  confidence: 'high' | 'medium' | 'low';
  /** True if the analysed file appears to be a bundled/minified dist file. */
  isMinifiedBundle: boolean;
  /** Depth of the analysis. */
  scanScope: 'manifest-only' | 'entry-only' | 'import-graph' | 'full-package';
  /** Version of the static scanner that generated this assessment. */
  scannerVersion: string;
  /** ISO-8601 timestamp when analysis was conducted. */
  scannedAt: string;
  /** Warnings or diagnostic messages collected during analysis. */
  diagnostics?: string[];
};

/**
 * Full compatibility assessment document for an extension.
 */
export type ExtensionCompatibility = {
  /** Overall compatibility tier. */
  tier: ExtensionCompatibilityTier;
  /** Core capabilities that piwin's Agent Runtime can execute. */
  /** Populated when the static scanner can identify Agent capabilities. */
  capabilities?: ExtensionCapabilities;
  /** Active degradation notices when features fall back or are no-oped. */
  degradations?: ExtensionDegradationItem[];
  /** Fatal blocker reason if tier is 'incompatible'. */
  incompatibilityReason?: ExtensionIncompatibilityReason;
  /** Analysis provenance and confidence. */
  scan?: ExtensionScanMetadata;
};

/**
 * Check whether an extension is eligible for execution in piwin.
 * Both 'compatible' and 'degraded' are eligible; 'incompatible' and 'unverified' require user action/review.
 */
export function isExtensionEligibleForRuntime(compat: ExtensionCompatibility): boolean {
  if (compat.tier === 'incompatible' || compat.tier === 'unverified') {
    return false;
  }
  if (compat.tier === 'compatible') {
    return true;
  }
  if (compat.capabilities === undefined) {
    return true;
  }
  return (
    compat.capabilities.tools.length > 0 ||
    compat.capabilities.hooks.length > 0 ||
    (compat.capabilities.providers?.length ?? 0) > 0 ||
    (compat.capabilities.commands?.length ?? 0) > 0
  );
}

/** Compatible and safely degraded Agent extensions may enter a Blueprint. */
export function isExtensionBlueprintEligible(
  compatibility: ExtensionCompatibility | undefined,
): boolean {
  return compatibility !== undefined && isExtensionEligibleForRuntime(compatibility);
}
