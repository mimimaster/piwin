/** Context/system-prompt manifest contracts (spec §8.6). */

export type ContextFileKind = 'agents' | 'claude' | 'system' | 'append-system';

export type ContextFileSource = 'pi-native' | 'project';

/** A resolved instruction/system-prompt candidate on disk. */
export type ResolvedContextFile = {
  kind: ContextFileKind;
  source: ContextFileSource;
  absolutePath: string;
};

/**
 * Per-session policy for implicit instruction/system-prompt injection. All
 * context that Pi receives must flow through the compiled {@link ContextManifest};
 * adapters must not rely on Pi's invisible default context discovery (SCR-16).
 */
export type ContextPolicy = {
  /** Load Pi-native global instruction files (`~/.pi/agent/...`). */
  allowPiNativeInstructions: boolean;
  /** Load project `AGENTS.md` / `CLAUDE.md`. */
  allowProjectAgentsFiles: boolean;
  /** Load project `SYSTEM.md` / `APPEND_SYSTEM.md`. */
  allowProjectSystemPrompts: boolean;
};

/** Explicit, compiled context inputs passed to the Pi loader. */
export type ContextManifest = {
  agentsFiles: ResolvedContextFile[];
  systemPrompt?: ResolvedContextFile;
  appendSystemPrompt?: ResolvedContextFile;
};
