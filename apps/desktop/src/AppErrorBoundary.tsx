import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button, Notice } from '@piwin/ui-kit';

type AppErrorBoundaryProps = {
  children: ReactNode;
};

type AppErrorBoundaryState = {
  error: Error | null;
  copyStatus: 'idle' | 'success' | 'error';
  /** Captured so a packaged build (no devtools) can show where it threw. */
  componentStack: string | null;
};

/**
 * Top-level recovery UI so a renderer crash does not blank the window (PD-UX-02).
 */
export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null, copyStatus: 'idle', componentStack: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error, copyStatus: 'idle', componentStack: null };
  }

  /**
   * The shell is the last resort: recovery here must not force a window reload
   * (that drops the session view). Re-rendering remounts the crashed subtree;
   * a later token can then succeed where the first attempt threw.
   */
  private retry(): void {
    this.setState({ error: null, copyStatus: 'idle', componentStack: null });
  }

  private async copyDiagnostics(): Promise<void> {
    const message = this.state.error?.message ?? 'unknown';
    try {
      await navigator.clipboard.writeText(message);
      this.setState({ copyStatus: 'success' });
    } catch {
      this.setState({ copyStatus: 'error' });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ componentStack: info.componentStack ?? null });
    console.error('[piwin] renderer crash', error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="app-error-boundary" data-testid="app-error-boundary" role="alert">
          <h1>Something went wrong</h1>
          <p className="muted">
            The desktop shell hit an unexpected error. Try again first — it re-renders without
            losing the session. Reload rebuilds the window; copy diagnostics for support. Host
            activity may have more detail.
          </p>
          <details className="banner-details">
            <summary>Technical details</summary>
            <pre className="permission-detail">
              {this.state.error.message}
              {this.state.componentStack ? `\n\n${this.state.componentStack}` : ''}
            </pre>
          </details>
          <div className="run-status-actions">
            <Button
              variant="primary"
              data-testid="app-error-reload"
              onClick={() => {
                window.location.reload();
              }}
            >
              Reload
            </Button>
            <Button
              data-testid="app-error-retry"
              onClick={() => {
                this.retry();
              }}
            >
              Try again
            </Button>
            <Button
              data-testid="app-error-copy"
              onClick={() => void this.copyDiagnostics()}
            >
              Copy diagnostics
            </Button>
          </div>
          {this.state.copyStatus === 'success' ? (
            <Notice tone="success">Diagnostics copied to clipboard.</Notice>
          ) : null}
          {this.state.copyStatus === 'error' ? (
            <Notice tone="error">
              Could not copy diagnostics. Select the technical details to copy them manually.
            </Notice>
          ) : null}
        </div>
      );
    }
    return this.props.children;
  }
}
