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
    'Use container queries for stacking layouts; allow table data to wrap, avoid nowrap on data cells, and keep Inline free of horizontal scrolling.',
    'Use Canvas for dense comparisons that require a wide table. Existing artifact trigger and surface policies still apply.',
    '[/piwin-inline-artifact-layout]',
  ].join('\n');
}

export function applyInlineArtifactLayout(
  input: PromptInput,
  enabled: boolean,
  assembly: ModelPromptAssembly,
): void {
  const layout = enabled ? formatInlineArtifactLayout(input.inlineArtifactWidthPx) : undefined;
  delete input.inlineArtifactWidthPx;
  if (!layout) return;
  input.text = `${layout}\n\n${input.text}`;
  assembly.add({ kind: 'other', label: 'Inline artifact layout', trustOrigin: 'piwin', text: layout });
}
