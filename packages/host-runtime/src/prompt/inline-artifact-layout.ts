import type { PromptInput } from '@piwin/contracts';
import type { ModelPromptAssembly } from '../model-context-assembly.js';

/** Client metadata is untrusted. Only bounded finite numbers enter the prompt. */
export function formatInlineArtifactLayout(width: unknown): string | undefined {
  if (typeof width !== 'number' || !Number.isFinite(width) || width < 1 || width > 16384) {
    return undefined;
  }
  return [
    '[piwin-inline-artifact-layout]',
    `Sending client chat column: approximately ${Math.round(width)} CSS px at send time.`,
    'This is advisory layout context, not a fixed width or an instruction to create an artifact.',
    'For Inline, use width:100%, max-width:100%, min-width:0 and border-box sizing. Never hardcode the reference width.',
    'Remain readable at 360 CSS px and adapt to narrower containers. Sidebars, replay, and other clients can change the width.',
    'Use container queries for stacking layouts. Keep Inline free of horizontal scrolling.',
    'Tables: wrap data with overflow-wrap:break-word only; never word-break:break-word, word-break:break-all, or overflow-wrap:anywhere. Labels may nowrap. Wide comparison tables use Canvas and must keep label min-content.',
    'Existing artifact trigger and surface policies still apply.',
    '[/piwin-inline-artifact-layout]',
  ].join('\n');
}

/**
 * Client metadata is untrusted. Only the two literal modes enter the prompt.
 * Without this the model cannot see the host background and tends to design
 * for a dark page even on a light / paper theme.
 */
export function formatArtifactHostTheme(mode: unknown): string | undefined {
  if (mode !== 'light' && mode !== 'dark') return undefined;
  const opposite = mode === 'light' ? 'dark' : 'light';
  return [
    '[piwin-artifact-host-theme]',
    `Sending client theme: ${mode} background at send time.`,
    'The `--piwin-artifact-*` vars already resolve to this theme; prefer them over literal colors.',
    `Any color you do choose (custom looks, SVG fills, chart series, code islands aside) must read well on a ${mode} background. Never design a ${opposite}-mode page, full-bleed ${opposite} stage, or ${opposite} cards for this host.`,
    'Viewers can switch theme later, so theme vars remain the default. This is advisory context, not an instruction to create an artifact.',
    '[/piwin-artifact-host-theme]',
  ].join('\n');
}

export function applyInlineArtifactLayout(
  input: PromptInput,
  enabled: boolean,
  assembly: ModelPromptAssembly,
): void {
  const layout = enabled ? formatInlineArtifactLayout(input.inlineArtifactWidthPx) : undefined;
  const theme = enabled ? formatArtifactHostTheme(input.artifactHostTheme) : undefined;
  delete input.inlineArtifactWidthPx;
  delete input.artifactHostTheme;
  if (layout) {
    input.text = `${layout}\n\n${input.text}`;
    assembly.add({ kind: 'other', label: 'Inline artifact layout', trustOrigin: 'piwin', text: layout });
  }
  if (theme) {
    input.text = `${theme}\n\n${input.text}`;
    assembly.add({ kind: 'other', label: 'Artifact host theme', trustOrigin: 'piwin', text: theme });
  }
}
