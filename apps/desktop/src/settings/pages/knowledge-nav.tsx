/**
 * Navigation and overview metric components for Knowledge Settings.
 */
import type { ReactElement, ReactNode } from 'react';
import type { KnowledgeTab } from './knowledge-page.js';

export function KnowledgeMetric(props: {
  label: string;
  value: string;
  detail: string;
  statusTone: 'green' | 'amber' | 'gray';
  onClick: () => void;
  compact?: boolean;
}): ReactElement {
  return (
    <div className="knowledge-workspace-metric" onClick={props.onClick} role="button" tabIndex={0}>
      <div className="knowledge-metric-top">
        <span className="knowledge-workspace-metric-label">{props.label}</span>
        <span className={`status-dot ${props.statusTone}`} />
      </div>
      <strong className={props.compact ? 'is-compact' : undefined} title={props.value}>
        {props.value}
      </strong>
      <small>{props.detail}</small>
    </div>
  );
}

export function KnowledgeNavItem(props: {
  active: boolean;
  kind: KnowledgeTab;
  title: string;
  description: string;
  defaultLabel: string;
  statusTone: 'green' | 'amber' | 'gray';
  onClick: () => void;
  testId: string;
}): ReactElement {
  return (
    <button
      type="button"
      className={`knowledge-workspace-nav-item ${props.active ? 'is-active' : ''}`}
      onClick={props.onClick}
      data-testid={props.testId}
      role="tab"
      aria-selected={props.active}
    >
      <KnowledgeCapabilityIcon kind={props.kind} />
      <span className="knowledge-workspace-nav-copy">
        <span className="knowledge-workspace-nav-title">
          <strong>{props.title}</strong>
          <span className={`status-dot ${props.statusTone}`} />
        </span>
        <small>{props.description}</small>
        <em title={props.defaultLabel}>{props.defaultLabel}</em>
      </span>
    </button>
  );
}

export function KnowledgeCapabilityIcon(props: { kind: KnowledgeTab }): ReactElement {
  const paths: Record<KnowledgeTab, ReactNode> = {
    embedding: (
      <>
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
      </>
    ),
    reranker: (
      <>
        <circle cx="12" cy="12" r="10" />
        <circle cx="12" cy="12" r="6" />
        <circle cx="12" cy="12" r="2" />
      </>
    ),
    parsers: (
      <>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <polyline points="10 9 9 9 8 9" />
      </>
    ),
    llms: (
      <>
        <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3z" />
      </>
    ),
  };
  return (
    <span className={`knowledge-workspace-nav-icon is-${props.kind}`} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65">
        {paths[props.kind]}
      </svg>
    </span>
  );
}
