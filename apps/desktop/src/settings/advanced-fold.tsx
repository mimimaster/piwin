/**
 * "Advanced" at the bottom of a guided settings card: settings most people
 * never touch stay folded so the main path reads as a few steps.
 */
import { useId, useState, type ReactElement, type ReactNode } from 'react';
import { Button, Collapse } from '@piwin/ui-kit';

export function AdvancedFold(props: {
  label: string;
  children: ReactNode;
  testId: string;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const regionId = useId();
  return (
    <div className="settings-advanced-fold">
      <div className="settings-advanced-fold-toggle">
        <Button
          variant="ghost"
          size="compact"
          aria-expanded={open}
          aria-controls={regionId}
          onClick={() => setOpen((value) => !value)}
          data-testid={`${props.testId}-toggle`}
        >
          {props.label}
          <svg
            className={`settings-collapsible-chevron ${open ? 'open' : ''}`}
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </Button>
      </div>
      <Collapse expanded={open} testId={props.testId}>
        <div id={regionId} className="settings-advanced-fold-body">
          {props.children}
        </div>
      </Collapse>
    </div>
  );
}
