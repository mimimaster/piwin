/** Compact call-chain row for `piwin_toolbox` search / describe / status lookups. */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { ToolCardUi } from './chat-reducer';
import type { ToolCallDensity } from './ui-preferences';
import { ChainIconSearch } from './inkstone-chain-icons.js';
import { IconChevronDown } from './shell-icons';
import { inkLineNodeClass, toolStatusToNodeStatus } from './session-node-status.js';
import { formatToolDuration } from './tool-call-head';
import { ToolStatusDot } from './tool-status-dot.js';
import {
  toolboxCatalogResultMeta,
  toolboxCatalogTitle,
  type ToolboxCatalogView,
} from './toolbox-catalog-view.js';
import { useTranscriptLocalFoldMeasure } from './use-transcript-local-fold-measure.js';

const MAX_VISIBLE_HITS = 12;

function hasCatalogBody(view: ToolboxCatalogView, tool: ToolCardUi): boolean {
  return (
    tool.status === 'error' ||
    view.hitIds.length > 0 ||
    view.description !== undefined ||
    view.servers.length > 0
  );
}

export function ToolboxCatalogCard(props: {
  tool: ToolCardUi;
  view: ToolboxCatalogView;
  density: ToolCallDensity;
  locale: 'zh-CN' | 'en';
  inkLineSubrow?: boolean | undefined;
}): ReactElement {
  const { tool, view, locale } = props;
  const zh = locale === 'zh-CN';
  const hasBody = hasCatalogBody(view, tool);
  // Lookups stay folded; only a failure opens on its own.
  const [expanded, setExpanded] = useState(tool.status === 'error');
  const userIntentRef = useRef(false);
  const foldMeasure = useTranscriptLocalFoldMeasure(expanded);

  useEffect(() => {
    if (!userIntentRef.current && tool.status === 'error') {
      setExpanded(true);
    }
  }, [tool.status]);

  function toggle(): void {
    if (!hasBody) return;
    foldMeasure.onUserToggle();
    userIntentRef.current = true;
    setExpanded((current) => !current);
  }

  const nodeKind = toolStatusToNodeStatus(tool.status);
  const nodeClass = inkLineNodeClass(nodeKind);
  const resultMeta = toolboxCatalogResultMeta(view, tool.status, locale);
  const durationMs = tool.presentation?.durationMs;
  const durationText = typeof durationMs === 'number' ? formatToolDuration(durationMs) : undefined;
  const title = toolboxCatalogTitle(view.action, locale);
  const hiddenHits = Math.max(0, view.hitIds.length - MAX_VISIBLE_HITS);

  return (
    <div
      ref={foldMeasure.setRoot}
      className={`tr tool-call-card toolbox-catalog-card density-${props.density} status-${tool.status}${
        expanded ? ' is-expanded' : ''
      }${props.inkLineSubrow === true ? ' sub' : ''}${tool.status === 'error' ? ' fail' : ''}`}
      data-testid="tool-call-card"
      data-tool-name={tool.toolName}
      data-tool-kind={tool.presentation?.kind ?? 'unknown'}
      data-tool-status={tool.status}
      data-toolbox-action={view.action}
    >
      <div
        className={`tool-call-summary${hasBody ? ' has-body' : ''}`}
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            toggle();
          }
        }}
        role="button"
        aria-expanded={expanded}
        aria-label={`${title} ${view.subject ?? ''} ${tool.status}`.trim()}
        tabIndex={0}
      >
        <span
          className={`node${props.inkLineSubrow === true ? ' sm' : ''}${nodeClass ? ` ${nodeClass}` : ''}`}
          data-kind={nodeKind}
          aria-hidden="true"
        />
        <ChainIconSearch className="tool-call-kind-icon" />
        <b className="tool-call-action-verb">{title}</b>
        {view.subject ? (
          <code className="tool-call-preview is-query" title={view.subject}>
            {view.subject}
          </code>
        ) : null}
        {resultMeta ? (
          <span className="toolbox-catalog-result" data-testid="toolbox-catalog-result">
            · {resultMeta}
          </span>
        ) : null}
        {tool.status === 'done' ? (
          <span className="tool-call-ok" data-kind="success" aria-label="done" />
        ) : tool.status === 'error' ? (
          <span className="tool-call-err" data-kind="failed" aria-label="error" />
        ) : (
          <ToolStatusDot status={tool.status} />
        )}
        <span className="meta tool-call-meta">
          {durationText ? (
            <span className="tool-call-duration">{durationText}</span>
          ) : tool.status === 'running' ? (
            <span className="tool-call-duration tool-call-duration-live">…</span>
          ) : null}
          {hasBody ? (
            <span className="tool-call-chevron-hit chev" aria-hidden="true">
              <IconChevronDown className={expanded ? 'tool-call-chevron open' : 'tool-call-chevron'} />
            </span>
          ) : null}
        </span>
      </div>
      {expanded && hasBody ? (
        <div
          className={`tool-call-body tb toolbox-catalog-body${tool.status === 'error' ? ' err' : ''}`}
          data-testid="toolbox-catalog-body"
        >
          {tool.presentation?.error ? (
            <div className="tool-call-error" role="status">
              {tool.presentation.error.message}
            </div>
          ) : null}
          {view.hitIds.length > 0 ? (
            <div className="toolbox-catalog-hits">
              {view.hitIds.slice(0, MAX_VISIBLE_HITS).map((id) => (
                <code key={id} className="pc static">
                  {id}
                </code>
              ))}
              {hiddenHits > 0 ? (
                <span className="toolbox-catalog-more">{zh ? `另 ${hiddenHits} 个` : `+${hiddenHits} more`}</span>
              ) : null}
            </div>
          ) : null}
          {view.description ? <p className="toolbox-catalog-description">{view.description}</p> : null}
          {view.servers.length > 0 ? (
            <div className="toolbox-catalog-hits">
              {view.servers.map((server) => (
                <code key={server.serverId} className="pc static">
                  {server.state ? `${server.serverId} · ${server.state}` : server.serverId}
                </code>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
