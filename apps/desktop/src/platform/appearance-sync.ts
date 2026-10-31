/**
 * Synchronizes appearance settings and wallpaper between Desktop and Host/Mobile.
 */
import type { DesktopAppearanceSync, HostCommand, HostResponse } from '@piwin/contracts';
import type { DesktopPreferences } from './ui-preferences.js';
import { loadWallpaperImage } from './wallpaper-storage.js';

export type AppearanceSyncHostClient = {
  request: (command: HostCommand) => Promise<HostResponse>;
  supportsCommand?: (type: any) => boolean;
};

export async function buildDesktopAppearanceSync(
  prefs: DesktopPreferences,
): Promise<DesktopAppearanceSync> {
  const sync: DesktopAppearanceSync = {
    appearanceMode: prefs.appearanceMode,
    lightTheme: prefs.lightTheme,
    darkTheme: prefs.darkTheme,
  };

  if (prefs.wallpaper) {
    let url: string | undefined;
    if (
      prefs.wallpaper.id.startsWith('data:') ||
      prefs.wallpaper.id.startsWith('http:') ||
      prefs.wallpaper.id.startsWith('https:') ||
      prefs.wallpaper.id.startsWith('/')
    ) {
      url = prefs.wallpaper.id;
    } else {
      try {
        const blob = await loadWallpaperImage(prefs.wallpaper.id);
        if (blob) {
          url = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob'));
            reader.readAsDataURL(blob);
          });
        }
      } catch {
        url = prefs.wallpaper.id;
      }
    }

    sync.wallpaper = {
      ...(url !== undefined ? { url } : {}),
      blur: prefs.wallpaper.blur,
      dim: prefs.wallpaper.dim,
      opacity: prefs.wallpaper.opacity,
    };
  }

  return sync;
}

export function mergeRemoteAppearanceIntoPreferences(
  remote: DesktopAppearanceSync,
  current: DesktopPreferences,
): DesktopPreferences {
  const next: DesktopPreferences = {
    ...current,
    appearanceMode: remote.appearanceMode ?? current.appearanceMode,
    lightTheme: remote.lightTheme
      ? { ...current.lightTheme, ...remote.lightTheme }
      : current.lightTheme,
    darkTheme: remote.darkTheme
      ? { ...current.darkTheme, ...remote.darkTheme }
      : current.darkTheme,
  };

  if (remote.wallpaper?.url) {
    next.wallpaper = {
      id: remote.wallpaper.url,
      blur: remote.wallpaper.blur ?? 0,
      dim: remote.wallpaper.dim ?? 30,
      opacity: {
        backdrop: remote.wallpaper.opacity?.backdrop ?? 15,
        sidebar: remote.wallpaper.opacity?.sidebar ?? 15,
        stage: remote.wallpaper.opacity?.stage ?? 55,
        rightPanel: remote.wallpaper.opacity?.rightPanel ?? 35,
      },
    };
  }

  return next;
}

export async function syncAppearanceToHost(
  hostClient: AppearanceSyncHostClient | undefined,
  prefs: DesktopPreferences,
): Promise<void> {
  if (!hostClient || hostClient.supportsCommand?.('settings/get') === false) return;
  try {
    const appearance = await buildDesktopAppearanceSync(prefs);
    const currentResponse = await hostClient.request({ type: 'settings/get' });
    if (!currentResponse.success || !currentResponse.data) return;
    const data = currentResponse.data as {
      snapshot?: {
        config?: { desktop?: Record<string, unknown> };
      };
    };
    const currentDesktop = data.snapshot?.config?.desktop ?? {};
    const nextDesktop = { ...currentDesktop, appearance };
    await hostClient.request({
      type: 'settings/apply',
      input: {
        mutations: [
          {
            kind: 'replace-domain',
            domain: 'desktop',
            value: nextDesktop,
          },
        ],
      },
    });
  } catch {
    // Non-fatal: appearance sync is a convenience
  }
}
