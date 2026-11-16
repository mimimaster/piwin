/**
 * Headerless top group of `SessionStatusPanel`: human session title (with
 * hover copy-ID affordance), flat system-prompt / Purge row, and flat external
 * plugin status rows. Zero nested boxes, zero pill borders.
 */
import { useEffect, useState, type ReactElement } from 'react';
import type {
  PluginStatusRowView,
  PromptRowView,
  SessionHeaderRowView,
} from './session-status-model.js';

function useCopyFeedback(): {
  copiedKey: string | null;
  copy: (key: string, value: string) => void;
} {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    if (copiedKey === null) return;
    const timer = window.setTimeout(() => setCopiedKey(null), 1400);
    return () => window.clearTimeout(timer);
  }, [copiedKey]);

  const copy = (key: string, value: string): void => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        void navigator.clipboard.writeText(value).catch(() => undefined);
      }
    } catch {
      // Clipboard API may be unavailable in tests or restricted origins.
    }
    setCopiedKey(key);
  };

  return { copiedKey, copy };
}

function promptDotClass(tone: PromptRowView['tone']): string {
  if (tone === 'warning') return 'is-failed';
  if (tone === 'override') return 'is-override';
  return 'is-context';
}

function pluginDotClass(tone: PluginStatusRowView['tone']): string {
  if (tone === 'warning') return 'is-warn';
  if (tone === 'ready') return 'is-ready';
  return 'is-context';
}

export function SessionStatusTopGroup(props: {
  session: SessionHeaderRowView | null;
  prompt: PromptRowView | null;
  plugins: readonly PluginStatusRowView[];
  zh: boolean;
}): ReactElement | null {
  const { session, prompt, plugins, zh } = props;
  const { copiedKey, copy } = useCopyFeedback();

  if (session === null && prompt === null && plugins.length === 0) {
    return null;
  }

  const promptLabel = zh ? '系统提示词' : 'System prompt';
  const copiedLabel = zh ? '已复制 ✓' : 'Copied ✓';

  return (
    <div
      className="session-status-group is-headerless"
      data-testid="session-status-overview"
    >
      <ul className="session-status-list">
        {session !== null ? (
          <li className="session-status-row" role="listitem">
            {session.copyId ? (
              <button
                type="button"
                className="session-status-row-main"
                data-testid="session-status-session-row"
                title={
                  zh
                    ? `${session.title}\n点击复制会话 ID 供排障使用`
                    : `${session.title}\nClick to copy session ID`
                }
                onClick={() => copy('session', session.copyId ?? '')}
              >
                <span className="session-status-row-icon" aria-hidden="true">
                  <svg viewBox="0 0 16 16" width="13" height="13" fill="none">
                    <path
                      d="M3 4.5C3 3.67 3.67 3 4.5 3h7c.83 0 1.5.67 1.5 1.5v5c0 .83-.67 1.5-1.5 1.5H7l-3 2.5V11h-.5C2.67 11 2 10.33 2 9.5v-5z"
                      stroke="currentColor"
                      strokeWidth="1.3"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <span className="session-status-row-title is-session-name">
                  {session.title}
                </span>
                <span
                  className={`session-status-copy-hint${copiedKey === 'session' ? ' is-copied' : ''}`}
                >
                  {copiedKey === 'session'
                    ? copiedLabel
                    : zh
                      ? '复制 ID'
                      : 'Copy ID'}
                </span>
              </button>
            ) : (
              <span className="session-status-row-static" data-testid="session-status-session-row">
                <span className="session-status-row-icon" aria-hidden="true">
                  <svg viewBox="0 0 16 16" width="13" height="13" fill="none">
                    <path
                      d="M3 4.5C3 3.67 3.67 3 4.5 3h7c.83 0 1.5.67 1.5 1.5v5c0 .83-.67 1.5-1.5 1.5H7l-3 2.5V11h-.5C2.67 11 2 10.33 2 9.5v-5z"
                      stroke="currentColor"
                      strokeWidth="1.3"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <span className="session-status-row-title is-session-name">
                  {session.title}
                </span>
              </span>
            )}
          </li>
        ) : null}

        {prompt !== null ? (
          <li className="session-status-row" role="listitem">
            {prompt.activePath ? (
              <button
                type="button"
                className="session-status-row-main"
                data-testid="session-status-prompt-row"
                data-active-prompt-path={prompt.activePath}
                title={prompt.tooltip}
                onClick={() => copy('prompt', prompt.activePath ?? '')}
              >
                <i
                  className={`session-status-dot ${promptDotClass(prompt.tone)}`}
                  aria-hidden="true"
                />
                <span className="session-status-row-title">{promptLabel}</span>
                <span
                  className={`session-status-row-meta${prompt.isMonoMeta && copiedKey !== 'prompt' ? ' is-mono' : ''}`}
                  data-testid="session-status-active-prompt-path"
                >
                  {copiedKey === 'prompt' ? copiedLabel : prompt.meta}
                </span>
              </button>
            ) : (
              <span
                className="session-status-row-static"
                data-testid="session-status-prompt-row"
                title={prompt.tooltip}
              >
                <i
                  className={`session-status-dot ${promptDotClass(prompt.tone)}`}
                  aria-hidden="true"
                />
                <span className="session-status-row-title">{promptLabel}</span>
                <span
                  className={`session-status-row-meta${prompt.isMonoMeta ? ' is-mono' : ''}`}
                >
                  {prompt.meta}
                </span>
              </span>
            )}
          </li>
        ) : null}

        {plugins.map((plugin) => (
          <li key={plugin.id} className="session-status-row" role="listitem">
            <span
              className="session-status-row-static"
              data-testid={`session-status-plugin-${plugin.id}`}
              title={plugin.tooltip}
            >
              <i
                className={`session-status-dot ${pluginDotClass(plugin.tone)}`}
                aria-hidden="true"
              />
              <span className="session-status-row-title">{plugin.title}</span>
              <span
                className={`session-status-row-meta${plugin.isMonoMeta ? ' is-mono' : ''}${plugin.tone === 'warning' ? ' is-warn' : ''}`}
              >
                {plugin.meta}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
