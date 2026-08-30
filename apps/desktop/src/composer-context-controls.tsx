import type { ReactElement } from 'react';
import { ContextUsageRing } from './context-usage-ring';
import type { ContextRingViewModel } from './context-telemetry-selector.js';

export function ComposerContextUsageControl(props: {
  view: ContextRingViewModel;
  onOpenModelSettings?: () => void;
}): ReactElement | null {
  return (
    <ContextUsageRing
      view={props.view}
      {...(props.onOpenModelSettings ? { onOpenModelSettings: props.onOpenModelSettings } : {})}
    />
  );
}
