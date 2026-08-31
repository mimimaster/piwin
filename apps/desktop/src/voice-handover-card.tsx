import { useState, type ReactElement, type ReactNode } from 'react';
import type { ChatMessageUi } from './chat-reducer';
import { IconCheck, IconCopy } from './shell-icons';

export type VoiceHandoverCardProps = {
  message: ChatMessageUi;
  locale?: 'zh-CN' | 'en';
  branchSwitcher?: ReactNode;
  onFeedback?: ((message: string, level: 'info' | 'success' | 'error') => void) | undefined;
};

export function VoiceHandoverCard(props: VoiceHandoverCardProps): ReactElement {
  const [copied, setCopied] = useState(false);
  const isChinese = props.locale !== 'en';
  const label = isChinese ? '语音委派' : 'Voice delegation';

  async function handleCopy(): Promise<void> {
    const payload = props.message.text.trim();
    if (!payload) return;
    try {
      await navigator.clipboard.writeText(payload);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
      props.onFeedback?.('Copied to clipboard', 'success');
    } catch {
      props.onFeedback?.('Could not copy to clipboard', 'error');
    }
  }

  return (
    <div className="voice-handover-card" data-testid="voice-handover-card">
      <div className="voice-handover-card-head">
        <span className="voice-handover-card-label" data-testid="user-message-voice-delegation">
          {label}
        </span>
        <button
          type="button"
          className="user-msg-btn"
          onClick={() => void handleCopy()}
          title="Copy"
          aria-label="Copy message"
          data-testid="message-copy-btn"
        >
          {copied ? <IconCheck /> : <IconCopy />}
        </button>
        {props.branchSwitcher}
      </div>
      {props.message.text ? (
        <div className="voice-handover-card-brief message-text">{props.message.text}</div>
      ) : null}
    </div>
  );
}
