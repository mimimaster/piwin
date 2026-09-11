/**
 * Dialog components for installing extensions and plugins in the marketplace.
 */
import { useState, type ReactElement } from 'react';
import { Button, Dialog, Notice, TextInput } from '@piwin/ui-kit';
import type { DesktopLocale } from '../../desktop-locale.js';
import type { MarketExtensionItem, MarketPluginItem } from './marketplace-types.js';

export type ExtensionInstallConsentDialogProps = {
  extension: MarketExtensionItem | null;
  locale?: DesktopLocale | undefined;
  onConfirm: (ext: MarketExtensionItem) => void;
  onCancel: () => void;
};

export function ExtensionInstallConsentDialog({
  extension,
  locale,
  onConfirm,
  onCancel,
}: ExtensionInstallConsentDialogProps): ReactElement | null {
  const isZh = locale === 'zh-CN';
  const t = (en: string, zh: string) => (isZh ? zh : en);

  if (!extension) return null;

  return (
    <Dialog
      label={t('Confirm Extension Installation', '确认安装扩展')}
      open={true}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      testId="market-install-consent-dialog"
    >
      <div className="market-dialog-body">
        <h3 className="market-dialog-title">
          {t(`Install ${extension.name}`, `安装即时扩展：${extension.name}`)}
        </h3>

        <div className="market-dialog-meta">
          <span>{extension.id}</span>
          <span>•</span>
          <span>v{extension.version}</span>
          <span>•</span>
          <span>{extension.author}</span>
        </div>

        <p className="market-card-desc">
          {isZh ? extension.descriptionZh : extension.descriptionEn}
        </p>

        {extension.tier === 'degraded' && (
          <Notice tone="warning" testId="market-degrade-notice">
            {t(
              'This extension contains terminal-only features (e.g. TUI widgets, shortcuts) which will be automatically degraded in desktop. Core agent tools remain fully operational.',
              '检测到此扩展包含终端专有功能（如 TUI 状态栏或快捷键）。在桌面端这些将被优雅忽略，但核心 Agent 工具将完整可用。',
            )}
          </Notice>
        )}

        <Notice tone="info" testId="market-runtime-notice">
          {t(
            'The extension will be staged in the Host runtime and live-applied to your session at the next turn boundary without restart.',
            '该扩展将由 Host 暂存并在下一个对话任务边界热重载生效，无需重启桌面端。',
          )}
        </Notice>

        <div className="market-dialog-footer">
          <Button variant="ghost" size="compact" onClick={onCancel}>
            {t('Cancel', '取消')}
          </Button>
          <Button
            variant="primary"
            size="compact"
            onClick={() => onConfirm(extension)}
          >
            {t('Confirm & Live Apply', '确认安装并热重载')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

export type PluginSecretDialogProps = {
  plugin: MarketPluginItem | null;
  locale?: DesktopLocale | undefined;
  onConfirm: (plugin: MarketPluginItem, secrets: Record<string, string>) => void;
  onCancel: () => void;
};

export function PluginSecretDialog({
  plugin,
  locale,
  onConfirm,
  onCancel,
}: PluginSecretDialogProps): ReactElement | null {
  const isZh = locale === 'zh-CN';
  const t = (en: string, zh: string) => (isZh ? zh : en);

  const [secretValue, setSecretValue] = useState('');

  if (!plugin) return null;

  const firstSecret = plugin.secrets[0];
  const required = firstSecret?.required ?? false;

  return (
    <Dialog
      label={t('Configure Plugin Secret', '配置插件密钥')}
      open={true}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      testId="market-plugin-secret-dialog"
    >
      <div className="market-dialog-body">
        <h3 className="market-dialog-title">
          {t(`Configure ${plugin.name}`, `配置插件凭证：${plugin.name}`)}
        </h3>

        <p className="market-card-desc">
          {t(
            `Enter the required secret (${firstSecret?.label ?? 'API Key'}) for this MCP plugin. Credentials are saved to the OS Keychain.`,
            `请输入插件所需的凭证（${firstSecret?.label ?? 'API Key'}）。凭证将安全保存于本地 Keychain。`,
          )}
        </p>

        <TextInput
          label={firstSecret?.label ?? 'Secret Key'}
          value={secretValue}
          onChange={(e) => setSecretValue(e.currentTarget.value)}
          placeholder={t('Enter key value…', '请输入密钥内容…')}
          testId="market-plugin-secret-input"
        />

        <div className="market-dialog-footer">
          <Button variant="ghost" size="compact" onClick={onCancel}>
            {t('Cancel', '取消')}
          </Button>
          <Button
            variant="primary"
            size="compact"
            disabled={required && !secretValue.trim()}
            onClick={() => {
              const result: Record<string, string> = {};
              if (firstSecret) {
                result[firstSecret.name] = secretValue.trim();
              }
              onConfirm(plugin, result);
            }}
          >
            {t('Save & Enable Plugin', '保存并启用插件')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
