/**
 * Mermaid fence renderer (CE-MD-02).
 * Soft-fail: timeout / parse errors show source; never unmount the chat shell.
 * Lazy-loads mermaid to limit initial bundle size. securityLevel: strict.
 */

import {
  Component,
  useEffect,
  useId,
  useState,
  type ErrorInfo,
  type ReactElement,
  type ReactNode,
} from 'react';
import { formatError } from '@piwin/contracts';
import { useMarkdownRenderingPhase } from './markdown-rendering-phase.js';
import { useThemeMode, type ThemeMode } from './theme/theme-mode.js';

const MERMAID_RENDER_TIMEOUT_MS = 8_000;

/**
 * Mermaid bakes colors into the SVG it emits, so it cannot inherit the Deck
 * ramp and has to be told which face is active. Pinning `dark` here painted
 * near-white diagram labels onto Bone's paper surfaces at ~1:1 contrast, which
 * is invisible rather than merely off-palette.
 */
const MERMAID_THEME: Record<ThemeMode, 'dark' | 'default'> = {
  dark: 'dark',
  light: 'default',
};

type MermaidBlockProps = {
  source: string;
};

type MermaidRenderState =
  { status: 'loading' } | { status: 'ready'; svg: string } | { status: 'error'; message: string };

export function MermaidBlock({ source }: MermaidBlockProps): ReactElement {
  return (
    <MermaidErrorBoundary source={source}>
      <MermaidInner source={source} />
    </MermaidErrorBoundary>
  );
}

function MermaidInner({ source }: MermaidBlockProps): ReactElement {
  const reactId = useId().replace(/:/g, '');
  const phase = useMarkdownRenderingPhase();
  const themeMode = useThemeMode();
  const [state, setState] = useState<MermaidRenderState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    if (phase === 'streaming') {
      setState({ status: 'loading' });
      return;
    }

    async function renderDiagram(): Promise<void> {
      timeoutId = setTimeout(() => {
        if (!cancelled) {
          setState({
            status: 'error',
            message: `Mermaid render timed out after ${MERMAID_RENDER_TIMEOUT_MS}ms`,
          });
        }
      }, MERMAID_RENDER_TIMEOUT_MS);

      try {
        const mermaidModule = await import('mermaid');
        const mermaid = mermaidModule.default;
        mermaid.initialize({
          startOnLoad: false,
          // Strict: no click handlers / loose HTML in diagram labels.
          securityLevel: 'strict',
          theme: MERMAID_THEME[themeMode],
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        });
        const diagramId = `piwin-mermaid-${reactId}-${Date.now().toString(36)}`;
        const { svg } = await mermaid.render(diagramId, source);
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
        }
        if (!cancelled) {
          setState({ status: 'ready', svg });
        }
      } catch (error) {
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
        }
        if (!cancelled) {
          const message = formatError(error);
          setState({ status: 'error', message });
        }
      }
    }

    setState({ status: 'loading' });
    void renderDiagram();

    return () => {
      cancelled = true;
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    };
    // themeMode re-renders the diagram on a theme flip: the colors are already
    // inside the emitted SVG, so nothing else can repaint them.
  }, [source, reactId, phase, themeMode]);

  if (phase === 'streaming') {
    return (
      <pre className="md-code" data-testid="mermaid-stream-source">
        <code data-language="mermaid">{source}</code>
      </pre>
    );
  }

  if (state.status === 'loading') {
    return (
      <div className="md-mermaid-loading" data-testid="mermaid-loading">
        Rendering diagram…
      </div>
    );
  }

  if (state.status === 'error') {
    return <MermaidFallback source={source} message={state.message} />;
  }

  return (
    <div
      className="md-mermaid"
      data-testid="mermaid-diagram"
      // mermaid securityLevel:strict sanitizes output; still never treat as free HTML from the model.
      dangerouslySetInnerHTML={{ __html: state.svg }}
    />
  );
}

function MermaidFallback(props: { source: string; message: string }): ReactElement {
  return (
    <div className="md-mermaid-error" data-testid="mermaid-error" role="alert">
      <div className="md-mermaid-error-title">Mermaid diagram failed</div>
      <p className="muted md-mermaid-error-message">{props.message}</p>
      <pre className="md-code">
        <code data-language="mermaid">{props.source}</code>
      </pre>
    </div>
  );
}

type MermaidErrorBoundaryProps = {
  source: string;
  children: ReactNode;
};

type MermaidErrorBoundaryState = {
  errorMessage: string | null;
};

class MermaidErrorBoundary extends Component<MermaidErrorBoundaryProps, MermaidErrorBoundaryState> {
  override state: MermaidErrorBoundaryState = { errorMessage: null };

  static getDerivedStateFromError(error: Error): MermaidErrorBoundaryState {
    return { errorMessage: error.message || 'Mermaid crashed' };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.warn('[piwin] Mermaid block error', error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.errorMessage) {
      return <MermaidFallback source={this.props.source} message={this.state.errorMessage} />;
    }
    return this.props.children;
  }
}
