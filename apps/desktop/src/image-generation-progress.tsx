import type { ReactElement } from 'react';
import type { ToolCardUi } from './chat-reducer';
import { MediaGenerationCard } from './media-generation-card.js';

export function ImageGenerationProgress(props: {
  locale?: 'zh-CN' | 'en';
  status?: ToolCardUi['status'];
  tool?: ToolCardUi;
  onCancel?: (() => void) | undefined;
  onRetry?: (() => void) | undefined;
  onOpen?: (() => void) | undefined;
  onOpenLibrary?: (() => void) | undefined;
}): ReactElement {
  return (
    <MediaGenerationCard
      kind="image"
      {...(props.locale !== undefined ? { locale: props.locale } : {})}
      {...(props.status !== undefined ? { status: props.status } : {})}
      {...(props.tool !== undefined ? { tool: props.tool } : {})}
      {...(props.onCancel !== undefined ? { onCancel: props.onCancel } : {})}
      {...(props.onRetry !== undefined ? { onRetry: props.onRetry } : {})}
      {...(props.onOpen !== undefined ? { onOpen: props.onOpen } : {})}
      {...(props.onOpenLibrary !== undefined ? { onOpenLibrary: props.onOpenLibrary } : {})}
    />
  );
}
