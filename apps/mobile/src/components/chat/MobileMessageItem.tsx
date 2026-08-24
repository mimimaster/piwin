import { useMemo, useState, type ReactElement } from 'react';
import { IconSpark, IconCopy, IconCheck } from '@piwin/ui-kit';
import { MobileMarkdown } from './MobileMarkdown.js';
import { MobileThinkingBlock } from './MobileThinkingBlock.js';
import { MobileToolChain } from './MobileToolChain.js';
import { MobileArtifactCard } from './MobileArtifactCard.js';
import { MobileArtifactSheet } from '../modals/MobileArtifactSheet.js';
import { useHaptics } from '../../hooks/use-haptics.js';
import { useTts } from '../../hooks/use-tts.js';
import {
  collectMobileArtifacts,
  mobileArtifactBlockedCopy,
  mobileArtifactSrcdoc,
} from '../../mobile-artifact-preview.js';
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
  const artifacts = useMemo(
    () =>
      isAssistant && !isStreaming ? collectMobileArtifacts(message.text, htmlUiModeEnabled) : [],
    [htmlUiModeEnabled, isAssistant, isStreaming, message.text],
  );
  const [openArtifactId, setOpenArtifactId] = useState<string | undefined>();
  const openArtifact = artifacts.find((item) => item.id === openArtifactId);

  // Filter out empty non-streaming message turns
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
      // ignore
    }
  };

  const handleToggleTts = () => {
    haptics.tap();
    tts.speak(message.text, message.id);
  };

  return (
    <article className={`modern-chat-turn ${message.role} ${isStreaming ? 'is-streaming' : ''}`}>
      {isUser ? (
        // ── User Message Turn ──
        <div className="modern-user-bubble-wrapper">
          <div className="modern-user-bubble">
            {message.attachments && message.attachments.length > 0 ? (
              <div className="modern-user-attachments-grid">
                {message.attachments.map((att) => (
                  <div key={att.id} className="modern-user-attachment-chip">
                    <span className="att-icon">🖼️</span>
                    <span className="att-name">{att.name ?? '图片附件'}</span>
                  </div>
                ))}
              </div>
            ) : null}
            {message.text ? <p className="modern-user-text">{message.text}</p> : null}
          </div>
        </div>
      ) : (
        // ── Assistant / System Message Turn ──
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
                        <span className="tts-icon">🔊</span>
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

          {/* 1. Thinking Block */}
          {hasThinking ? (
            <MobileThinkingBlock
              thinking={thinking!}
              isStreaming={isStreaming && text.length === 0 && !hasTools}
            />
          ) : null}

          {/* 2. Tool Call Execution Chain */}
          {hasTools ? (
            <MobileToolChain tools={toolCalls} isStreaming={isStreaming} />
          ) : null}

          {/* 3. Assistant Markdown Stream */}
          {text.length > 0 || (isStreaming && !hasTools && !hasThinking) ? (
            <div className="modern-assistant-content">
              <MobileMarkdown
                content={message.text || (isStreaming ? '…' : '')}
                isStreaming={isStreaming}
              />
            </div>
          ) : null}

          {artifacts.map((item) => (
            <MobileArtifactCard
              key={item.id}
              title={item.title}
              language={item.language}
              onOpenPreview={() => setOpenArtifactId(item.id)}
            />
          ))}

          <MobileArtifactSheet
            isOpen={openArtifact !== undefined}
            onClose={() => setOpenArtifactId(undefined)}
            title={openArtifact?.title}
            srcdoc={openArtifact ? mobileArtifactSrcdoc(openArtifact.plan) : undefined}
            blockedReason={
              openArtifact?.plan.kind === 'blocked'
                ? mobileArtifactBlockedCopy(openArtifact.plan.reason)
                : undefined
            }
          />
        </div>
      )}
    </article>
  );
}
