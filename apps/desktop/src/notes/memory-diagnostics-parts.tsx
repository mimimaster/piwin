/**
 * Tiny presentational helpers for MemoryDiagnosticsPanel, kept out of the
 * panel file so the data/actions flow stays readable. Class hooks live in
 * memory-diagnostics.css (.memory-diag-*).
 */
import type { ReactElement, ReactNode } from 'react';
import { Button, Collapse } from '@piwin/ui-kit';

/** Label/value row used by every section. */
export function MemoryDiagRow(props: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="memory-diag-row">
      <span className="muted">{props.label}</span>
      <span className="memory-diag-value">{props.children}</span>
    </div>
  );
}

/** One muted note line under a section or an action. */
export function MemoryDiagNote(props: {
  muted?: boolean;
  testId?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div
      className={`memory-diag-note${props.muted === false ? '' : ' muted'}`}
      {...(props.testId !== undefined ? { 'data-testid': props.testId } : {})}
    >
      {props.children}
    </div>
  );
}

/** Ghost-button toggle + Collapse for expandable technical detail. */
export function MemoryDiagExpandable(props: {
  label: string;
  open: boolean;
  onToggle: () => void;
  testId: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div>
      <Button
        variant="ghost"
        size="compact"
        className="memory-diag-toggle"
        data-testid={`${props.testId}-toggle`}
        aria-expanded={props.open}
        aria-controls={`${props.testId}-content`}
        onClick={props.onToggle}
      >
        {props.open ? '▾' : '▸'} {props.label}
      </Button>
      <Collapse
        id={`${props.testId}-content`}
        expanded={props.open}
        transitionDuration={0}
        animateOpacity={false}
        testId={props.testId}
      >
        {props.open ? <div className="memory-diag-detail muted">{props.children}</div> : null}
      </Collapse>
    </div>
  );
}
