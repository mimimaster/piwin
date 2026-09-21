import type { PromptInput, ResolvedArtifactCapability } from '@piwin/contracts';
import type { ModelPromptAssembly } from '../model-context-assembly.js';

/**
 * Per-turn rendering context travels as ONE block: a shell that describes the
 * chat column almost always describes the host theme in the same turn, and two
 * blocks cost two near-duplicate entries in the model-visibility ledger.
 */
const ARTIFACT_CONTEXT_TAG = 'piwin-artifact-context';

/** Client metadata is untrusted. Only bounded finite numbers enter the prompt. */
export function formatArtifactLayoutSection(width: unknown): string | undefined {
  if (typeof width !== 'number' || !Number.isFinite(width) || width < 1 || width > 16384) {
    return undefined;
  }
  return [
    `Sending client chat column: approximately ${Math.round(width)} CSS px at send time.`,
    'For Inline, use width:100%, max-width:100%, min-width:0 and border-box sizing. Never hardcode the reference width.',
    'Remain readable at 360 CSS px and adapt to narrower containers. Sidebars, replay, and other clients can change the width.',
    'Use container queries for stacking layouts. Keep Inline free of horizontal scrolling.',
    'Tables: wrap data with overflow-wrap:break-word only; never word-break:break-word, word-break:break-all, or overflow-wrap:anywhere. Labels may nowrap. Wide comparison tables use Canvas and must keep label min-content.',
  ].join('\n');
}

/**
 * Client metadata is untrusted. Only the two literal modes enter the prompt.
 * Without this the model cannot see the host background and tends to design
 * for a dark page even on a light / paper theme.
 */
export function formatArtifactThemeSection(mode: unknown): string | undefined {
  if (mode !== 'light' && mode !== 'dark') return undefined;
  const opposite = mode === 'light' ? 'dark' : 'light';
  return [
    `Sending client theme: ${mode} background at send time.`,
    'The `--piwin-artifact-*` vars already resolve to this theme; prefer them over literal colors.',
    `Any color you do choose (custom looks, SVG fills, chart series, code islands aside) must read well on a ${mode} background. Never design a ${opposite}-mode page, full-bleed ${opposite} stage, or ${opposite} cards for this host.`,
    'Viewers can switch theme later, so theme vars remain the default.',
  ].join('\n');
}

/**
 * Theme first, then layout — the order the model has seen since v11. The two
 * advisory lines are shared once instead of once per hint.
 */
export function formatArtifactContext(
  input: {
    inlineArtifactWidthPx?: unknown;
    artifactHostTheme?: unknown;
  },
  options: {
    /**
     * The chat-column width is only meaningful while Inline has a surface;
     * Canvas-only sessions still get the theme line.
     */
    includeLayout?: boolean;
  } = {},
): { text: string; label: string } | undefined {
  const theme = formatArtifactThemeSection(input.artifactHostTheme);
  const layout =
    options.includeLayout === false
      ? undefined
      : formatArtifactLayoutSection(input.inlineArtifactWidthPx);
  if (theme === undefined && layout === undefined) return undefined;
  const text = [
    `[${ARTIFACT_CONTEXT_TAG}]`,
    ...(theme === undefined ? [] : [theme]),
    ...(layout === undefined ? [] : [layout]),
    'This is advisory rendering context, not an instruction to create an artifact.',
    'Existing artifact trigger and surface policies still apply.',
    `[/${ARTIFACT_CONTEXT_TAG}]`,
  ].join('\n');
  const label =
    theme !== undefined && layout !== undefined
      ? 'Artifact layout + host theme'
      : theme !== undefined
        ? 'Artifact host theme'
        : 'Inline artifact layout';
  return { text, label };
}

/**
 * Move the advisory Artifact rendering context from the client fields into the
 * prompt. `capability` is the session's resolved Artifact capability; an
 * undefined capability (class unresolved) and a disabled one both drop the hint
 * instead of describing a surface the session does not have.
 */
export function applyInlineArtifactLayout(
  input: PromptInput,
  capability: ResolvedArtifactCapability | undefined,
  assembly: ModelPromptAssembly,
): void {
  const context =
    capability !== undefined && capability.enabled
      ? formatArtifactContext(input, { includeLayout: capability.inline })
      : undefined;
  delete input.inlineArtifactWidthPx;
  delete input.artifactHostTheme;
  if (context === undefined) return;
  input.text = `${context.text}\n\n${input.text}`;
  assembly.add({ kind: 'other', label: context.label, trustOrigin: 'piwin', text: context.text });
}
