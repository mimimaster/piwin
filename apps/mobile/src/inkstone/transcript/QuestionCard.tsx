import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { ExtensionUiAnswer, ExtensionUiPrompt } from '../host/use-session-live-state.js';

/**
 * Host extension UI (`extension/ui_request`) on the ink line: the agent is
 * blocked on this answer. select → option list, confirm → 是/否, input → text.
 * The phone only relays the choice through `extension/ui_resolve`.
 */
export function QuestionCard({
  prompt,
  onAnswer,
}: {
  prompt: ExtensionUiPrompt;
  onAnswer: (answer: ExtensionUiAnswer) => Promise<boolean>;
}): ReactElement {
  const ownerRef = useRef({ prompt, onAnswer, active: true, pending: false });
  if (ownerRef.current.prompt !== prompt || ownerRef.current.onAnswer !== onAnswer) {
    ownerRef.current = { prompt, onAnswer, active: true, pending: false };
  }
  const owner = ownerRef.current;
  const [busyOwner, setBusyOwner] = useState<object | undefined>();
  const [draft, setDraft] = useState('');
  const [failure, setFailure] = useState<{ owner: object; message: string } | undefined>();
  const busy = busyOwner === owner;
  const error = failure?.owner === owner ? failure.message : undefined;
  useEffect(() => {
    owner.active = true;
    setDraft('');
    return () => { owner.active = false; };
  }, [owner]);

  const answer = (value: ExtensionUiAnswer): void => {
    if (!owner.active || owner.pending) return;
    owner.pending = true;
    setBusyOwner(owner);
    setFailure(undefined);
    const current = () => ownerRef.current === owner && owner.active;
    void onAnswer(value)
      .then((ok) => {
        if (current() && !ok) setFailure({ owner, message: 'Host 没有接受这个回答，请重试。' });
      })
      .catch((reason: unknown) => {
        if (current()) setFailure({ owner, message: reason instanceof Error ? reason.message : '发送回答失败。' });
      })
      .finally(() => {
        owner.pending = false;
        if (current()) setBusyOwner(undefined);
      });
  };

  return (
    <div className="tr-gate">
      <span className="node ask" aria-hidden="true" />
      <article className="gate question" aria-live="polite">
        <div className="mic">Agent 正等待你的回答</div>
        <h3>{prompt.title}</h3>
        {prompt.message !== undefined && prompt.message.length > 0 ? <p>{prompt.message}</p> : null}
        {prompt.kind === 'select' ? (
          <div className="option-list">
            {prompt.options.map((option, index) => (
              <button
                key={option}
                type="button"
                disabled={busy}
                onClick={() => answer({ kind: 'value', value: option })}
              >
                <kbd>{index + 1}</kbd>
                {option}
              </button>
            ))}
          </div>
        ) : null}
        {prompt.kind === 'input' ? (
          <textarea
            aria-label={prompt.title}
            disabled={busy}
            placeholder={prompt.placeholder ?? '写下你的回答'}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        ) : null}
        {error !== undefined ? <p className="error-text">{error}</p> : null}
        <div className="gate-row">
          <button
            className="text-link"
            type="button"
            disabled={busy}
            onClick={() => answer({ kind: 'cancel' })}
          >
            跳过这个问题
          </button>
          {prompt.kind === 'confirm' ? (
            <>
              <button
                className="seal-button ghost"
                type="button"
                disabled={busy}
                onClick={() => answer({ kind: 'confirm', confirmed: false })}
                aria-label="否"
              >
                否
              </button>
              <button
                className="seal-button"
                type="button"
                disabled={busy}
                onClick={() => answer({ kind: 'confirm', confirmed: true })}
                aria-label="是"
              >
                是
              </button>
            </>
          ) : null}
          {prompt.kind === 'input' ? (
            <button
              className="chip"
              type="button"
              disabled={busy || draft.trim().length === 0}
              onClick={() => answer({ kind: 'value', value: draft.trim() })}
            >
              回答
            </button>
          ) : null}
        </div>
      </article>
    </div>
  );
}
