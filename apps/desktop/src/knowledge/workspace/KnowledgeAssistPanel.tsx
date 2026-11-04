import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react';
import type { HostCommand, HostPush, KnowledgeContextRef } from '@piwin/contracts';
import { Spinner } from '@piwin/ui-kit';
import type { KnowledgeBasesRequest } from '../use-knowledge-bases.js';
import {
  applyAssistPush,
  buildKnowledgeAssistCreateInput,
  buildKnowledgeAssistPromptInput,
  buildKnowledgeAssistWikiWriteInput,
  defaultKnowledgeAssistPrompt,
  emptyKnowledgeAssistState,
  messagesFromResume,
  runIdFromResponseData,
  sessionIdFromResponseData,
  type KnowledgeAssistViewState,
} from './knowledge-assist-session.js';

export type KnowledgeAssistPanelProps = {
  locale: 'zh-CN' | 'en';
  request: KnowledgeBasesRequest;
  subscribePush?: ((listener: (push: HostPush) => void) => () => void) | undefined;
  subscribeConnected?: ((listener: (connected: boolean) => void) => () => void) | undefined;
  projectPath?: string | null | undefined;
  baseId: string;
  documentTitle: string;
  sessionId: string | null;
  onSessionId: (sessionId: string) => void;
  pendingRef: KnowledgeContextRef | null;
  onConsumedPendingRef: () => void;
};

/**
 * Independent reading-assist conversation: a normal Host session with no
 * parent, so it never inherits the main transcript. Streaming, stop and
 * resume use the same session/* commands as chat.
 */
export function KnowledgeAssistPanel(props: KnowledgeAssistPanelProps): ReactElement {
  const t = (en: string, cn: string) => (props.locale === 'zh-CN' ? cn : en);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<KnowledgeAssistViewState>(emptyKnowledgeAssistState);
  const sessionIdRef = useRef(props.sessionId);
  const runIdRef = useRef<string | null>(null);
  const sendingRef = useRef(false);
  const autoKeyRef = useRef<string | null>(null);
  const lastContextRef = useRef<KnowledgeContextRef | null>(null);
  const [savedSlug, setSavedSlug] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  runIdRef.current = state.runId;

  useEffect(() => {
    if (props.sessionId) sessionIdRef.current = props.sessionId;
  }, [props.sessionId]);

  const resumeSession = useCallback(
    async (sessionId: string): Promise<void> => {
      const response = await props.request({ type: 'session/resume', sessionId });
      if (!response.success) {
        setError(response.error);
        return;
      }
      const data = response.data as { messages?: unknown; activeRun?: { id?: unknown } };
      const messages = Array.isArray(data.messages)
        ? messagesFromResume(data.messages as Parameters<typeof messagesFromResume>[0])
        : [];
      const activeRunId =
        data.activeRun && typeof data.activeRun.id === 'string' ? data.activeRun.id : null;
      setState({
        messages,
        running: activeRunId !== null,
        runId: activeRunId,
      });
      setError(null);
    },
    [props.request],
  );

  useEffect(() => {
    if (!props.sessionId) return;
    void resumeSession(props.sessionId);
  }, [props.sessionId, resumeSession]);

  useEffect(() => {
    if (!props.subscribePush) return undefined;
    return props.subscribePush((push) => {
      const sessionId = sessionIdRef.current;
      if (!sessionId) return;
      setState((current) => applyAssistPush(current, push, sessionId));
    });
  }, [props.subscribePush]);

  useEffect(() => {
    if (!props.subscribeConnected) return undefined;
    let wasConnected = true;
    return props.subscribeConnected((connected) => {
      const sessionId = sessionIdRef.current;
      if (wasConnected && !connected) {
        wasConnected = false;
        return;
      }
      if (!wasConnected && connected && sessionId) {
        wasConnected = true;
        void resumeSession(sessionId);
        return;
      }
      wasConnected = connected;
    });
  }, [props.subscribeConnected, resumeSession]);

  const ensureSession = useCallback(async (): Promise<string | null> => {
    if (sessionIdRef.current) return sessionIdRef.current;
    const created = await props.request({
      type: 'session/create',
      input: buildKnowledgeAssistCreateInput({
        projectPath: props.projectPath,
        baseId: props.baseId,
        title: props.documentTitle,
        locale: props.locale,
      }),
    });
    if (!created.success) {
      setError(created.error);
      return null;
    }
    const sessionId = sessionIdFromResponseData(created.data);
    if (!sessionId) {
      setError(
        props.locale === 'zh-CN' ? 'Host 没有返回会话' : 'The Host did not return a session',
      );
      return null;
    }
    sessionIdRef.current = sessionId;
    props.onSessionId(sessionId);
    return sessionId;
  }, [
    props.request,
    props.projectPath,
    props.baseId,
    props.documentTitle,
    props.locale,
    props.onSessionId,
  ]);

  const consumePendingRef = props.onConsumedPendingRef;
  const send = useCallback(
    async (text: string, contextRef: KnowledgeContextRef | null): Promise<void> => {
      const promptText = text.trim() || defaultKnowledgeAssistPrompt(props.locale);
      if (!promptText && !contextRef) return;
      if (sendingRef.current) return;
      sendingRef.current = true;
      if (contextRef) lastContextRef.current = contextRef;
      setError(null);
      setSavedSlug(null);
      try {
        const sessionId = await ensureSession();
        if (!sessionId) return;
        const prompted = await props.request({
          type: 'session/prompt',
          sessionId,
          input: buildKnowledgeAssistPromptInput({ text: promptText, contextRef }),
        } satisfies HostCommand);
        if (!prompted.success) {
          setError(prompted.error);
          return;
        }
        const runId = runIdFromResponseData(prompted.data);
        const userId = `local-${crypto.randomUUID()}`;
        setState((current) => ({
          messages: [
            ...current.messages,
            { id: userId, role: 'user', text: promptText },
          ],
          running: true,
          runId,
        }));
        setDraft('');
        consumePendingRef();
      } finally {
        sendingRef.current = false;
      }
    },
    [consumePendingRef, ensureSession, props.locale, props.request],
  );

  useEffect(() => {
    if (!props.pendingRef) return;
    const key = `${props.pendingRef.relativePath}:${props.pendingRef.lineStart ?? ''}:${props.pendingRef.snapshotText ?? ''}`;
    if (autoKeyRef.current === key) return;
    autoKeyRef.current = key;
    void send(defaultKnowledgeAssistPrompt(props.locale), props.pendingRef);
  }, [props.locale, props.pendingRef, send]);

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    void send(draft, props.pendingRef);
  };

  const onStop = (): void => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    void props.request({
      type: 'session/abort',
      sessionId,
      ...(runIdRef.current ? { runId: runIdRef.current } : {}),
    });
  };

  const lastAssistant = [...state.messages]
    .reverse()
    .find((message) => message.role === 'assistant' && message.text.trim().length > 0);

  const onSaveNote = (): void => {
    if (!lastAssistant || saving) return;
    setSaving(true);
    setError(null);
    void (async () => {
      try {
        const written = await props.request({
          type: 'knowledge/wiki/write',
          input: buildKnowledgeAssistWikiWriteInput({
            documentTitle: props.documentTitle,
            answer: lastAssistant.text,
            contextRef: lastContextRef.current,
          }),
        });
        if (!written.success) {
          setError(written.error);
          return;
        }
        const slug = (written.data as { concept?: { slug?: unknown } }).concept?.slug;
        setSavedSlug(typeof slug === 'string' ? slug : lastAssistant.id);
      } finally {
        setSaving(false);
      }
    })();
  };

  return (
    <aside className="kw-assist" data-testid="knowledge-assist-panel">
      <header className="kw-assist-head">
        <h2 className="kw-assist-title">{t('Reading assistant', '助读')}</h2>
        <p className="kw-assist-hint">
          {t('Separate from the main chat. Range stays this document.', '独立于主会话，范围只覆盖这篇资料。')}
        </p>
      </header>
      <div className="kw-assist-log" data-testid="knowledge-assist-log">
        {state.messages.length === 0 ? (
          <p className="kw-assist-empty">{t('Ask about this page or a selection.', '问问本页，或划一段再问。')}</p>
        ) : (
          state.messages.map((message) => (
            <div
              key={message.id}
              className={`kw-assist-msg is-${message.role}`}
              data-testid="knowledge-assist-message"
              data-role={message.role}
            >
              {message.text}
            </div>
          ))
        )}
        {state.running ? <Spinner label={t('Answering…', '正在回答…')} /> : null}
      </div>
      {error ? (
        <p className="kw-assist-error" role="alert" data-testid="knowledge-assist-error">
          {error}
        </p>
      ) : null}
      <form className="kw-assist-form" onSubmit={onSubmit}>
        <textarea
          className="kw-assist-input"
          data-testid="knowledge-assist-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={3}
          placeholder={t('Ask about the passage…', '针对这段提问…')}
        />
        <div className="kw-assist-actions">
          {lastAssistant && !state.running ? (
            <button
              type="button"
              className="kw-btn kw-btn-sm"
              data-testid="knowledge-assist-save-note"
              disabled={saving || savedSlug !== null}
              onClick={onSaveNote}
            >
              {savedSlug
                ? t('Saved to Wiki', '已存入 Wiki')
                : saving
                  ? t('Saving…', '保存中…')
                  : t('Save note', '存笔记')}
            </button>
          ) : null}
          {state.running ? (
            <button
              type="button"
              className="kw-btn kw-btn-sm"
              data-testid="knowledge-assist-stop"
              onClick={onStop}
            >
              {t('Stop', '停止')}
            </button>
          ) : (
            <button type="submit" className="kw-btn kw-btn-sm" data-testid="knowledge-assist-send">
              {t('Send', '发送')}
            </button>
          )}
        </div>
      </form>
    </aside>
  );
}
