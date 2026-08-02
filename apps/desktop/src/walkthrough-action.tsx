/**
 * Walkthrough card mount for a single Assistant message.
 *
 * ADR 0026: generation UX retired (no Generate / Regenerate buttons).
 * Existing ready/error/generating artifacts remain viewable when present.
 */
import type { ReactElement } from 'react';
import type { WalkthroughArtifact } from '@piwin/contracts';
import type { ChatMessageUi, RunRecordUi } from './chat-reducer';
import { WalkthroughCard } from './walkthrough-card';

export type WalkthroughActionProps = {
  message: ChatMessageUi;
  /** Artifact bound to this message, if any. */
  artifact?: WalkthroughArtifact | undefined;
  /** @deprecated ADR 0026 — generation retired; ignored. */
  eligible?: boolean;
  /** @deprecated ADR 0026 — generation retired; ignored. */
  autoGenerate?: boolean;
  /** Locale for user-facing strings (defaults to English when omitted). */
  locale?: 'zh-CN' | 'en';
  /** @deprecated ADR 0026 — generation retired; ignored. */
  onGenerate?: (messageId: string, force?: boolean) => void | Promise<void>;
  onCancel?: ((messageId: string, generationId?: string) => void | Promise<void>) | undefined;
  onOpenDocument?: ((doc: { title: string; path?: string; content?: string }) => void) | undefined;
};

/**
 * Pure eligibility check retained for tests/callers; always returns false after ADR 0026
 * (generation retired). Existing artifacts still render via WalkthroughAction.
 */
export function isWalkthroughEligible(_params: {
  message: ChatMessageUi;
  messages: ChatMessageUi[];
  runRecordsById: Record<string, RunRecordUi>;
  activeRunId: string | null;
  enabled: boolean;
}): boolean {
  return false;
}

export function WalkthroughAction(props: WalkthroughActionProps): ReactElement | null {
  const { message, artifact, locale } = props;
  if (!artifact) return null;

  return (
    <div className="walkthrough-action" data-testid={`walkthrough-action-${message.id}`}>
      <WalkthroughCard
        artifact={artifact}
        messageId={message.id}
        {...(locale ? { locale } : {})}
        onOpenDocument={props.onOpenDocument}
        onCancel={props.onCancel}
      />
    </div>
  );
}
