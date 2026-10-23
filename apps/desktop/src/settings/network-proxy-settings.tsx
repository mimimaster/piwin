/**
 * Settings → General card for the Host's outbound proxy (ADR 0091).
 *
 * The proxy is an explicit `network.proxyUrl` setting, like Pi's `httpProxy`.
 * The Host never applies the OS proxy by itself; "Use system proxy" asks the
 * Host to read it once and saves what it found.
 */
import { useEffect, useState, type ReactElement } from 'react';
import {
  normalizeNetworkConfig,
  parseNetworkProxySetting,
  type SystemProxyDetection,
} from '@piwin/contracts';
import { Button, Notice, TextInput } from '@piwin/ui-kit';
import { useDesktopLocale } from '../i18n/desktop-locale-context';
import { FieldRow } from './field-row';
import { PageTitle } from './page-title';
import { settingsHostSupportsCommand, useSettings } from './settings-context';

export function NetworkProxySettings(): ReactElement | null {
  const { locale } = useDesktopLocale();
  const zh = locale === 'zh-CN';
  const settings = useSettings();
  const { config, saveConfig, setInfo, hostClient, remoteSettingsReadOnly } = settings;
  const saved = config?.network?.proxyUrl ?? '';
  const [draft, setDraft] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    setDraft(saved);
  }, [saved]);

  if (!config) {
    return null;
  }
  const readOnly = remoteSettingsReadOnly === true;
  const canDetect =
    hostClient?.request !== undefined && settingsHostSupportsCommand(settings, 'network/detect-system-proxy');

  async function save(value: string): Promise<boolean> {
    if (!config) return false;
    const setting = parseNetworkProxySetting(value);
    if (setting.mode === 'invalid') {
      setError(
        zh
          ? '只支持 http:// 或 https:// 代理地址，或填 direct。SOCKS 和 PAC 不支持。'
          : 'Use an http:// or https:// proxy URL, or direct. SOCKS and PAC are not supported.',
      );
      return false;
    }
    setError(undefined);
    const network = normalizeNetworkConfig({ proxyUrl: value });
    const { network: _previous, ...rest } = config;
    const ok = await saveConfig(network === undefined ? rest : { ...rest, network }, { quiet: true });
    if (!ok) {
      setError(zh ? '保存失败：无法写入 Host 配置。' : 'Save failed: could not write the Host config.');
    }
    return ok;
  }

  async function applySystemProxy(): Promise<void> {
    if (!hostClient?.request) return;
    setBusy(true);
    setError(undefined);
    try {
      const response = await hostClient.request({ type: 'network/detect-system-proxy' });
      if (!response.success) {
        setError((zh ? '读取系统代理失败：' : 'Could not read the system proxy: ') + response.error);
        return;
      }
      const detection = response.data as SystemProxyDetection;
      if (!detection.supported) {
        setError(zh ? '这台 Host 的系统暂不支持读取系统代理，请手动填写。' : 'This Host cannot read its system proxy yet. Enter it by hand.');
        return;
      }
      if (detection.error !== undefined) {
        setError((zh ? '读取系统代理失败：' : 'Could not read the system proxy: ') + detection.error);
        return;
      }
      if (detection.proxyUrl === undefined) {
        setError(
          zh
            ? '系统没有开启 HTTP/HTTPS 代理（只开 SOCKS 或 PAC 的不算）。'
            : 'The system has no HTTP/HTTPS proxy turned on (SOCKS or PAC alone does not count).',
        );
        return;
      }
      setDraft(detection.proxyUrl);
      if (await save(detection.proxyUrl)) {
        setInfo(zh ? `已使用系统代理 ${detection.proxyUrl}` : `Using the system proxy ${detection.proxyUrl}`, 'success');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-section settings-section-card" data-testid="network-proxy-settings">
      <PageTitle
        title={zh ? '网络代理' : 'Network proxy'}
        description={
          zh
            ? 'Host 的登录、模型调用和联网工具都走这里设置的代理。Agent 中的命令也会继承这个代理。'
            : 'Sign-in, model calls and web tools on the Host use this proxy. Agent commands inherit it too.'
        }
      />
      <FieldRow
        label={zh ? '代理地址' : 'Proxy URL'}
        description={
          zh
            ? '留空：沿用 Host 启动时的 HTTP(S)_PROXY。direct：强制直连。或填 http://127.0.0.1:7890 这样的地址。'
            : 'Empty: keep the HTTP(S)_PROXY the Host started with. direct: always connect directly. Or a URL such as http://127.0.0.1:7890.'
        }
      >
        <>
          <TextInput
            value={draft}
            disabled={readOnly || busy}
            placeholder="http://127.0.0.1:7890"
            aria-label={zh ? '代理地址' : 'Proxy URL'}
            testId="network-proxy-url"
            onChange={(event) => setDraft(event.currentTarget.value)}
          />
          <Button
            variant="secondary"
            disabled={readOnly || busy || draft.trim() === saved}
            onClick={() => void save(draft)}
            data-testid="network-proxy-save"
          >
            {zh ? '保存' : 'Save'}
          </Button>
        </>
      </FieldRow>
      {canDetect ? (
        <FieldRow
          label={zh ? '系统代理' : 'System proxy'}
          description={
            zh
              ? '读取这台 Host 当前的系统代理（如 Clash、Surge 开启的），并保存为上面的代理地址。'
              : "Read this Host's current system proxy (as set by Clash, Surge, …) and save it as the proxy URL above."
          }
        >
          <Button
            variant="secondary"
            disabled={readOnly || busy}
            onClick={() => void applySystemProxy()}
            data-testid="network-proxy-use-system"
          >
            {zh ? '使用系统代理' : 'Use system proxy'}
          </Button>
        </FieldRow>
      ) : null}
      {error ? (
        <Notice tone="error" testId="network-proxy-error">
          {error}
        </Notice>
      ) : null}
    </div>
  );
}
