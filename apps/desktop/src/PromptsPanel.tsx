import { useCallback, useEffect, useMemo, useState } from 'react';
import type { HostResponse, PromptTemplateSummary, PromptsListData } from '@piwin/contracts';
import { Button, Field, Notice, Spinner } from '@piwin/ui-kit';
import { useDesktopLocale } from './desktop-locale-context';

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
  const { locale, translator } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';
  const common = translator.common;
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
        <h3>{isChinese ? '提示词模板' : 'Prompt templates'}</h3>
        <p className="muted">
          {isChinese ? (
            <>
              Markdown 片段位于 <code>~/.piwin/prompts</code>。在 Pi 交互模式中可通过 <code>/name</code> 展开。
              启用/停用对<strong>新会话</strong>生效。
            </>
          ) : (
            <>
              Markdown snippets under <code>~/.piwin/prompts</code>. In Pi interactive mode these expand
              via <code>/name</code>. Enable/disable applies to <strong>new sessions</strong>.
            </>
          )}
        </p>
        <Field label={isChinese ? '搜索提示词' : 'Search prompts'}>
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={isChinese ? '名称、ID 或描述…' : 'Name, id, or description…'}
            data-testid="prompts-filter"
          />
        </Field>
        {loading ? (
          <div className="panel-loading">
            <Spinner label={isChinese ? '正在加载提示词' : 'Loading prompts'} />
            <span className="muted">{common.loading}</span>
          </div>
        ) : null}
        {error ? <Notice tone="error">{error}</Notice> : null}
        <ul className="ext-list" data-testid="prompts-list">
          {visible.length === 0 && !loading ? (
            <li className="muted">
              {isChinese ? '未找到提示词模板' : 'No prompt templates found'}
            </li>
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
                <Button
                  data-testid="prompt-toggle-btn"
                  disabled={busyId === prompt.id}
                  onClick={() => void handleToggle(prompt)}
                >
                  {prompt.enabled ? common.disable : common.enable}
                </Button>
              </li>
            ))
          )}
        </ul>
        <div className="manager-actions">
          <Button onClick={() => void loadPrompts()}>
            {common.refresh}
          </Button>
          {props.variant !== 'inline' ? (
            <Button
              data-testid="prompts-close-btn"
              onClick={props.onClose}
            >
              {common.close}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
