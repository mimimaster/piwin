/**
 * Conversation assistant body: markdown + citations + domain results.
 * Does not render Agent work details, tools, or thinking.
 */
import type { ReactElement } from 'react';
import type { ArtifactActionMessage } from '@piwin/artifact';
import type { ThemeManifest } from '@piwin/contracts';
import type { ArtifactCanvasTarget } from './artifact-canvas-model';
import type { ChatMessageUi, RunRecordUi } from './chat-reducer';
import { CitationCards } from './CitationCards';
import { isFlashcardArtifactSource } from './flashcard-artifact';
import { MarkdownView } from './MarkdownView';
import { mapThemeToArtifactVariables } from './artifact-theme-map';
import { resolveAssistantRenderingPhase } from './streaming-caret';
import type { DocumentOpenInput } from './tool-call-card';

export function messageHasFlashcardToolResult(message: ChatMessageUi): boolean {
  return message.tools.some((tool) => {
    const name = (tool.presentation?.routedToolName ?? tool.toolName).toLowerCase();
    return (
      tool.status === 'done' &&
      (name.includes('flashcard_create') || name.includes('flashcard_batch_create'))
    );
  });
}

export function ConversationResponseContent(props: {
  message: ChatMessageUi;
  sessionId?: string;
  messageIndex: number;
  showStreamingCaret: boolean;
  activeTheme: ThemeManifest | null;
  artifactThemeKey: string | number;
  runRecordsById: Record<string, RunRecordUi>;
  activeRunId: string | null;
  locale: 'zh-CN' | 'en';
  artifactPreviewEnabled?: boolean;
  artifactMaxBytes?: number;
  onArtifactAction?: (action: ArtifactActionMessage) => void;
  onOpenArtifactCanvas?: (target: ArtifactCanvasTarget) => void;
  onOpenDocument?: ((input: DocumentOpenInput) => void) | undefined;
}): ReactElement {
  const { message } = props;
  const showFlashcardFallback =
    messageHasFlashcardToolResult(message) && !isFlashcardArtifactSource(message.text);
  return (
    <div className="conversation-response" data-testid="conversation-response">
      {message.text.trim().length > 0 ? (
        <MarkdownView
          text={message.text}
          renderingPhase={resolveAssistantRenderingPhase(
            message,
            props.runRecordsById,
            props.activeRunId,
          )}
          artifactTheme={mapThemeToArtifactVariables(props.activeTheme)}
          initPriorityBase={props.messageIndex * 10}
          artifactThemeKey={`${props.activeTheme?.id ?? 'none'}:${props.artifactThemeKey}`}
          showStreamingCaret={props.showStreamingCaret}
          locale={props.locale}
          {...(props.artifactPreviewEnabled ? { artifactPreviewEnabled: true } : {})}
          {...(props.artifactMaxBytes !== undefined
            ? { artifactMaxBytes: props.artifactMaxBytes }
            : {})}
          {...(props.onArtifactAction ? { onArtifactAction: props.onArtifactAction } : {})}
          {...(props.sessionId
            ? { artifactOrigin: { sessionId: props.sessionId, messageId: message.id } }
            : {})}
          {...(props.onOpenArtifactCanvas
            ? { onOpenArtifactCanvas: props.onOpenArtifactCanvas }
            : {})}
          {...(props.onOpenDocument ? { onOpenDocument: props.onOpenDocument } : {})}
        />
      ) : null}
      {message.searchEvidence !== undefined ? (
        <CitationCards evidence={message.searchEvidence} />
      ) : null}
      {showFlashcardFallback ? (
        <div className="conversation-flashcard-result" data-testid="conversation-flashcard-result">
          {props.locale === 'zh-CN' ? '已创建知识卡片' : 'Flashcards created'}
        </div>
      ) : null}
    </div>
  );
}
