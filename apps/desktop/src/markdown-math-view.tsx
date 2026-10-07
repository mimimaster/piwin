import { useEffect, useState, type ReactElement } from 'react';
import { isKatexReady, loadKatex, renderKatex, type KatexRenderResult } from './markdown-math.js';

function mathFallback(tex: string, display: boolean, result: KatexRenderResult): ReactElement {
  const source = result.ok ? tex : result.source;
  const fallback = display ? `$$${source}$$` : `$${source}$`;
  const pending = !result.ok && result.pending === true;
  if (display) {
    return (
      <div
        className={pending ? 'md-math md-math-display md-math-pending' : 'md-math-error md-math-display'}
        data-testid={pending ? 'math-pending' : 'math-error'}
        title={pending ? undefined : result.ok ? undefined : result.error}
        {...(pending ? {} : { role: 'alert' as const })}
      >
        {fallback}
      </div>
    );
  }
  return (
    <span
      className={pending ? 'md-math md-math-inline md-math-pending' : 'md-math-error md-math-inline'}
      data-testid={pending ? 'math-pending' : 'math-error'}
      title={pending ? undefined : result.ok ? undefined : result.error}
    >
      {fallback}
    </span>
  );
}

/**
 * Renders TeX once KaTeX is available. While the chunk loads, keeps the source
 * visible so streaming math never blanks or flashes away.
 */
export function MathView(props: { tex: string; display: boolean; className?: string }): ReactElement {
  const [result, setResult] = useState<KatexRenderResult>(() => renderKatex(props.tex, props.display));

  useEffect(() => {
    let cancelled = false;
    const next = renderKatex(props.tex, props.display);
    if (next.ok || next.pending !== true) {
      setResult(next);
      return undefined;
    }
    setResult(next);
    void loadKatex().then(() => {
      if (!cancelled) {
        setResult(renderKatex(props.tex, props.display));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [props.tex, props.display]);

  // If another surface already loaded KaTeX between renders, prefer the fresh
  // sync result without waiting for the effect.
  const live = isKatexReady() ? renderKatex(props.tex, props.display) : result;
  if (!live.ok) {
    return mathFallback(props.tex, props.display, live);
  }

  const className = [
    'md-math',
    props.display ? 'md-math-display' : 'md-math-inline',
    props.className,
  ]
    .filter(Boolean)
    .join(' ');

  return props.display ? (
    <div
      className={className}
      data-testid="math-display"
      dangerouslySetInnerHTML={{ __html: live.html }}
    />
  ) : (
    <span
      className={className}
      data-testid="math-inline"
      dangerouslySetInnerHTML={{ __html: live.html }}
    />
  );
}
