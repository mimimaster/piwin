import { useCallback, useEffect, useMemo, useState } from 'react';
import type { HostResponse, PromptTemplateSummary, PromptsListData } from '@piwin/contracts';
import { Button, Notice, Spinner, Switch, TextInput } from '@piwin/ui-kit';
import { useDesktopLocale } from './desktop-locale-context';
import { PageTitle } from './settings/page-title';

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
  const { locale } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';
  const [prompts, setPrompts] = useState<PromptTemplateSummary[]>([]);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadPrompts = useCallback(async () => {
    setLoading(true);
    setError(null);
    const command: { type: 'skills/list'; projectPath?: string } = { type: 'prompts/list' as any };
    if (props.projectPath) {
      command.projectPath = props.projectPath;
    }
    const response = await props.request(command as any);
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
    const response = await props.request({
      type: 'prompts/set_enabled',
      promptId: prompt.id,
      enabled: !prompt.enabled,
    });
    if (!response.success) {
      setError(response.error);
      return;
    }
    setPrompts((prev) => prev.map((p) => (p.id === prompt.id ? { ...p, enabled: !p.enabled } : p)));
  }

  return (
    <div
      className={props.variant === 'inline' ? 'settings-inline-manager' : 'modal-backdrop'}
      data-testid="prompts-panel"
    >
      <div
        className={props.variant === 'inline' ? 'settings-inline-content' : 'modal settings-modal'}
      >
        <PageTitle
          title={isChinese ? 'Prompt 模板' : 'Prompt Templates'}
          description={
            isChinese
              ? 'Markdown 片段位于 ~/.piwin/prompts。在 Pi 交互模式中可通过 /name 展开。'
              : 'Markdown snippets under ~/.piwin/prompts. Expand via /name in interactive mode.'
          }
        />

        <div className="settings-toolbar" style={{ marginBottom: 20 }}>
          <TextInput
            toolbar
            value={filter}
            onChange={(event) => setFilter(event.currentTarget.value)}
            placeholder={
              isChinese
                ? '搜索模板：名称、ID 或描述…'
                : 'Search templates by name, id, or description…'
            }
            aria-label={isChinese ? '搜索模板' : 'Search templates'}
          />
          <Button size="compact" onClick={() => void loadPrompts()}>
            {isChinese ? '刷新' : 'Refresh'}
          </Button>
        </div>

        {loading && (
          <div style={{ padding: '20px', textAlign: 'center' }}>
            <Spinner />
          </div>
        )}
        {error ? (
          <div className="ui-feedback-host" aria-live="polite">
            <Notice tone="error">{error}</Notice>
          </div>
        ) : null}

        <ul className="ext-list">
          {visible.length === 0 && !loading ? (
            <li className="muted" style={{ textAlign: 'center', padding: '40px' }}>
              {isChinese ? '暂无模板' : 'No templates found'}
            </li>
          ) : (
            visible.map((prompt) => (
              <li key={prompt.id} className="ext-list-item">
                <div className="ext-list-main">
                  <div className="ext-list-title">
                    <strong>{prompt.name}</strong>
                    <code style={{ fontSize: '11px', opacity: 0.6 }}>/{prompt.id}</code>
                  </div>
                  <div className="muted ext-desc">{prompt.description}</div>
                </div>
                <Switch
                  checked={prompt.enabled}
                  onCheckedChange={() => void handleToggle(prompt)}
                  aria-label={isChinese ? `启用 ${prompt.name}` : `Enable ${prompt.name}`}
                />
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
