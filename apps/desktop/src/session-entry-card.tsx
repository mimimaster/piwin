import type { ReactElement, ReactNode } from 'react';
import { Button } from '@piwin/ui-kit';

export function SessionEntryCard(props: {
  name: string;
  badge: string;
  selected: boolean;
  ready: boolean;
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
        <span className="empty-stage-engine-name">{props.name}</span>
        <span className={`empty-stage-engine-badge${props.ready ? ' is-ready' : ' is-warning'}`}>
          {props.badge}
        </span>
      </span>
      {props.children}
    </Button>
  );
}
