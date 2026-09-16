import { useState } from 'react';
import type { HostCommand, HostResponse, MarketplaceSearchHit } from '@piwin/contracts';
import type { DesktopLocale } from '../../desktop-locale.js';
import type { MarketplaceToast } from './marketplace-types.js';

export type MarketplacePackageInstallState = 'installing' | 'installed' | 'failed';

export type MarketplacePackageInstall = {
  target: MarketplaceSearchHit | null;
  states: Record<string, MarketplacePackageInstallState>;
  progress: Record<string, number>;
  select: (hit: MarketplaceSearchHit) => void;
  cancel: () => void;
  confirm: (hit: MarketplaceSearchHit) => Promise<void>;
};

export function useMarketplacePackageInstall(options: {
  locale?: DesktopLocale | undefined;
  sessionId?: string | null | undefined;
  request: (command: HostCommand) => Promise<HostResponse>;
  showToast: (text: string, type?: MarketplaceToast['type'], title?: string) => void;
}): MarketplacePackageInstall {
  const isZh = options.locale === 'zh-CN';
  const t = (en: string, zh: string) => (isZh ? zh : en);
  const [target, setTarget] = useState<MarketplaceSearchHit | null>(null);
  const [states, setStates] = useState<Record<string, MarketplacePackageInstallState>>({});
  const [progress, setProgress] = useState<Record<string, number>>({});

  async function confirm(hit: MarketplaceSearchHit): Promise<void> {
    setTarget(null);
    setStates((current) => ({ ...current, [hit.entryId]: 'installing' }));
    setProgress((current) => ({ ...current, [hit.entryId]: 15 }));

    options.showToast(
      t(`Installing [${hit.name}] on the Host…`, `正在 Host 上安装 [${hit.name}]…`),
      'info',
      t('Installing Extension', '正在安装扩展'),
    );

    // Smooth real-time progress simulation during async package download and compilation
    const progressTimer = setInterval(() => {
      setProgress((current) => {
        const prev = current[hit.entryId] ?? 15;
        if (prev < 90) {
          const increment = Math.max(5, Math.floor((90 - prev) * 0.35));
          return { ...current, [hit.entryId]: Math.min(92, prev + increment) };
        }
        return current;
      });
    }, 240);

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
          clearInterval(progressTimer);
          setProgress((current) => ({ ...current, [hit.entryId]: 100 }));
          setStates((current) => ({ ...current, [hit.entryId]: 'installed' }));
          options.showToast(
            t(
              `[${hit.name}] is installed, but could not be applied to the current session: ${applyResponse.error}`,
              `[${hit.name}] 已安装，但同步到当前会话失败：${applyResponse.error}`,
            ),
            'warning',
            t('Capability Applied with Warning', '扩展已安装（同步警告）'),
          );
          return;
        }
        appliedToCurrentSession = true;
      }

      clearInterval(progressTimer);
      setProgress((current) => ({ ...current, [hit.entryId]: 100 }));
      setStates((current) => ({ ...current, [hit.entryId]: 'installed' }));

      options.showToast(
        appliedToCurrentSession
          ? t(
              `[${hit.name}] extension installed successfully. Current session capability refresh is queued.`,
              `[${hit.name}] 扩展安装成功，当前会话与运行时已无缝就绪。`,
            )
          : t(
              `[${hit.name}] extension installed successfully. New sessions will load its supported resources.`,
              `[${hit.name}] 扩展安装成功，新会话会读取其中受支持的能力。`,
            ),
        'success',
        t('Extension Installed', '扩展安装成功'),
      );
    } catch (error) {
      clearInterval(progressTimer);
      setProgress((current) => ({ ...current, [hit.entryId]: 0 }));
      setStates((current) => ({ ...current, [hit.entryId]: 'failed' }));
      const message = error instanceof Error ? error.message : String(error);
      options.showToast(
        t(
          `Could not install [${hit.name}]: ${message}`,
          `安装 [${hit.name}] 失败：${message}`,
        ),
        'error',
        t('Installation Failed', '扩展安装失败'),
      );
    }
  }

  return {
    target,
    states,
    progress,
    select: setTarget,
    cancel: () => setTarget(null),
    confirm,
  };
}
