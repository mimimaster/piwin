/**
 * Side Chat panel — quick scratchpad for ideas or follow-up prompts.
 * Messages are persisted per session in sessionStorage. This is a local
 * notepad; connecting it to the AI host requires a separate session/contract
 * design and is intentionally left as the next step.
 */

import { useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { Button } from '@piwin/ui-kit';

type SideChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  at: string;
};

export type SideChatPanelProps = {
  /** Optional session id to scope the scratchpad. */
  sessionId?: string | null;
};

export function SideChatPanel(props: SideChatPanelProps): ReactElement {
  const storageKey = `piwin.desktop.sideChat.${props.sessionId ?? 'global'}`;
  const endRef = useRef<HTMLDivElement | null>(null);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<SideChatMessage[]>(() => {
    try {
      const stored = sessionStorage.getItem(storageKey);
      if (stored) return JSON.parse(stored) as SideChatMessage[];
    } catch {
      /* ignore corrupt storage */
    }
    return [];
  });

  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(messages));
    } catch {
      /* ignore */
    }
  }, [messages, storageKey]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    const text = input.trim();
    if (!text) return;
    const userMessage: SideChatMessage = {
      id: `${Date.now()}-u`,
      role: 'user',
      text,
      at: new Date().toISOString(),
    };
    setMessages((current) => [...current, userMessage]);
    setInput('');
  }

  return (
    <div className="side-chat-panel" data-testid="side-chat-panel">
      <div className="side-chat-messages" role="log" aria-live="polite">
        {messages.length === 0 ? (
          <div className="muted side-chat-empty">Type quick notes or draft prompts here.</div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={message.role === 'user' ? 'side-chat-message user' : 'side-chat-message'}
              data-testid={`side-chat-message-${message.role}`}
            >
              <div className="side-chat-bubble">{message.text}</div>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>
      <form className="side-chat-composer" onSubmit={handleSubmit}>
        <input
          className="side-chat-input"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Note or prompt…"
          aria-label="Side chat input"
          spellCheck={false}
          autoComplete="off"
        />
        <Button type="submit" data-testid="side-chat-send" disabled={!input.trim()}>
          Send
        </Button>
      </form>
    </div>
  );
}
