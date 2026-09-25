import { useState, type ReactElement } from 'react';
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
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | undefined>();

  const answer = (value: ExtensionUiAnswer): void => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    onAnswer(value)
      .then((ok) => {
        if (!ok) setError('Host 没有接受这个回答，请重试。');
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : '发送回答失败。');
      })
      .finally(() => setBusy(false));
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
