/**
 * Lazy Streamdown math plugin. `@streamdown/math` pulls KaTeX into its graph,
 * so it must not be a static cold-start import of MarkdownView.
 */
import type { createMathPlugin as CreateMathPlugin } from '@streamdown/math';

export type StreamdownMathPlugin = ReturnType<typeof CreateMathPlugin>;

let mathPlugin: StreamdownMathPlugin | null = null;
let mathPluginLoad: Promise<StreamdownMathPlugin> | null = null;

export function getStreamdownMathPlugin(): StreamdownMathPlugin | null {
  return mathPlugin;
}

export function loadStreamdownMathPlugin(): Promise<StreamdownMathPlugin> {
  if (mathPlugin) {
    return Promise.resolve(mathPlugin);
  }
  if (!mathPluginLoad) {
    mathPluginLoad = Promise.all([
      import('@streamdown/math'),
      import('katex/dist/katex.min.css'),
    ]).then(([module]) => {
      mathPlugin = module.createMathPlugin({ singleDollarTextMath: false });
      return mathPlugin;
    });
  }
  return mathPluginLoad;
}
