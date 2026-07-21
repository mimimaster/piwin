import { useCallback, useEffect, useMemo, useState } from 'react';
import type { HostResponse, PromptTemplateSummary, PromptsListData } from '@piwin/contracts';

export type PromptsPanelProps = {
  projectPath: string | null;
  request: (command: {
    type: 'prompts/list' | 'prompts/set_enabled';
    projectPath?: string;
    promptId?: string;
    enabled?: boolean;
  }) => Promise<HostResponse>;
  onClose?: () => void;
  variant?: 'inline' | 'modal';
};

export function PromptsPanel(props: PromptsPanelProps) {
  const [prompts, setPrompts] = useState<PromptTemplateSummary[]>([]);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadPrompts = useCallback(async () => {
    setLoading(true);
    setError(null);
    const command: { type: 'prompts/list'; projectPath?: string } = { type: 'prompts/list' };
    if (props.projectPath) {
      command.projectPath = props.projectPath;
    }
    const response = await props.request(command);
    setLoading(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
    const data = response.data as PromptsListData;
    setPrompts(data.prompts ?? []);
  }, [props]);

  useEffect(() => {
    void loadPrompts();
  }, [loadPrompts]);

  const visible = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return prompts;
    return prompts.filter(
      (prompt) =>
        prompt.name.toLowerCase().includes(query) ||
        prompt.id.toLowerCase().includes(query) ||
        prompt.description.toLowerCase().includes(query),
    );
  }, [filter, prompts]);

  async function handleToggle(prompt: PromptTemplateSummary): Promise<void> {
    setBusyId(prompt.id);
    const response = await props.request({
      type: 'prompts/set_enabled',
      promptId: prompt.id,
      enabled: !prompt.enabled,
    });
    setBusyId(null);
    if (!response.success) {
      setError(response.error);
      return;
    }
    await loadPrompts();
  }

  return (
    <div
      className={props.variant === 'inline' ? 'settings-inline-manager' : 'modal-backdrop'}
      data-testid="prompts-panel"
    >
      <div className={props.variant === 'inline' ? 'settings-inline-content' : 'modal settings-modal'}>
        <h3>Prompt templates</h3>
        <p className="muted">
          Markdown snippets under <code>~/.piwin/prompts</code>. In Pi interactive mode these expand
          via <code>/name</code>. Enable/disable applies to <strong>new sessions</strong>.
        </p>
        <input
          className="text-input"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Search prompts…"
          data-testid="prompts-filter"
        />
        {loading ? <p className="muted">Loading…</p> : null}
        {error ? <div className="error-banner">{error}</div> : null}
        <ul className="ext-list" data-testid="prompts-list">
          {visible.length === 0 && !loading ? (
            <li className="muted">No prompt templates found</li>
          ) : (
            visible.map((prompt) => (
              <li
                key={prompt.id}
                className="ext-list-item"
                data-testid="prompt-item"
                data-prompt-id={prompt.id}
              >
                <div className="ext-list-main">
                  <div className="ext-list-title">
                    <strong>/{prompt.name}</strong>
                    <span className="pill">{prompt.source}</span>
                    <span className="pill">{prompt.enabled ? 'on' : 'off'}</span>
                  </div>
                  <div className="muted ext-desc">{prompt.description}</div>
                  <div className="muted ext-path">{prompt.path}</div>
                </div>
                <button
                  type="button"
                  className="btn"
                  data-testid="prompt-toggle-btn"
                  disabled={busyId === prompt.id}
                  onClick={() => void handleToggle(prompt)}
                >
                  {prompt.enabled ? 'Disable' : 'Enable'}
                </button>
              </li>
            ))
          )}
        </ul>
        <div className="manager-actions">
          <button type="button" className="btn" onClick={() => void loadPrompts()}>
            Refresh
          </button>
          {props.variant !== 'inline' ? (
            <button
              type="button"
              className="btn"
              data-testid="prompts-close-btn"
              onClick={props.onClose}
            >
              Close
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
