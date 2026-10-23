import { Component, type ErrorInfo, type ReactNode } from 'react';

export type RenderErrorSurface = 'markdown' | 'canvas' | 'message';

export type RenderErrorBoundaryProps = {
  children: ReactNode;
  locale: 'zh-CN' | 'en';
  surface: RenderErrorSurface;
  /**
   * When this changes after a catch, the boundary retries. Streaming
   * Canvas/Markdown must not freeze on the first half-emitted snapshot.
   */
  resetKey: string;
};

type RenderErrorBoundaryState = {
  error: Error | null;
  resetKey: string;
  /** Captured so a packaged build (no devtools) can show where it threw. */
  componentStack: string | null;
};

function fallbackCopy(
  surface: RenderErrorSurface,
  locale: 'zh-CN' | 'en',
): { title: string; hint: string } {
  const isZh = locale === 'zh-CN';
  if (surface === 'message') {
    return {
      title: isZh ? '这条消息无法渲染' : 'This message could not be rendered',
      hint: isZh
        ? '会话其余部分不受影响。输出继续到达时会自动重试这一条。'
        : 'The rest of the conversation is intact. This message retries as new tokens arrive.',
    };
  }
  if (surface === 'canvas') {
    return {
      title: isZh ? '画布预览出错' : 'Canvas preview failed',
      hint: isZh
        ? '生成还在继续。对话没有丢，等输出完成后再从启动条打开画布。'
        : 'Generation can continue. The conversation is intact — reopen Canvas from its launcher when the fence finishes.',
    };
  }
  return {
    title: isZh ? '这段回复无法渲染' : 'This reply could not be rendered',
    hint: isZh
      ? '其余界面不受影响。新的输出到达后会自动重试。'
      : 'The rest of the shell is intact. New tokens retry this surface automatically.',
  };
}

/**
 * Local recovery so a Streamdown / Canvas render throw cannot replace the
 * whole desktop shell (AppErrorBoundary). Mermaid already has this pattern.
 */
export class RenderErrorBoundary extends Component<
  RenderErrorBoundaryProps,
  RenderErrorBoundaryState
> {
  state: RenderErrorBoundaryState = {
    error: null,
    resetKey: this.props.resetKey,
    componentStack: null,
  };

  static getDerivedStateFromProps(
    props: RenderErrorBoundaryProps,
    state: RenderErrorBoundaryState,
  ): Partial<RenderErrorBoundaryState> | null {
    if (state.resetKey === props.resetKey) {
      return null;
    }
    return { error: null, resetKey: props.resetKey, componentStack: null };
  }

  static getDerivedStateFromError(error: Error): Partial<RenderErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ componentStack: info.componentStack ?? null });
    console.warn(
      `[piwin] ${this.props.surface} render error`,
      error,
      info.componentStack,
    );
  }

  render(): ReactNode {
    if (this.state.error) {
      const copy = fallbackCopy(this.props.surface, this.props.locale);
      return (
        <div
          className="render-error-boundary"
          data-testid="render-error-boundary"
          data-surface={this.props.surface}
          role="alert"
        >
          <p className="render-error-boundary-title">{copy.title}</p>
          <p className="muted">{copy.hint}</p>
          <details className="banner-details">
            <summary>{this.props.locale === 'zh-CN' ? '技术细节' : 'Technical details'}</summary>
            <pre className="permission-detail">
              {this.state.error.message}
              {this.state.componentStack ? `\n\n${this.state.componentStack}` : ''}
            </pre>
          </details>
        </div>
      );
    }
    return this.props.children;
  }
}
