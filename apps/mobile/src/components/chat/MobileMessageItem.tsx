import { useMemo, useState, type ReactElement } from 'react';
import { IconSpark, IconCopy, IconCheck } from '@piwin/ui-kit';
import { MobileMarkdown } from './MobileMarkdown.js';
import { MobileThinkingBlock } from './MobileThinkingBlock.js';
import { MobileToolChain } from './MobileToolChain.js';
import { MobileArtifactPending, MobileArtifactStage } from './MobileArtifactStage.js';
import { useHaptics } from '../../hooks/use-haptics.js';
import { useTts } from '../../hooks/use-tts.js';
import { partitionMobileTranscript } from '../../mobile-transcript-segments.js';
import type { MobileTranscriptMessage } from '../../hooks/use-mobile-host.js';

type MobileMessageItemProps = {
  message: MobileTranscriptMessage;
  htmlUiModeEnabled: boolean;
};

export function MobileMessageItem({
  message,
  htmlUiModeEnabled,
}: MobileMessageItemProps): ReactElement | null {
  const [copied, setCopied] = useState(false);
  const haptics = useHaptics();
  const tts = useTts();
  const isSpeaking = tts.isSpeaking && tts.currentSpeakingId === message.id;

  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';
  const isStreaming = message.status === 'streaming';
  const text = message.text.trim();
  const thinking = message.thinking;
  const toolCalls = message.toolCalls;

  const hasTools = Boolean(toolCalls && toolCalls.length > 0);
  const hasThinking = Boolean(thinking && thinking.trim().length > 0);
  const segments = useMemo(() => {
    if (!isAssistant) {
      return [];
    }
    if (!htmlUiModeEnabled) {
      return message.text.trim().length > 0
        ? [{ kind: 'markdown' as const, text: message.text }]
        : [];
    }
    return partitionMobileTranscript(message.text, isStreaming);
  }, [htmlUiModeEnabled, isAssistant, isStreaming, message.text]);

  if (text.length === 0 && !isStreaming && !hasThinking && !hasTools) {
    return null;
  }

  const handleCopyMessage = async () => {
    try {
      await navigator.clipboard.writeText(message.text);
      haptics.tap();
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard is best-effort on WKWebView
    }
  };

  const handleToggleTts = () => {
    haptics.tap();
    tts.speak(message.text, message.id);
  };

  return (
    <article className={`modern-chat-turn ${message.role} ${isStreaming ? 'is-streaming' : ''}`}>
      {isUser ? (
        <div className="modern-user-bubble-wrapper">
          <div className="modern-user-bubble">
            {message.attachments && message.attachments.length > 0 ? (
              <div className="modern-user-attachments-grid">
                {message.attachments.map((att) => (
                  <div key={att.id} className="modern-user-attachment-chip">
                    <span className="att-icon" aria-hidden="true">
                      🖼️
                    </span>
                    <span className="att-name">{att.name ?? '图片附件'}</span>
                  </div>
                ))}
              </div>
            ) : null}
            {message.text ? <p className="modern-user-text">{message.text}</p> : null}
          </div>
        </div>
      ) : (
        <div className="modern-assistant-turn-wrapper">
          <div className="modern-assistant-header">
            <div className="modern-agent-badge">
              <div className="modern-agent-spark-icon">
                <IconSpark size={13} />
              </div>
              <span className="modern-agent-name">
                {isAssistant ? 'Piwin Agent' : message.role.toUpperCase()}
              </span>
            </div>

            <div className="modern-turn-actions">
              {isStreaming ? (
                <span className="modern-streaming-indicator">
                  <span className="modern-pulse-dot" />
                  <span>生成中…</span>
                </span>
              ) : (
                <>
                  {text.length > 0 ? (
                    <button
                      type="button"
                      className={`modern-tts-turn-btn ${isSpeaking ? 'speaking' : ''}`}
                      onClick={handleToggleTts}
                      aria-label={isSpeaking ? '停止朗读' : '朗读回复'}
                    >
                      {isSpeaking ? (
                        <span className="tts-wave-bars">
                          <span className="tts-bar b1" />
                          <span className="tts-bar b2" />
                          <span className="tts-bar b3" />
                        </span>
                      ) : (
                        <span className="tts-icon" aria-hidden="true">
                          🔊
                        </span>
                      )}
                    </button>
                  ) : null}

                  <button
                    type="button"
                    className="modern-copy-turn-btn"
                    onClick={() => void handleCopyMessage()}
                    aria-label="复制消息"
                  >
                    {copied ? <IconCheck size={13} className="copied-icon" /> : <IconCopy size={13} />}
                  </button>
                </>
              )}
            </div>
          </div>

          {hasThinking && thinking ? (
            <MobileThinkingBlock
              thinking={thinking}
              isStreaming={isStreaming && text.length === 0 && !hasTools}
            />
          ) : null}

          {hasTools ? <MobileToolChain tools={toolCalls} isStreaming={isStreaming} /> : null}

          {segments.length > 0 || (isStreaming && !hasTools && !hasThinking) ? (
            <div className="modern-assistant-content">
              {segments.length === 0 ? (
                <MobileMarkdown content={isStreaming ? '…' : ''} isStreaming={isStreaming} />
              ) : (
                segments.map((segment, index) => {
                  if (segment.kind === 'markdown') {
                    return (
                      <MobileMarkdown
                        key={`md-${index}`}
                        content={segment.text}
                        isStreaming={isStreaming}
                      />
                    );
                  }
                  if (segment.kind === 'artifact-pending') {
                    return <MobileArtifactPending key={`pending-${index}`} title={segment.title} />;
                  }
                  return <MobileArtifactStage key={segment.preview.id} preview={segment.preview} />;
                })
              )}
            </div>
          ) : null}
        </div>
      )}
    </article>
  );
}
