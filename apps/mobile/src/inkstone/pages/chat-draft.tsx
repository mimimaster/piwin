import { useState, type ReactElement } from 'react';
import { useInkstone } from '../inkstone-context.js';
import type { InkstoneDraft } from '../inkstone-state.js';
import { TopBar } from '../inkstone-ui.js';
import type { InkstoneHostContextValue } from '../host/inkstone-host-context.js';
import { blockedByOfflineSnapshot } from '../host/offline-guard.js';
import { useWideLayout } from '../use-wide-layout.js';
import { ChatComposer } from './chat-composer.js';

interface DraftSuggestion {
  text: string;
  /** Ticks Apple Health for this turn when the phone can provide it. */
  withHealth?: boolean;
}

const CHAT_SUGGESTIONS: DraftSuggestion[] = [
  { text: '帮我看看这周的睡眠和步数', withHealth: true },
  { text: '把这段话改得更口语一点：' },
  { text: '给我排一个轻松的周末计划' },
];

const AGENT_SUGGESTIONS: DraftSuggestion[] = [
  { text: '审阅最近的变更，先列出问题和建议' },
  { text: '把这个想法整理成一份实施计划：' },
  { text: '找出项目里的 TODO，按优先级分类' },
];

/**
 * A blank conversation, opened straight from + with the keyboard up. Nothing
 * exists on the Host until the first message: sending creates the session in
 * the draft's half (general scope, or the chosen project) and hands the text
 * to the new session page, which sends it once that session is ready.
 */
export function DraftChat({
  hostCtx,
  draft,
}: {
  hostCtx: InkstoneHostContextValue;
  draft: InkstoneDraft;
}): ReactElement {
  const { dispatch } = useInkstone();
  const wide = useWideLayout();
  const { host } = hostCtx;
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const project =
    draft.mode === 'agent'
      ? host.projects.find((item) => item.projectId === draft.projectId)
      : undefined;
  const suggestions = draft.mode === 'agent' ? AGENT_SUGGESTIONS : CHAT_SUGGESTIONS;

  const send = (): void => {
    const message = text.trim();
    if (busy || message.length === 0 || blockedByOfflineSnapshot(hostCtx, dispatch)) return;
    setBusy(true);
    void (async (): Promise<void> => {
      try {
        const sessionId = await host.handleCreateSession(project?.projectId);
        // A failed create keeps the text here; the Host error reaches the toast.
        if (sessionId === undefined) return;
        dispatch({ type: 'draft-created', sessionId, text: message });
      } finally {
        setBusy(false);
      }
    })();
  };

  const pickSuggestion = (suggestion: DraftSuggestion): void => {
    setText(suggestion.text);
    if (suggestion.withHealth === true && host.healthEnabled) {
      host.setIncludeAppleHealth(true);
    }
  };

  return (
    <>
      <TopBar
        title={draft.mode === 'agent' ? '新 Agent 任务' : '新对话'}
        subtitle={draft.mode === 'agent' ? (project?.displayName ?? '没有项目 · 按对话开始') : '发出第一句后保存'}
        {...(wide ? {} : { onBack: () => dispatch({ type: 'navigate', route: 'sessions' }) })}
      />
      <div className="screen-scroll chat-scroll">
        <div className="draft-empty">
          <h2>{draft.mode === 'agent' ? '要 Agent 做什么？' : '今天想聊点什么？'}</h2>
          <div className="draft-suggestions">
            {suggestions
              .filter((suggestion) => suggestion.withHealth !== true || host.healthEnabled)
              .map((suggestion) => (
                <button
                  className="chip"
                  key={suggestion.text}
                  type="button"
                  onClick={() => pickSuggestion(suggestion)}
                >
                  {suggestion.text}
                </button>
              ))}
          </div>
        </div>
      </div>
      <ChatComposer
        hostCtx={hostCtx}
        mode={draft.mode}
        draft={{
          text,
          setText,
          projectLabel: project?.displayName,
          busy,
          onSend: send,
        }}
      />
    </>
  );
}
