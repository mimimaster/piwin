/**
 * Subagent session transcript. Renders persisted history followed
 * by one live tail (deduplicated upstream by the pure session projection).
 * Owns auto-follow scrolling and per-message presentation only — no session
 * controls, composer, or lifecycle interpretation.
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { ChatMessageUi, SubagentStreamState } from './chat-reducer';
import { subagentSegmentToUiMessage } from './subagent-session-projection';
import { MarkdownView } from './MarkdownView';
import { Button } from '@piwin/ui-kit';
import type { PermissionDecision, PermissionRememberScope } from '@piwin/contracts';
import type { ArtifactActionMessage } from '@piwin/artifact';
import { IconChevronDown } from './shell-icons';
import { TurnWorkDetails } from './turn-work-details';
import { CitationCards } from './CitationCards';
import { MessageAttachments } from './message-attachments';
import { FilesChangedBar, type FilesChangedBarRequest } from './files-changed-bar';
import { ImageGenerationProgress } from './image-generation-progress';
import { VideoGenerationProgress } from './video-generation-progress';
import {
  resolveGenerationToolKind,
  shouldRenderGenerationProgress,
  type GenerationToolKind,
} from './generation-tool-kind';
import { PermissionBar } from './permission-bar';
import { SystemMessageContent } from './system-message-content';
import type { DocumentOpenInput } from './tool-call-card';
import type { DiffCardRequest } from './diff-card';
import type { ArtifactCanvasTarget } from './artifact-canvas-model';

export type SubagentSessionTranscriptProps = {
  historicalMessages: ChatMessageUi[];
  stream: SubagentStreamState | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  locale: 'zh-CN' | 'en';
  /** Whether persisted and live child-session thinking should be rendered. */
  showThinking?: boolean;
  childSessionId?: string;
  projectPath?: string | null;
  request?: DiffCardRequest;
  filesChangedRequest?: FilesChangedBarRequest;
  onOpenFile?: (absolutePath: string, relativePath?: string) => void;
  onOpenDocument?: (input: DocumentOpenInput) => void;
  onArtifactAction?: (action: ArtifactActionMessage) => void;
  onOpenArtifactCanvas?: (target: ArtifactCanvasTarget) => void;
  artifactPreviewEnabled?: boolean;
  artifactMaxBytes?: number;
  onPermission?: (
    prompt: import('./chat-reducer').PermissionPromptUi,
    decision: PermissionDecision,
    rememberScope?: PermissionRememberScope,
  ) => void;
};

const SCROLL_FOLLOW_THRESHOLD_PX = 80;

function SubagentInspectorAssistant({
  message,
  streaming,
  locale,
  showThinking,
  permissionPrompt,
  childSessionId,
  projectPath,
  request,
  filesChangedRequest,
  onOpenFile,
  onOpenDocument,
  onArtifactAction,
  onOpenArtifactCanvas,
  artifactPreviewEnabled,
  artifactMaxBytes,
}: {
  message: ChatMessageUi;
  streaming: boolean;
  locale: 'zh-CN' | 'en';
  showThinking: boolean;
  permissionPrompt?: import('./chat-reducer').PermissionPromptUi | null;
  childSessionId?: string;
  projectPath?: string | null;
  request?: DiffCardRequest;
  filesChangedRequest?: FilesChangedBarRequest;
  onOpenFile?: (absolutePath: string, relativePath?: string) => void;
  onOpenDocument?: (input: DocumentOpenInput) => void;
  onArtifactAction?: (action: ArtifactActionMessage) => void;
  onOpenArtifactCanvas?: (target: ArtifactCanvasTarget) => void;
  artifactPreviewEnabled?: boolean;
  artifactMaxBytes?: number;
}): ReactElement {
  const imageGenerationStatus = getGenerationStatus(message, 'image');
  const videoGenerationStatus = getGenerationStatus(message, 'video');
  return (
    <div className="subagent-inspector-message role-assistant" data-streaming={streaming}>
      <TurnWorkDetails
        message={message}
        runRecordsById={{}}
        activeRunId={streaming ? message.runId ?? null : null}
        permissionPrompt={permissionPrompt ?? null}
        workDetailsExpanded="always"
        toolDensity="comfortable"
        showThinking={showThinking}
        locale={locale}
        {...(projectPath !== undefined ? { projectPath } : {})}
        {...(request ? { request } : {})}
        {...(onOpenFile ? { onOpenFile } : {})}
        {...(onOpenDocument ? { onOpenDocument } : {})}
      >
        {message.text.length > 0 ? (
          <MarkdownView
            text={message.text}
            renderingPhase={streaming ? 'streaming' : 'completed'}
            showStreamingCaret={streaming && message.text.trim().length > 0}
            locale={locale}
            {...(artifactPreviewEnabled ? { artifactPreviewEnabled: true } : {})}
            {...(artifactMaxBytes !== undefined ? { artifactMaxBytes } : {})}
            {...(onArtifactAction ? { onArtifactAction } : {})}
            {...(childSessionId
              ? { artifactOrigin: { sessionId: childSessionId, messageId: message.id } }
              : {})}
            {...(onOpenArtifactCanvas ? { onOpenArtifactCanvas } : {})}
            {...(onOpenDocument ? { onOpenDocument } : {})}
          />
        ) : null}
        {message.searchEvidence ? <CitationCards evidence={message.searchEvidence} /> : null}
      </TurnWorkDetails>
      {imageGenerationStatus &&
      shouldRenderGenerationProgress(imageGenerationStatus, message.attachments) ? (
        <ImageGenerationProgress locale={locale} status={imageGenerationStatus} />
      ) : null}
      {videoGenerationStatus &&
      shouldRenderGenerationProgress(videoGenerationStatus, message.attachments) ? (
        <VideoGenerationProgress locale={locale} status={videoGenerationStatus} />
      ) : null}
      <MessageAttachments
        attachments={message.attachments}
        role="assistant"
        locale={locale}
      />
      {message.tools.length > 0 ? (
        <FilesChangedBar
          tools={message.tools}
          {...(projectPath !== undefined ? { projectPath } : {})}
          {...(filesChangedRequest ? { request: filesChangedRequest } : {})}
          locale={locale}
        />
      ) : null}
    </div>
  );
}

function getGenerationStatus(
  message: ChatMessageUi,
  generationKind: GenerationToolKind,
): import('./chat-reducer').ToolCardUi['status'] | null {
  const tools = message.tools.filter(
    (tool) => resolveGenerationToolKind(tool) === generationKind,
  );
  if (tools.length === 0) return null;
  if (tools.some((tool) => tool.status === 'running')) return 'running';
  if (tools.some((tool) => tool.status === 'error')) return 'error';
  return 'done';
}

function streamToAssistantMessage(stream: SubagentStreamState): ChatMessageUi {
  return subagentSegmentToUiMessage(
    {
      messageId: stream.currentMessageId ?? `subagent-live-${stream.childSessionId}`,
      text: stream.text,
      thinking: stream.thinking,
      tools: [...stream.tools],
      ...(stream.attachments ? { attachments: stream.attachments } : {}),
      ...(stream.searchEvidence ? { searchEvidence: stream.searchEvidence } : {}),
    },
    stream.streaming ? 'streaming' : 'done',
  );
}

export function SubagentSessionTranscript(props: SubagentSessionTranscriptProps): ReactElement {
  const { locale } = props;
  const isChinese = locale === 'zh-CN';
  const showThinking = props.showThinking !== false;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [followLatest, setFollowLatest] = useState(true);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);

  const handleScroll = (): void => {
    const element = scrollRef.current;
    if (!element) {
      return;
    }
    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    const isNearBottom = distanceFromBottom < SCROLL_FOLLOW_THRESHOLD_PX;
    setFollowLatest(isNearBottom);
    setShowJumpToLatest(!isNearBottom);
  };

  useEffect(() => {
    const element = scrollRef.current;
    if (element && followLatest) {
      element.scrollTop = element.scrollHeight;
    }
  }, [
    props.historicalMessages,
    props.stream?.text,
    props.stream?.thinking,
    props.stream?.tools,
    followLatest,
  ]);

  const jumpToLatest = (): void => {
    const element = scrollRef.current;
    if (element) {
      element.scrollTop = element.scrollHeight;
    }
    setFollowLatest(true);
    setShowJumpToLatest(false);
  };

  if (props.loading && props.historicalMessages.length === 0) {
    return (
      <div className="subagent-inspector-state" data-testid="subagent-inspector-loading">
        {isChinese ? '正在加载会话记录…' : 'Loading session transcript…'}
      </div>
    );
  }

  if (props.error && props.historicalMessages.length === 0) {
    return (
      <div className="subagent-inspector-state is-error" data-testid="subagent-inspector-error">
        <span className="muted">{props.error}</span>
        <Button size="compact" variant="secondary" onClick={props.onRetry}>
          {isChinese ? '重试' : 'Retry'}
        </Button>
      </div>
    );
  }

  const hasLiveContent =
    props.stream !== null &&
    (props.stream.text.length > 0 ||
      (showThinking && props.stream.thinking.length > 0) ||
      props.stream.tools.length > 0 ||
      (props.stream.attachments?.length ?? 0) > 0 ||
      props.stream.searchEvidence !== undefined);

  const isEmpty = props.historicalMessages.length === 0 && !hasLiveContent;
  const livePermissionPrompt = props.stream?.permissionPrompt ?? null;

  return (
    <div className="subagent-inspector-scroll" ref={scrollRef} onScroll={handleScroll}>
      {props.historicalMessages.map((message) => {
        if (message.role === 'assistant') {
          return (
            <SubagentInspectorAssistant
              key={message.id}
              message={message}
              streaming={false}
              locale={locale}
              showThinking={showThinking}
              {...sharedAssistantProps(props)}
            />
          );
        }
        if (message.role === 'user') {
          return (
            <div key={message.id} className="subagent-inspector-message role-user">
              <span className="subagent-inspector-user-label">{isChinese ? '任务' : 'Task'}</span>
              <div className="subagent-inspector-user-text">{message.text}</div>
              <MessageAttachments
                attachments={message.attachments}
                role="user"
                locale={locale}
              />
            </div>
          );
        }
        return (
          <div key={message.id} className="subagent-inspector-message role-system muted">
            <SystemMessageContent
              text={message.text}
              {...(props.projectPath !== undefined ? { projectPath: props.projectPath } : {})}
              {...(props.onOpenFile ? { onOpenFile: props.onOpenFile } : {})}
            />
          </div>
        );
      })}

      {props.stream !== null && hasLiveContent ? (
        <div
          className="subagent-inspector-live"
          data-live={props.stream.streaming}
          data-tool-status={props.stream.streaming ? 'running' : 'done'}
        >
          <SubagentInspectorAssistant
            message={streamToAssistantMessage(props.stream)}
            streaming={props.stream.streaming}
            locale={locale}
            showThinking={showThinking}
            permissionPrompt={props.stream.permissionPrompt ?? null}
            {...sharedAssistantProps(props)}
          />
        </div>
      ) : null}

      {livePermissionPrompt && props.onPermission ? (
        <PermissionBar
          prompt={livePermissionPrompt}
          projectPath={props.projectPath ?? null}
          onPermission={(decision, rememberScope) =>
            props.onPermission?.(livePermissionPrompt, decision, rememberScope)
          }
        />
      ) : null}

      {isEmpty && !props.loading && props.error === null ? (
        <div className="subagent-inspector-state">{isChinese ? '尚无输出' : 'No output yet'}</div>
      ) : null}

      {showJumpToLatest ? (
        <button
          type="button"
          className="subagent-inspector-jump-latest"
          data-testid="subagent-inspector-jump-latest"
          onClick={jumpToLatest}
        >
          <IconChevronDown width={12} height={12} aria-hidden="true" />
          {isChinese ? '回到最新' : 'Back to latest'}
        </button>
      ) : null}
    </div>
  );
}

function sharedAssistantProps(props: SubagentSessionTranscriptProps) {
  return {
    ...(props.childSessionId ? { childSessionId: props.childSessionId } : {}),
    ...(props.projectPath !== undefined ? { projectPath: props.projectPath } : {}),
    ...(props.request ? { request: props.request } : {}),
    ...(props.filesChangedRequest ? { filesChangedRequest: props.filesChangedRequest } : {}),
    ...(props.onOpenFile ? { onOpenFile: props.onOpenFile } : {}),
    ...(props.onOpenDocument ? { onOpenDocument: props.onOpenDocument } : {}),
    ...(props.onArtifactAction ? { onArtifactAction: props.onArtifactAction } : {}),
    ...(props.onOpenArtifactCanvas ? { onOpenArtifactCanvas: props.onOpenArtifactCanvas } : {}),
    ...(props.artifactPreviewEnabled ? { artifactPreviewEnabled: true as const } : {}),
    ...(props.artifactMaxBytes !== undefined ? { artifactMaxBytes: props.artifactMaxBytes } : {}),
  };
}
