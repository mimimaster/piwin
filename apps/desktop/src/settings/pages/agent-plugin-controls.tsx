import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type { AgentPluginInstallation, HostCommand, HostResponse } from '@piwin/contracts';
import { Button, Notice, TextInput } from '@piwin/ui-kit';
import { useConfirmDialog } from '../../use-confirm-dialog';

type Request = (command: HostCommand) => Promise<HostResponse>;

/** Installed state is independent of readiness; reads never probe the CLI. */
export function AgentPluginControls(props: { request?: Request; isZh: boolean; onChanged: () => Promise<void> }): ReactElement {
  const [plugins, setPlugins] = useState<AgentPluginInstallation[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [binaryPath, setBinaryPath] = useState('');
  const confirm = useConfirmDialog();
  const t = (en: string, zh: string) => props.isZh ? zh : en;
  const request = props.request;
  const load = useCallback(async () => {
    if (!request) return;
    const response = await request({ type: 'agents/list' });
    if (!response.success) throw new Error(response.error);
    const data = response.data as { plugins?: AgentPluginInstallation[] } | undefined;
    if (!Array.isArray(data?.plugins)) return;
    setPlugins(data.plugins);
    setLoaded(true);
  }, [request]);
  useEffect(() => { void load().catch((failure: unknown) => setError(String(failure))); }, [load]);

  async function mutate(command: HostCommand): Promise<void> {
    if (!request || busy) return;
    setBusy(true); setError('');
    try {
      const response = await request(command);
      if (!response.success) throw new Error(response.error);
      await load();
      await props.onChanged();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally { setBusy(false); }
  }

  async function uninstall(agentId: string): Promise<void> {
    if (await confirm.confirm({
      title: t('Remove Agent adapter?', '卸载 Agent 适配插件？'),
      description: t('Stops new Runs. Current Runs can finish. Your history, Grok CLI, sessions and login are preserved.', '阻止新 Run；当前 Run 可运行至结束。保留历史、Grok CLI、原生会话和登录信息。'),
      confirmLabel: t('Remove adapter', '卸载适配插件'), cancelLabel: t('Cancel', '取消'),
    })) await mutate({ type: 'agents/uninstall', agentId });
  }

  return <section data-testid="agent-plugin-controls" aria-busy={busy}>
    {busy ? <p role="status">{t('Applying change on the Host…', '正在 Host 应用更改…')}</p> : null}
    {error ? <Notice tone="error">{error}</Notice> : null}
    {loaded && plugins.length === 0 ? <>
      <p className="muted">{t('Install the reviewed adapter first; the official CLI dependency and account are separate.', '先安装已审查的适配插件；官方 CLI 依赖和账号另行配置。')}</p>
      <Button disabled={busy} data-testid="agent-plugin-install" onClick={() => void mutate({ type: 'agents/install', source: { kind: 'bundled', agentId: 'grok' } })}>{t('Install Grok adapter', '安装 Grok 适配插件')}</Button>
    </> : null}
    {plugins.map((plugin) => <div key={plugin.agentId} data-testid={`agent-plugin-${plugin.agentId}`}>
      <p>{plugin.manifest.name} · {t('adapter', '适配插件')} v{plugin.manifest.version} · {plugin.enabled ? t('enabled', '已启用') : t('disabled', '已停用')}</p>
      <p className="muted">{t('CLI is user-owned. Install the official CLI and run grok login on this Host, then Check again. This is separate from xAI model OAuth.', 'CLI 归用户所有。在当前 Host 安装官方 CLI 并运行 grok login，然后重新检测。这与 xAI 模型 OAuth 账号分开。')}</p>
      <Button variant="secondary" disabled={busy} data-testid="agent-plugin-toggle" onClick={() => void mutate({ type: 'agents/set-enabled', agentId: plugin.agentId, enabled: !plugin.enabled })}>{plugin.enabled ? t('Disable', '停用') : t('Enable', '启用')}</Button>
      <Button variant="secondary" disabled={busy} data-testid="agent-plugin-uninstall" onClick={() => void uninstall(plugin.agentId)}>{t('Uninstall adapter', '卸载适配插件')}</Button>
      <TextInput label={t('Existing CLI path on Host', 'Host 上已有 CLI 的路径')} placeholder={plugin.runtime.binaryPath ?? '/Users/you/.grok/bin/grok'} value={binaryPath} onChange={(event) => setBinaryPath(event.currentTarget.value)} />
      <Button variant="secondary" disabled={busy || !binaryPath.trim()} onClick={() => void mutate({ type: 'agents/select-runtime', agentId: plugin.agentId, binaryPath })}>{t('Use this CLI path', '使用该 CLI 路径')}</Button>
    </div>)}
    {confirm.dialog}
  </section>;
}
