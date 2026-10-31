import { describe, expect, it, vi } from 'vitest';
import {
  buildDesktopAppearanceSync,
  mergeRemoteAppearanceIntoPreferences,
  syncAppearanceToHost,
} from './appearance-sync.js';
import type { DesktopPreferences } from './ui-preferences.js';
import type { DesktopAppearanceSync } from '@piwin/contracts';

describe('appearance-sync', () => {
  const basePreferences: DesktopPreferences = {
    toolDensity: 'comfortable',
    assistantTextSize: 'default',
    codeTextSize: 'default',
    codeWrap: true,
    workDetailsExpanded: 'auto',
    artifactCodeFirst: false,
    verboseAgentChat: true,
    conversationWidth: 'default',
    appearanceMode: 'light',
    lightTheme: {
      preset: 'default',
      background: '#F6F5F2',
      foreground: '#1D1B17',
      accent: '#B03A24',
    },
    darkTheme: {
      preset: 'default',
      background: '#151412',
      foreground: '#EBE5DA',
      accent: '#E25A3D',
    },
    wallpaper: {
      id: 'data:image/jpeg;base64,mockImageData',
      blur: 10,
      dim: 25,
      opacity: {
        backdrop: 20,
        sidebar: 20,
        stage: 60,
        rightPanel: 40,
      },
    },
  };

  it('builds DesktopAppearanceSync correctly from preferences', async () => {
    const sync = await buildDesktopAppearanceSync(basePreferences);
    expect(sync.appearanceMode).toBe('light');
    expect(sync.lightTheme?.accent).toBe('#B03A24');
    expect(sync.wallpaper?.url).toBe('data:image/jpeg;base64,mockImageData');
    expect(sync.wallpaper?.blur).toBe(10);
    expect(sync.wallpaper?.dim).toBe(25);
  });

  it('merges remote appearance into local preferences', () => {
    const remote: DesktopAppearanceSync = {
      appearanceMode: 'dark',
      darkTheme: {
        preset: 'ink',
        background: '#111111',
        foreground: '#EEEEEE',
        accent: '#FF5533',
      },
      wallpaper: {
        url: 'https://example.com/bg.jpg',
        blur: 5,
        dim: 35,
      },
    };

    const merged = mergeRemoteAppearanceIntoPreferences(remote, basePreferences);
    expect(merged.appearanceMode).toBe('dark');
    expect(merged.darkTheme.accent).toBe('#FF5533');
    expect(merged.wallpaper?.id).toBe('https://example.com/bg.jpg');
    expect(merged.wallpaper?.blur).toBe(5);
    expect(merged.wallpaper?.dim).toBe(35);
  });

  it('syncs appearance to Host via settings/apply', async () => {
    const request = vi.fn().mockImplementation((cmd) => {
      if (cmd.type === 'settings/get') {
        return Promise.resolve({
          success: true,
          data: {
            snapshot: {
              config: { desktop: {} },
            },
          },
        });
      }
      if (cmd.type === 'settings/apply') {
        return Promise.resolve({ success: true });
      }
      return Promise.resolve({ success: false });
    });

    const hostClient = {
      request,
      supportsCommand: () => true,
    };

    await syncAppearanceToHost(hostClient, basePreferences);

    expect(request).toHaveBeenCalledWith({ type: 'settings/get' });
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'settings/apply',
        input: expect.objectContaining({
          mutations: expect.arrayContaining([
            expect.objectContaining({
              kind: 'replace-domain',
              domain: 'desktop',
              value: expect.objectContaining({
                appearance: expect.objectContaining({
                  appearanceMode: 'light',
                }),
              }),
            }),
          ]),
        }),
      }),
    );
  });
});
