import { useState, type ReactElement } from 'react';
import type { ToolPresentation } from '@piwin/contracts';
import { resolveHealthToolCardStatus } from '@piwin/contracts';

export function DesktopHealthToolCard(props: {
  presentation?: ToolPresentation;
  toolStatus?: 'running' | 'done' | 'error';
}): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const health = props.presentation?.health;
  const status = resolveHealthToolCardStatus(props.presentation, props.toolStatus);
  return (
    <article className="health-tool-card" data-testid="health-tool-card">
      <button type="button" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
        读取 Apple Health · {status}
        {health?.periodLabel ? ` · ${health.periodLabel}` : ''}
        {health?.freshnessLabel ? ` · ${health.freshnessLabel}` : ''}
      </button>
      {expanded && health ? (
        <div>
          {health.timezone ? <p>{health.timezone}</p> : null}
          {health.unavailableMetrics && health.unavailableMetrics.length > 0 ? (
            <p>{health.unavailableMetrics.join(', ')}</p>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
