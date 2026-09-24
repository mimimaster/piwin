/**
 * Install a live-search Pi package (npm / GitHub) after the user accepts the
 * community-code risk. Shares the session-apply outcome with curated installs.
 */
import { useRef, useState } from 'react';
import type { HostCommand, HostResponse, MarketplaceSearchHit } from '@piwin/contracts';
import type { DesktopLocale } from '../../desktop-locale.js';
import { applyExtensionsToSession, describeExtensionChange } from './marketplace-session-apply.js';
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
  showToast: (toast: MarketplaceToast) => void;
  onInstalled?: () => Promise<void>;
}): MarketplacePackageInstall {
  const [target, setTarget] = useState<MarketplaceSearchHit | null>(null);
  const [states, setStates] = useState<Record<string, MarketplacePackageInstallState>>({});
  const optionsRef = useRef(options);
  optionsRef.current = options;

  async function confirm(hit: MarketplaceSearchHit): Promise<void> {
    const { request, sessionId, locale, showToast, onInstalled } = optionsRef.current;
    const zh = locale === 'zh-CN';
    setTarget(null);
    setStates((current) => ({ ...current, [hit.entryId]: 'installing' }));
    try {
      const source =
        hit.source === 'github'
          ? hit.repositoryUrl
            ? { kind: 'git' as const, repositoryUrl: hit.repositoryUrl }
            : null
          : { kind: 'npm' as const, packageName: hit.name };
      if (!source) {
        throw new Error(zh ? '该条目缺少可安装的仓库地址。' : 'This result has no installable repository URL.');
      }
      const response = await request({ type: 'marketplace/package-install', source });
      if (!response.success) {
        throw new Error(response.error);
      }
      setStates((current) => ({ ...current, [hit.entryId]: 'installed' }));
      showToast(
        describeExtensionChange(hit.name, 'installed', await applyExtensionsToSession(request, sessionId), locale),
      );
    } catch (error) {
      setStates((current) => ({ ...current, [hit.entryId]: 'failed' }));
      const message = error instanceof Error ? error.message : String(error);
      showToast({
        type: 'error',
        title: zh ? '扩展安装失败' : 'Installation Failed',
        text: zh ? `安装 [${hit.name}] 失败：${message}` : `Could not install [${hit.name}]: ${message}`,
      });
    } finally {
      await onInstalled?.();
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
