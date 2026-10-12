import { ARTIFACT_KIT_VERSION, type PromptInput, type ResolvedArtifactCapability } from '@piwin/contracts';
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
    `This includes style="expressive": its stage, hero and cards stay on the ${mode} side (a ${mode} base; saturated color for accents, not for the whole fill). A ${opposite} stage is flagged as off-theme.`,
    'Viewers can switch theme later, so theme vars remain the default. This is advisory context, not an instruction to create an artifact.',
    '[/piwin-artifact-host-theme]',
  ].join('\n');
}

/**
 * A shell that measures the chat column but does not advertise
 * `artifactKit` renders the pre-v14 contract: its sandbox has no extended
 * tokens, no `style` handling and no built-in kit. The resident prompt is
 * compiled once per runtime generation and every shell shares it, so this
 * downgrade rides on the turn instead.
 */
export function formatLegacyArtifactClient(artifactKit: unknown): string | undefined {
  if (typeof artifactKit === 'number' && Number.isFinite(artifactKit) && artifactKit >= ARTIFACT_KIT_VERSION) {
    return undefined;
  }
  return [
    '[piwin-artifact-legacy-client]',
    'The sending client renders an older artifact runtime. For this turn:',
    'use only `--piwin-artifact-` `bg surface text muted accent on-accent border`; omit the fence `style` attribute;',
    'no `data-piwin-chart` / `data-piwin-icon`; draw charts as inline SVG; flat tone, no gradients or shadows.',
    '[/piwin-artifact-legacy-client]',
  ].join('\n');
}

/**
 * Prefix the two advisory blocks the model saw before they were merged into
 * `[piwin-artifact-context]`. Capability still gates injection: no surface →
 * no hint; Canvas-only sessions skip the chat-column width.
 */
export function applyInlineArtifactLayout(
  input: PromptInput,
  capability: ResolvedArtifactCapability | undefined,
  assembly: ModelPromptAssembly,
): void {
  if (capability === undefined || !capability.enabled) {
    delete input.inlineArtifactWidthPx;
    delete input.artifactHostTheme;
    delete input.artifactKit;
    return;
  }
  const artifactKit = input.artifactKit;
  delete input.artifactKit;
  const layout = capability.inline
    ? formatInlineArtifactLayout(input.inlineArtifactWidthPx)
    : undefined;
  const theme = formatArtifactHostTheme(input.artifactHostTheme);
  delete input.inlineArtifactWidthPx;
  delete input.artifactHostTheme;
  // The note only rides along with a real rendering hint, i.e. a shell that
  // actually draws artifacts for this turn.
  const legacy = layout || theme ? formatLegacyArtifactClient(artifactKit) : undefined;
  if (layout) {
    input.text = `${layout}\n\n${input.text}`;
    assembly.add({ kind: 'other', label: 'Inline artifact layout', trustOrigin: 'piwin', text: layout });
  }
  if (theme) {
    input.text = `${theme}\n\n${input.text}`;
    assembly.add({ kind: 'other', label: 'Artifact host theme', trustOrigin: 'piwin', text: theme });
  }
  if (legacy) {
    input.text = `${legacy}\n\n${input.text}`;
    assembly.add({ kind: 'other', label: 'Legacy artifact client', trustOrigin: 'piwin', text: legacy });
  }
}
