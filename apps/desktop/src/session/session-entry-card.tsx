import type { ReactElement, ReactNode } from 'react';
import type { ExtensionSessionBackendIcon } from '@piwin/contracts';
import { Button, SessionBackendIcon } from '@piwin/ui-kit';

export function SessionEntryCard(props: {
  name: string;
  badge: string;
  selected: boolean;
  ready: boolean;
  /** The built-in engine is always available: its badge is a label, not a readiness state. */
  builtin?: boolean;
  icon?: ExtensionSessionBackendIcon | undefined;
  title: string;
  testId: string;
  onSelect: () => void;
  children?: ReactNode;
}): ReactElement {
  return (
    <Button
      variant="ghost"
      role="radio"
      aria-checked={props.selected}
      className={`empty-stage-engine-card${props.selected ? ' is-selected' : ''}${!props.ready ? ' is-not-ready' : ''}`}
      data-testid={props.testId}
      title={props.title}
      onClick={props.onSelect}
    >
      <span className="empty-stage-engine-card-header">
        {props.icon ? (
          <span className="empty-stage-engine-icon" aria-hidden="true">
            <SessionBackendIcon icon={props.icon} name={props.name} variant="glyph" size={14} />
          </span>
        ) : null}
        <span className="empty-stage-engine-name">{props.name}</span>
        <span className={`empty-stage-engine-badge${props.builtin === true ? ' is-builtin' : props.ready ? ' is-ready' : ' is-warning'}`}>
          {props.badge}
        </span>
      </span>
      {props.children}
    </Button>
  );
}
