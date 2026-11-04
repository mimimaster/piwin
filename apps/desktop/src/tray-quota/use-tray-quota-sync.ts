/**
 * Main-window controller that synchronizes OAuth subscription accounts and
 * live plan quotas with the macOS menu-bar tray icon & popover (`tray-quota`).
 *
 * Responsibilities:
 * 1. Show the menu-bar icon ONLY when >= 1 OAuth account is `logged-in`
 *    ("没有oauth就不展示"). Hide the icon and close the popover when 0 are connected.
 * 2. Fetch `auth/quota` for connected built-in OAuth accounts on login, on
 *    popover open, and on manual refresh requests from the popover.
 * 3. Publish `TrayQuotaStatePayload` snapshots to the popover via Tauri events.
 * 4. Handle `tray-quota-navigate` events when the user clicks a provider card
 *    or action button in the popover to open `piwin` ("点击弹出piwin页面吧").
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AuthStatusData,
  SubscriptionAccount,
  SubscriptionAccountQuota,
} from '@piwin/contracts';
import type { HostClient } from '../host/host-client.js';
import type { ShellSettingsSection } from '../tool-cards/shell-navigation.js';
import {
  filterConnectedOauthAccounts,
  installTrayQuotaStateRelay,
  isBuiltinOauthProviderId,
  listenTrayQuotaNavigate,
  listenTrayQuotaOpened,
  publishTrayQuotaState,
  setTrayQuotaVisible,
  shouldShowTrayQuotaIcon,
} from './tray-quota-state-bridge.js';

const AUTO_REFRESH_STALE_MS = 60_000;

export type UseTrayQuotaSyncArgs = {
  hostClient: HostClient;
  hostReady: boolean;
  locale: 'zh-CN' | 'en';
  themeMode: 'dark' | 'light';
  openSettingsSection: (section: ShellSettingsSection) => void;
};

export function useTrayQuotaSync({
  hostClient,
  hostReady,
  locale,
  themeMode,
  openSettingsSection,
}: UseTrayQuotaSyncArgs): void {
  const [accounts, setAccounts] = useState<SubscriptionAccount[]>([]);
  const [quotas, setQuotas] = useState<Record<string, SubscriptionAccountQuota>>({});
  const [loadingIds, setLoadingIds] = useState<Set<string>>(() => new Set());

  const accountsRef = useRef<SubscriptionAccount[]>(accounts);
  accountsRef.current = accounts;
  const quotasRef = useRef<Record<string, SubscriptionAccountQuota>>(quotas);
  quotasRef.current = quotas;
  const inFlightRef = useRef<Set<string>>(new Set());

  const fetchProviderQuota = useCallback(
    async (providerId: string, forceRefresh = false): Promise<void> => {
      if (!hostClient?.request || !isBuiltinOauthProviderId(providerId)) {
        return;
      }
      if (inFlightRef.current.has(providerId)) {
        return;
      }
      inFlightRef.current.add(providerId);
      setLoadingIds((prev) => {
        const next = new Set(prev);
        next.add(providerId);
        return next;
      });
      try {
        const response = await hostClient.request({
          type: 'auth/quota',
          input: { providerId, forceRefresh },
        });
        if (response.success && response.data && typeof response.data === 'object') {
          const data = response.data as { quota?: SubscriptionAccountQuota };
          if (data.quota) {
            const quota = data.quota;
            setQuotas((prev) => ({ ...prev, [providerId]: quota }));
            return;
          }
        }
        setQuotas((prev) => ({
          ...prev,
          [providerId]: {
            providerId,
            groups: [],
            lastUpdated: new Date().toISOString(),
            ...(!response.success && response.error ? { error: response.error } : {}),
          },
        }));
      } catch (error) {
        setQuotas((prev) => ({
          ...prev,
          [providerId]: {
            providerId,
            groups: [],
            lastUpdated: new Date().toISOString(),
            error: error instanceof Error ? error.message : 'Failed to read quota',
          },
        }));
      } finally {
        inFlightRef.current.delete(providerId);
        setLoadingIds((prev) => {
          const next = new Set(prev);
          next.delete(providerId);
          return next;
        });
      }
    },
    [hostClient],
  );

  const refreshConnectedQuotas = useCallback(
    (options?: { forceRefresh?: boolean; providerId?: string; onlyStale?: boolean }) => {
      const connected = filterConnectedOauthAccounts(accountsRef.current);
      if (options?.providerId) {
        const target = connected.find((item) => item.providerId === options.providerId);
        if (target && isBuiltinOauthProviderId(target.providerId)) {
          void fetchProviderQuota(target.providerId, options.forceRefresh ?? true);
        }
        return;
      }
      const now = Date.now();
      for (const account of connected) {
        if (!isBuiltinOauthProviderId(account.providerId)) {
          continue;
        }
        const existing = quotasRef.current[account.providerId];
        if (options?.onlyStale && existing?.lastUpdated) {
          const updatedMs = Date.parse(existing.lastUpdated);
          if (!Number.isNaN(updatedMs) && now - updatedMs < AUTO_REFRESH_STALE_MS) {
            continue;
          }
        }
        void fetchProviderQuota(account.providerId, options?.forceRefresh ?? false);
      }
    },
    [fetchProviderQuota],
  );

  const refreshAuthStatus = useCallback(async () => {
    if (!hostClient?.request) {
      return;
    }
    if (hostClient.supportsCommand?.('auth/status') === false) {
      return;
    }
    try {
      const response = await hostClient.request({ type: 'auth/status' });
      if (!response.success || !response.data || typeof response.data !== 'object') {
        return;
      }
      const data = response.data as AuthStatusData;
      const v1Accounts = data.accounts.filter((account) => account.surface === 'v1');
      setAccounts(v1Accounts);
    } catch {
      // Ignore transient startup/transport errors; hostReady or auth/updated will retry.
    }
  }, [hostClient]);

  // 1. Hydrate on hostReady and subscribe to live Host auth/quota pushes
  useEffect(() => {
    if (hostReady) {
      void refreshAuthStatus();
    }
  }, [hostReady, refreshAuthStatus]);

  useEffect(() => {
    if (!hostClient?.subscribe) {
      return;
    }
    return hostClient.subscribe((message) => {
      if (message.type === 'auth/updated') {
        setAccounts(message.accounts.filter((account) => account.surface === 'v1'));
        return;
      }
      if (message.type === 'auth/quota-updated' && message.quota) {
        const quota = message.quota;
        setQuotas((prev) => ({ ...prev, [quota.providerId]: quota }));
        return;
      }
      if (message.type === 'auth/login-finished') {
        void refreshAuthStatus();
        return;
      }
      if (
        (message.type === 'host/status' && message.ready) ||
        message.type === 'snapshot'
      ) {
        void refreshAuthStatus();
      }
    });
  }, [hostClient, refreshAuthStatus]);

  // 2. Toggle macOS menu-bar tray icon visibility ("没有oauth就不展示")
  // and eagerly fetch initial quotas for newly connected accounts
  useEffect(() => {
    const visible = shouldShowTrayQuotaIcon(accounts);
    void setTrayQuotaVisible(visible);

    if (!visible) {
      return;
    }
    const connected = filterConnectedOauthAccounts(accounts);
    for (const account of connected) {
      if (
        isBuiltinOauthProviderId(account.providerId) &&
        quotasRef.current[account.providerId] === undefined
      ) {
        void fetchProviderQuota(account.providerId, false);
      }
    }
  }, [accounts, fetchProviderQuota]);

  // 3. Publish state snapshots to the popover whenever anything changes
  useEffect(() => {
    publishTrayQuotaState({
      accounts,
      quotas,
      loadingProviderIds: Array.from(loadingIds),
      locale,
      themeMode,
    });
  }, [accounts, quotas, loadingIds, locale, themeMode]);

  // 4. Answer popover requests, refresh on popover open, and navigate on click
  useEffect(() => {
    let unlistenRelay: (() => void) | undefined;
    let unlistenOpened: (() => void) | undefined;
    let unlistenNavigate: (() => void) | undefined;

    void installTrayQuotaStateRelay((payload) => {
      if (payload.forceRefresh || payload.providerId) {
        refreshConnectedQuotas({
          forceRefresh: payload.forceRefresh ?? true,
          ...(payload.providerId ? { providerId: payload.providerId } : {}),
        });
      } else {
        refreshConnectedQuotas({ onlyStale: true });
      }
    }).then((dispose) => {
      unlistenRelay = dispose;
    });

    void listenTrayQuotaOpened(() => {
      refreshConnectedQuotas({ onlyStale: true });
    }).then((dispose) => {
      unlistenOpened = dispose;
    });

    void listenTrayQuotaNavigate((payload) => {
      if (payload.section === 'oauth') {
        openSettingsSection('oauth');
      }
    }).then((dispose) => {
      unlistenNavigate = dispose;
    });

    return () => {
      unlistenRelay?.();
      unlistenOpened?.();
      unlistenNavigate?.();
    };
  }, [openSettingsSection, refreshConnectedQuotas]);
}
