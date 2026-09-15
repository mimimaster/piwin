import { useState } from 'react';
import type { HostCommand, HostResponse, MarketplaceSearchHit } from '@piwin/contracts';
import type { DesktopLocale } from '../../desktop-locale.js';
import type { MarketplaceToast } from './marketplace-types.js';

export type MarketplacePackageInstallState = 'installing' | 'installed' | 'failed';

export type MarketplacePackageInstall = {
  target: MarketplaceSearchHit | null;
  states: Record<string, MarketplacePackageInstallState>;
  select: (hit: MarketplaceSearchHit) => void;
  cancel: () => void;
  confirm: (hit: MarketplaceSearchHit) => Promise<void>;
};

export function useMarketplacePackageInstall(options: {
  locale?: DesktopLocale | undefined;
  sessionId?: string | null | undefined;
  request: (command: HostCommand) => Promise<HostResponse>;
  showToast: (text: string, type?: MarketplaceToast['type']) => void;
}): MarketplacePackageInstall {
  const isZh = options.locale === 'zh-CN';
  const t = (en: string, zh: string) => (isZh ? zh : en);
  const [target, setTarget] = useState<MarketplaceSearchHit | null>(null);
  const [states, setStates] = useState<Record<string, MarketplacePackageInstallState>>({});

  async function confirm(hit: MarketplaceSearchHit): Promise<void> {
    setTarget(null);
    setStates((current) => ({ ...current, [hit.entryId]: 'installing' }));
    options.showToast(t(`Installing [${hit.name}] on the Host…`, `正在 Host 上安装 [${hit.name}]…`));

    try {
      const source =
        hit.source === 'github'
          ? hit.repositoryUrl
            ? { kind: 'git' as const, repositoryUrl: hit.repositoryUrl }
            : null
          : { kind: 'npm' as const, packageName: hit.name };
      if (!source) {
        throw new Error(t('This result has no installable repository URL.', '该条目缺少可安装的仓库地址。'));
      }
      const response = await options.request({
        type: 'marketplace/package-install',
        source,
      });
      if (!response.success) {
        throw new Error(response.error);
      }

      let appliedToCurrentSession = false;
      if (options.sessionId) {
        const applyResponse = await options.request({
          type: 'extensions/apply',
          sessionId: options.sessionId,
          when: 'after-current-run',
        });
        if (!applyResponse.success) {
          setStates((current) => ({ ...current, [hit.entryId]: 'installed' }));
          options.showToast(
            t(
              `[${hit.name}] is installed, but could not be applied to the current session: ${applyResponse.error}`,
              `[${hit.name}] 已安装，但同步到当前会话失败：${applyResponse.error}`,
            ),
            'warning',
          );
          return;
        }
        appliedToCurrentSession = true;
      }

      setStates((current) => ({ ...current, [hit.entryId]: 'installed' }));
      options.showToast(
        appliedToCurrentSession
          ? t(
              `[${hit.name}] installed. The current session capability refresh is queued.`,
              `[${hit.name}] 已安装，当前会话的能力刷新已排队。`,
            )
          : t(
              `[${hit.name}] installed. New sessions will load its supported resources.`,
              `[${hit.name}] 已安装，新会话会读取其中受支持的能力。`,
            ),
        'success',
      );
    } catch (error) {
      setStates((current) => ({ ...current, [hit.entryId]: 'failed' }));
      const message = error instanceof Error ? error.message : String(error);
      options.showToast(
        t(
          `Could not install [${hit.name}]: ${message}`,
          `安装 [${hit.name}] 失败：${message}`,
        ),
        'error',
      );
    }
  }

  return {
    target,
    states,
    select: setTarget,
    cancel: () => setTarget(null),
    confirm,
  };
}
