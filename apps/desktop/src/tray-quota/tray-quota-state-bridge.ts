/**
 * Cross-window state bridge and Tauri command wrappers for the macOS menu-bar
 * OAuth quota popover (`tray-quota`).
 *
 * Architecture:
 * - Only the main window owns `HostClient` (`auth/status`, `auth/quota`, pushes).
 * - The main window computes whether any OAuth subscription account is logged in
 *   (`shouldShowTrayQuotaIcon`) and tells Rust (`tray_quota_set_visible`) to show
 *   or hide the menu-bar icon. When 0 OAuth accounts are logged in, the icon is
 *   hidden and the popover is closed.
 * - The popover window requests/receives snapshots via `@tauri-apps/api/event`.
 */
import {
  CLAUDE_CODE_OAUTH_PROVIDER_ID,
  type SubscriptionAccount,
  type SubscriptionAccountQuota,
  type SubscriptionOauthProviderId,
} from '@piwin/contracts';

export const TRAY_QUOTA_STATE_EVENT = 'tray-quota-state-push';
export const TRAY_QUOTA_REQUEST_EVENT = 'tray-quota-request-state';
export const TRAY_QUOTA_OPENED_EVENT = 'tray-quota-opened';
export const TRAY_QUOTA_NAVIGATE_EVENT = 'tray-quota-navigate';

export const OAUTH_TRAY_PROVIDER_ORDER: readonly SubscriptionOauthProviderId[] = [
  'kimi-coding',
  'openai-codex',
  'anthropic',
  CLAUDE_CODE_OAUTH_PROVIDER_ID,
  'xai',
  'github-copilot',
  'devin',
];

export type TrayProviderMeta = {
  title: string;
  titleEn: string;
  tagline: string;
  taglineEn: string;
  iconId: string;
  markClass: string;
  supportsLiveQuota: boolean;
  badgeText?: string;
};

const BUILTIN_PROVIDER_META: Record<SubscriptionOauthProviderId, TrayProviderMeta> = {
  'kimi-coding': {
    title: 'Kimi Code',
    titleEn: 'Kimi Code',
    tagline: 'Moonshot AI 编程套餐',
    taglineEn: 'Moonshot AI Coding Plan',
    iconId: 'kimi-coding',
    markClass: 'kimi-coding',
    supportsLiveQuota: true,
  },
  'openai-codex': {
    title: 'ChatGPT Codex',
    titleEn: 'ChatGPT Codex',
    tagline: 'OpenAI 官方订阅',
    taglineEn: 'OpenAI Subscription',
    iconId: 'openai-codex',
    markClass: 'openai-codex',
    supportsLiveQuota: true,
  },
  anthropic: {
    title: 'Claude',
    titleEn: 'Claude',
    tagline: 'Pro/Max · 额外用量模式',
    taglineEn: 'Pro/Max · Extra Usage',
    iconId: 'anthropic',
    markClass: 'anthropic',
    supportsLiveQuota: true,
    badgeText: 'Extra',
  },
  [CLAUDE_CODE_OAUTH_PROVIDER_ID]: {
    title: 'Claude Code',
    titleEn: 'Claude Code',
    tagline: 'Pro/Max · 套餐额度路径',
    taglineEn: 'Pro/Max · Plan Quota',
    iconId: 'anthropic',
    markClass: 'anthropic',
    supportsLiveQuota: true,
    badgeText: 'Plan',
  },
  xai: {
    title: 'Grok',
    titleEn: 'Grok',
    tagline: 'xAI 官方订阅',
    taglineEn: 'xAI Subscription',
    iconId: 'xai',
    markClass: 'xai',
    supportsLiveQuota: true,
  },
  'github-copilot': {
    title: 'GitHub Copilot',
    titleEn: 'GitHub Copilot',
    tagline: 'GitHub 订阅授权',
    taglineEn: 'GitHub Subscription',
    iconId: 'github-copilot',
    markClass: 'github-copilot',
    supportsLiveQuota: true,
  },
  devin: {
    title: 'Devin',
    titleEn: 'Devin',
    tagline: 'Cognition 搜索与研究授权',
    taglineEn: 'Cognition Search & Research',
    iconId: 'devin',
    markClass: 'devin',
    supportsLiveQuota: true,
  },
};

export function isBuiltinOauthProviderId(
  providerId: string,
): providerId is SubscriptionOauthProviderId {
  return (OAUTH_TRAY_PROVIDER_ORDER as readonly string[]).includes(providerId);
}

export function resolveTrayProviderMeta(
  providerId: string,
  extensionDisplayName?: string,
): TrayProviderMeta {
  if (isBuiltinOauthProviderId(providerId)) {
    return BUILTIN_PROVIDER_META[providerId];
  }
  const title = extensionDisplayName ?? providerId;
  return {
    title,
    titleEn: title,
    tagline: '社区扩展授权',
    taglineEn: 'Community Extension OAuth',
    iconId: providerId,
    markClass: providerId,
    supportsLiveQuota: false,
    badgeText: 'Ext',
  };
}

/** True when an account represents an active, connected OAuth subscription. */
export function isConnectedOauthAccount(account: SubscriptionAccount): boolean {
  return account.surface === 'v1' && account.state === 'logged-in';
}

/**
 * Filter and sort connected OAuth accounts in canonical display order
 * (built-in providers first in `OAUTH_TRAY_PROVIDER_ORDER`, then extension accounts).
 */
export function filterConnectedOauthAccounts(
  accounts: readonly SubscriptionAccount[],
): SubscriptionAccount[] {
  const connected = accounts.filter(isConnectedOauthAccount);
  const byId = new Map<string, SubscriptionAccount>();
  for (const account of connected) {
    byId.set(account.providerId, account);
  }
  const ordered: SubscriptionAccount[] = [];
  for (const builtinId of OAUTH_TRAY_PROVIDER_ORDER) {
    const found = byId.get(builtinId);
    if (found) {
      ordered.push(found);
      byId.delete(builtinId);
    }
  }
  for (const remaining of byId.values()) {
    ordered.push(remaining);
  }
  return ordered;
}

/**
 * Visibility rule ("没有oauth就不展示"):
 * Only display the macOS menu-bar tray icon when at least one OAuth account is logged in.
 */
export function shouldShowTrayQuotaIcon(accounts: readonly SubscriptionAccount[]): boolean {
  return filterConnectedOauthAccounts(accounts).length > 0;
}

export type TrayQuotaStatePayload = {
  accounts: SubscriptionAccount[];
  quotas: Record<string, SubscriptionAccountQuota>;
  loadingProviderIds: string[];
  locale: 'zh-CN' | 'en';
  themeMode: 'dark' | 'light';
};

export type TrayQuotaRequestPayload = {
  forceRefresh?: boolean;
  providerId?: string;
};

export type TrayQuotaNavigatePayload = {
  section?: string | null;
};

export type TrayQuotaStateRelay = {
  publish(state: TrayQuotaStatePayload): void;
  handleRequest(): void;
  getLatest(): TrayQuotaStatePayload | null;
};

export function createTrayQuotaStateRelay(options: {
  emitState: (state: TrayQuotaStatePayload) => void;
}): TrayQuotaStateRelay {
  let latest: TrayQuotaStatePayload | null = null;
  return {
    publish(state) {
      latest = state;
      options.emitState(state);
    },
    handleRequest() {
      if (latest) {
        options.emitState(latest);
      }
    },
    getLatest() {
      return latest;
    },
  };
}

export async function emitTrayQuotaState(state: TrayQuotaStatePayload): Promise<void> {
  try {
    const { emit } = await import('@tauri-apps/api/event');
    await emit(TRAY_QUOTA_STATE_EVENT, state);
  } catch {
    // Not in Tauri runtime or popover not listening yet.
  }
}

export async function requestTrayQuotaState(payload?: TrayQuotaRequestPayload): Promise<void> {
  try {
    const { emit } = await import('@tauri-apps/api/event');
    await emit(TRAY_QUOTA_REQUEST_EVENT, payload ?? {});
  } catch {
    // Not in Tauri runtime.
  }
}

export async function listenTrayQuotaState(
  onState: (state: TrayQuotaStatePayload) => void,
): Promise<() => void> {
  try {
    const { listen } = await import('@tauri-apps/api/event');
    return await listen<TrayQuotaStatePayload>(TRAY_QUOTA_STATE_EVENT, (event) => {
      if (event.payload) {
        onState(event.payload);
      }
    });
  } catch {
    return () => {};
  }
}

export async function listenTrayQuotaRequest(
  onRequest: (payload: TrayQuotaRequestPayload) => void,
): Promise<() => void> {
  try {
    const { listen } = await import('@tauri-apps/api/event');
    return await listen<TrayQuotaRequestPayload>(TRAY_QUOTA_REQUEST_EVENT, (event) => {
      onRequest(event.payload ?? {});
    });
  } catch {
    return () => {};
  }
}

export async function listenTrayQuotaOpened(onOpened: () => void): Promise<() => void> {
  try {
    const { listen } = await import('@tauri-apps/api/event');
    return await listen(TRAY_QUOTA_OPENED_EVENT, () => {
      onOpened();
    });
  } catch {
    return () => {};
  }
}

export async function listenTrayQuotaNavigate(
  onNavigate: (payload: TrayQuotaNavigatePayload) => void,
): Promise<() => void> {
  try {
    const { listen } = await import('@tauri-apps/api/event');
    return await listen<TrayQuotaNavigatePayload>(TRAY_QUOTA_NAVIGATE_EVENT, (event) => {
      onNavigate(event.payload ?? {});
    });
  } catch {
    return () => {};
  }
}

const defaultRelay = createTrayQuotaStateRelay({
  emitState: (state) => {
    void emitTrayQuotaState(state);
  },
});

export function publishTrayQuotaState(state: TrayQuotaStatePayload): void {
  defaultRelay.publish(state);
}

export function getLatestTrayQuotaState(): TrayQuotaStatePayload | null {
  return defaultRelay.getLatest();
}

export async function installTrayQuotaStateRelay(
  onRefreshRequested?: (payload: TrayQuotaRequestPayload) => void,
): Promise<() => void> {
  return listenTrayQuotaRequest((payload) => {
    defaultRelay.handleRequest();
    onRefreshRequested?.(payload);
  });
}

export async function setTrayQuotaVisible(visible: boolean): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('tray_quota_set_visible', { visible });
  } catch {
    // Non-Tauri or non-macOS environment.
  }
}

export async function hideTrayQuotaPopover(): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('tray_quota_hide');
  } catch {
    // Non-Tauri environment.
  }
}

export async function resizeTrayQuotaPopover(height: number): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('tray_quota_resize', { height });
  } catch {
    // Non-Tauri environment.
  }
}

export async function openPiwinFromTray(section?: string): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('tray_quota_open_piwin', {
      ...(section !== undefined ? { section } : {}),
    });
  } catch {
    // Non-Tauri environment.
  }
}
