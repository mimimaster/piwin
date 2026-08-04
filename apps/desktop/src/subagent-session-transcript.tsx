/**
 * Read-only subagent session transcript. Renders persisted history followed
 * by one live tail (deduplicated upstream by the pure session projection).
 * Owns auto-follow scrolling and per-message presentation only — no session
 * controls, composer, or lifecycle interpretation.
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { ChatMessageUi, SubagentStreamState, SubagentStreamTool } from './chat-reducer';
import { MarkdownView } from './MarkdownView';
import { Button } from '@piwin/ui-kit';
import { IconChevronDown } from './shell-icons';

export type SubagentSessionTranscriptProps = {
  historicalMessages: ChatMessageUi[];
  stream: SubagentStreamState | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  locale: 'zh-CN' | 'en';
  /** Whether persisted and live child-session thinking should be rendered. */
  showThinking?: boolean;
};

const SCROLL_FOLLOW_THRESHOLD_PX = 80;

function SubagentToolRow({ tool }: { tool: SubagentStreamTool }): ReactElement {
  return (
    <div className="subagent-inspector-tool" data-status={tool.status}>
      <span className="subagent-inspector-tool-header">
        <span
          className={`subagent-inspector-tool-status status-${tool.status}`}
          aria-hidden="true"
        />
        <code className="subagent-inspector-tool-name">{tool.toolName}</code>
      </span>
      {tool.output.length > 0 ? (
        <pre className="subagent-inspector-tool-output">{tool.output.slice(-2048)}</pre>
      ) : null}
    </div>
  );
}

function SubagentInspectorAssistant({
  message,
  streaming,
  locale,
  showThinking,
}: {
  message: ChatMessageUi;
  streaming: boolean;
  locale: 'zh-CN' | 'en';
  showThinking: boolean;
}): ReactElement {
  const isChinese = locale === 'zh-CN';
  const hasThinking = showThinking && message.thinking.trim().length > 0;
  const hasTools = message.tools.length > 0;
  return (
    <div className="subagent-inspector-message role-assistant" data-streaming={streaming}>
      {hasThinking ? (
        <details className="subagent-inspector-thinking">
          <summary>{isChinese ? '思考过程' : 'Thinking'}</summary>
          <pre className="subagent-inspector-thinking-text">{message.thinking}</pre>
        </details>
      ) : null}
      {hasTools ? (
        <div className="subagent-inspector-tools">
          {message.tools.map((tool) => (
            <SubagentToolRow key={tool.toolCallId} tool={tool} />
          ))}
        </div>
      ) : null}
      <MarkdownView
        text={message.text}
        renderingPhase={streaming ? 'streaming' : 'completed'}
        artifactPreviewEnabled={false}
      />
      {streaming ? (
        <span className="subagent-stream-cursor" aria-hidden="true">
          ▋
        </span>
      ) : null}
    </div>
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
      props.stream.tools.length > 0);
  const isEmpty = props.historicalMessages.length === 0 && !hasLiveContent;

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
            />
          );
        }
        if (message.role === 'user') {
          return (
            <div key={message.id} className="subagent-inspector-message role-user">
              <span className="subagent-inspector-user-label">{isChinese ? '任务' : 'Task'}</span>
              <div className="subagent-inspector-user-text">{message.text}</div>
            </div>
          );
        }
        return (
          <div key={message.id} className="subagent-inspector-message role-system muted">
            {message.text}
          </div>
        );
      })}

      {props.stream !== null &&
        (() => {
          const stream = props.stream;
          const isLive = stream.streaming;
          const hasContent =
            stream.text.length > 0 ||
            (showThinking && stream.thinking.length > 0) ||
            stream.tools.length > 0;
          if (!hasContent) {
            return null;
          }
          return (
            <div className="subagent-inspector-live" data-live={isLive}>
              {showThinking && stream.thinking.length > 0 ? (
                <details className="subagent-inspector-thinking" open>
                  <summary>{isChinese ? '思考过程' : 'Thinking'}</summary>
                  <pre className="subagent-inspector-thinking-text">{stream.thinking}</pre>
                </details>
              ) : null}
              {stream.tools.length > 0 ? (
                <div className="subagent-inspector-tools">
                  {stream.tools.map((tool) => (
                    <SubagentToolRow key={tool.toolCallId} tool={tool} />
                  ))}
                </div>
              ) : null}
              {stream.text.length > 0 ? (
                <MarkdownView
                  text={stream.text}
                  renderingPhase={isLive ? 'streaming' : 'completed'}
                  artifactPreviewEnabled={false}
                />
              ) : null}
              {isLive ? (
                <span className="subagent-stream-cursor" aria-hidden="true">
                  ▋
                </span>
              ) : null}
            </div>
          );
        })()}

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
