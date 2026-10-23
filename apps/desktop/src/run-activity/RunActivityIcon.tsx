import { type ReactElement } from 'react';
import type { ActivityIconSource } from './run-activity-types.js';
import { ActivitySvgIcon } from './RunActivitySvgIcons.js';

export type RunActivityIconProps = {
  source: ActivityIconSource;
  className?: string | undefined;
  'data-testid'?: string | undefined;
};

export function RunActivityIcon(props: RunActivityIconProps): ReactElement {
  return (
    <ActivitySvgIcon
      kind={props.source.kind}
      actionCategory={props.source.actionCategory}
      lucideName={props.source.lucideName}
      className={props.className}
      {...(props['data-testid'] !== undefined ? { 'data-testid': props['data-testid'] } : {})}
    />
  );
}
