import type { ReactElement } from 'react';
import type { ContextUsageSnapshot } from '@piwin/contracts';
import { ContextUsageRing } from './context-usage-ring';

export function ComposerContextUsageControl(props: {
  usage: ContextUsageSnapshot | null;
  modelContextWindow?: number;
  onOpenModelSettings?: () => void;
  isConversationSession?: boolean;
  locale: string;
}): ReactElement {
  return (
    <ContextUsageRing
      usage={props.usage}
      {...(typeof props.modelContextWindow === 'number'
        ? { modelContextWindow: props.modelContextWindow }
        : {})}
      {...(props.onOpenModelSettings ? { onOpenModelSettings: props.onOpenModelSettings } : {})}
      isConversationSession={props.isConversationSession === true}
      locale={props.locale === 'en' ? 'en' : 'zh-CN'}
    />
  );
}
