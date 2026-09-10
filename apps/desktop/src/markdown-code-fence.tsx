import type { ReactElement } from 'react';
import type { ArtifactActionMessage, ArtifactThemeVariables } from '@piwin/artifact';
import { ArtifactFenceController } from './artifact-fence-controller.js';
import type { ArtifactCanvasTarget } from './artifact-canvas-model.js';
import { CodeBlockContextMenu } from './code-block-context-menu.js';
import { isShellLanguage, SourceCodeBlock } from './markdown-code-block.js';
import { isMathFenceLanguage, isMermaidFenceLanguage } from './markdown-math.js';
import { MathView } from './markdown-math-view.js';
import { MermaidBlock } from './MermaidBlock.js';

export type MarkdownRenderingPhase = 'streaming' | 'completed' | 'explicit-artifact-review';

export type MarkdownCodeFenceProps = {
  language: string;
  /** Full fence info string including title/surface metadata. */
  fenceInfo: string;
  source: string;
  htmlUiModeEnabled: boolean;
  /** Canonical index ordinal. Null means this fence is not bound — render as ordinary code. */
  fenceIndex: number | null;
  /**
   * Canonical index `open` flag. An open fence stays plain source; a closed
   * fence highlights (and Canvas folds to the launcher) even if renderingPhase
   * is still stuck on streaming.
   */
  fenceOpen?: boolean;
  renderingPhase: MarkdownRenderingPhase;
  artifactTheme?: ArtifactThemeVariables;
  initPriority: number;
  artifactThemeKey?: string;
  onArtifactAction?: (action: ArtifactActionMessage) => void;
  artifactOrigin?: { sessionId: string; messageId: string };
  onOpenArtifactCanvas?: (target: ArtifactCanvasTarget) => void;
  artifactPreviewEnabled: boolean;
  artifactCodeFirst?: boolean;
  artifactMaxBytes?: number;
  artifactBlockExternalScripts?: boolean;
  artifactBlockExternalResources?: boolean;
  locale: 'zh-CN' | 'en';
};

/**
 * Fence dispatcher: Mermaid, math, Artifact controller, or ordinary source.
 * Highlighting lives in markdown-code-block; Streamdown wiring stays in MarkdownView.
 */
export function MarkdownCodeFence(props: MarkdownCodeFenceProps): ReactElement {
  return (
    <CodeBlockContextMenu source={props.source} language={props.language}>
      <FenceBody {...props} />
    </CodeBlockContextMenu>
  );
}

function FenceBody(props: MarkdownCodeFenceProps): ReactElement {
  // Closed fences are stable even if the rest of the message is still
  // streaming (or renderingPhase is stuck). Only the still-open fence stays
  // plain so we do not rebuild token trees on every delta.
  const liveGrowingFence =
    props.renderingPhase === 'streaming' && props.fenceOpen !== false;

  if (isMermaidFenceLanguage(props.language)) {
    return <MermaidBlock source={props.source} />;
  }

  if (isMathFenceLanguage(props.language)) {
    return <MathView tex={props.source} display />;
  }

  if (props.fenceIndex === null) {
    return (
      <SourceCodeBlock
        language={props.language}
        source={props.source}
        isShell={isShellLanguage(props.language)}
        streaming={liveGrowingFence}
      />
    );
  }

  return <ArtifactFenceController {...props} />;
}
