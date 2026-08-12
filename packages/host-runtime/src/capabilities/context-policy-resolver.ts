/** Pure resolver: ContextPolicy + discovered candidates → ContextManifest (spec §8.6). */

import type {
  ContextFileKind,
  ContextFileSource,
  ContextManifest,
  ContextPolicy,
  ResolvedContextFile,
} from '@piwin/contracts';

export type ContextCandidatesInput = {
  /** Discovered project instruction candidates (`AGENTS.md`, `CLAUDE.md`). */
  projectAgentsFiles: ResolvedContextFile[];
  /** Discovered project system-prompt candidates (`SYSTEM.md`, `APPEND_SYSTEM.md`). */
  projectSystemPrompts: ResolvedContextFile[];
  /** Discovered Pi-native global instruction candidates (`~/.pi/agent/...`). */
  piNativeFiles: ResolvedContextFile[];
};

/**
 * Compile the explicit context manifest. The adapter must pass exactly these
 * files to Pi and must not rely on Pi's implicit default context discovery
 * outside the manifest (SCR-16).
 */
export function resolveContextManifest(
  policy: ContextPolicy,
  candidates: ContextCandidatesInput,
): ContextManifest {
  const agentsFiles: ResolvedContextFile[] = [];
  if (policy.allowPiNativeInstructions) {
    agentsFiles.push(
      ...candidates.piNativeFiles.filter(
        (file) => file.kind === 'agents' || file.kind === 'claude',
      ),
    );
  }
  if (policy.allowProjectAgentsFiles) {
    agentsFiles.push(...candidates.projectAgentsFiles);
  }

  const projectSystemPrompts = policy.allowProjectSystemPrompts
    ? candidates.projectSystemPrompts
    : [];
  const piNativeSystemPrompts = policy.allowPiNativeInstructions
    ? candidates.piNativeFiles.filter(
        (file) => file.kind === 'system' || file.kind === 'append-system',
      )
    : [];

  // Match Pi precedence: a trusted project system prompt wins; otherwise the
  // explicit Pi-native global prompt is the fallback.
  const systemPrompt =
    projectSystemPrompts.find((file) => file.kind === 'system') ??
    piNativeSystemPrompts.find((file) => file.kind === 'system');
  const appendSystemPrompt =
    projectSystemPrompts.find((file) => file.kind === 'append-system') ??
    piNativeSystemPrompts.find((file) => file.kind === 'append-system');

  const manifest: ContextManifest = { agentsFiles };
  if (systemPrompt) {
    manifest.systemPrompt = systemPrompt;
  }
  if (appendSystemPrompt) {
    manifest.appendSystemPrompt = appendSystemPrompt;
  }
  return manifest;
}

/** Helper for tests/UI to classify a discovered path by filename. */
export function classifyContextFile(path: string): ContextFileKind | null {
  const name = path.split(/[\\/]/).pop()?.toLowerCase() ?? '';
  if (name === 'agents.md') return 'agents';
  if (name === 'claude.md') return 'claude';
  if (name === 'system.md') return 'system';
  if (name === 'append_system.md') return 'append-system';
  return null;
}

export function contextFileSource(absolutePath: string, projectRoot: string): ContextFileSource {
  return absolutePath.startsWith(projectRoot) ? 'project' : 'pi-native';
}
