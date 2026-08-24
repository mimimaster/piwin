import type { ReactElement } from 'react';
import { renderKatex } from './markdown-math.js';

export function MathView(props: { tex: string; display: boolean }): ReactElement {
  const result = renderKatex(props.tex, props.display);
  if (!result.ok) {
    const fallback = props.display ? `$$${result.source}$$` : `$${result.source}$`;
    return props.display ? (
      <div
        className="md-math-error md-math-display"
        data-testid="math-error"
        title={result.error}
        role="alert"
      >
        {fallback}
      </div>
    ) : (
      <span className="md-math-error md-math-inline" data-testid="math-error" title={result.error}>
        {fallback}
      </span>
    );
  }

  return props.display ? (
    <div
      className="md-math md-math-display"
      data-testid="math-display"
      dangerouslySetInnerHTML={{ __html: result.html }}
    />
  ) : (
    <span
      className="md-math md-math-inline"
      data-testid="math-inline"
      dangerouslySetInnerHTML={{ __html: result.html }}
    />
  );
}
