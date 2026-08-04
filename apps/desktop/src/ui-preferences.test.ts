import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  loadDesktopPreferences,
  saveDesktopPreferences,
  loadToolCallDensity,
  resolveConversationWidth,
} from './ui-preferences';
import type { DesktopPreferences } from './ui-preferences';

const PREFIX = 'piwin.desktop.';

// Minimal localStorage mock for Node test environment.
function createMockStorage(): Record<string, string> {
  const store: Record<string, string> = {};
  return new Proxy(store, {
    get(target, prop) {
      if (prop === 'getItem') return (key: string) => target[key] ?? null;
      if (prop === 'setItem')
        return (key: string, value: string) => {
          target[key] = value;
        };
      if (prop === 'removeItem')
        return (key: string) => {
          delete target[key];
        };
      if (prop === 'clear')
        return () => {
          for (const k of Object.keys(target)) delete target[k];
        };
      if (prop === 'length') return Object.keys(target).length;
      if (prop === 'key') return (index: number) => Object.keys(target)[index] ?? null;
      return Reflect.get(target, prop);
    },
    has(target, prop) {
      return prop in target;
    },
  }) as unknown as Storage;
}

beforeEach(() => {
  const storage = createMockStorage();
  vi.stubGlobal('localStorage', storage);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function setLocalStorage(key: string, value: string): void {
  localStorage.setItem(PREFIX + key, value);
}

function clearLocalStorage(): void {
  localStorage.clear();
}

describe('DesktopPreferences loading', () => {
  beforeEach(() => {
    clearLocalStorage();
  });

  it('returns defaults when no localStorage values are set', () => {
    const prefs = loadDesktopPreferences();
    expect(prefs).toEqual<DesktopPreferences>({
      assistantTextSize: 'default',
      codeTextSize: 'default',
      codeWrap: false,
      toolDensity: 'comfortable',
      workDetailsExpanded: 'auto',
      artifactPreviewEnabled: true,
      artifactCodeFirst: false,
      verboseAgentChat: true,
      conversationWidth: 'default',
      appearanceMode: 'system',
      lightTheme: {
        preset: 'default',
        background: '#EEEEEE',
        foreground: '#101010',
        accent: '#007ACC',
      },
      darkTheme: {
        preset: 'default',
        background: '#101010',
        foreground: '#CCCCCC',
        accent: '#007ACC',
      },
      dontAskRevertConfirm: false,
    });
  });

  it('parses stored values correctly', () => {
    setLocalStorage('assistantTextSize', 'large');
    setLocalStorage('codeTextSize', 'small');
    setLocalStorage('codeWrap', 'true');
    setLocalStorage('toolCallDensity', 'compact');
    setLocalStorage('workDetailsExpanded', 'always');
    setLocalStorage('artifactCodeFirst', 'true');

    const prefs = loadDesktopPreferences();
    expect(prefs).toEqual<DesktopPreferences>({
      assistantTextSize: 'large',
      codeTextSize: 'small',
      codeWrap: true,
      toolDensity: 'compact',
      workDetailsExpanded: 'always',
      artifactPreviewEnabled: true,
      artifactCodeFirst: true,
      verboseAgentChat: true,
      conversationWidth: 'default',
      appearanceMode: 'system',
      lightTheme: {
        preset: 'default',
        background: '#EEEEEE',
        foreground: '#101010',
        accent: '#007ACC',
      },
      darkTheme: {
        preset: 'default',
        background: '#101010',
        foreground: '#CCCCCC',
        accent: '#007ACC',
      },
      dontAskRevertConfirm: false,
    });
  });

  it('handles missing keys gracefully (partial localStorage)', () => {
    setLocalStorage('assistantTextSize', 'small');

    const prefs = loadDesktopPreferences();
    expect(prefs.assistantTextSize).toBe('small');
    expect(prefs.codeTextSize).toBe('default');
    expect(prefs.codeWrap).toBe(false);
    expect(prefs.toolDensity).toBe('comfortable');
    expect(prefs.workDetailsExpanded).toBe('auto');
    expect(prefs.artifactPreviewEnabled).toBe(true);
    expect(prefs.artifactCodeFirst).toBe(false);
    expect(prefs.conversationWidth).toBe('default');
  });

  it('backward compat: reads old toolCallDensity key', () => {
    setLocalStorage('toolCallDensity', 'detailed');

    const prefs = loadDesktopPreferences();
    expect(prefs.toolDensity).toBe('detailed');
  });

  it('backward compat: loadToolCallDensity reads old key', () => {
    setLocalStorage('toolCallDensity', 'compact');

    expect(loadToolCallDensity()).toBe('compact');
  });

  it('loadToolCallDensity returns default when key is missing', () => {
    expect(loadToolCallDensity()).toBe('comfortable');
  });

  it('invalid values fall back to defaults', () => {
    setLocalStorage('assistantTextSize', 'huge');
    setLocalStorage('codeTextSize', 'tiny');
    setLocalStorage('codeWrap', 'maybe');
    setLocalStorage('toolCallDensity', 'super-detailed');
    setLocalStorage('workDetailsExpanded', 'never');
    setLocalStorage('artifactCodeFirst', 'maybe');
    setLocalStorage('conversationWidth', 'extra-wide');

    const prefs = loadDesktopPreferences();
    expect(prefs.assistantTextSize).toBe('default');
    expect(prefs.codeTextSize).toBe('default');
    expect(prefs.codeWrap).toBe(false);
    expect(prefs.toolDensity).toBe('comfortable');
    expect(prefs.workDetailsExpanded).toBe('auto');
    expect(prefs.artifactPreviewEnabled).toBe(true);
    expect(prefs.artifactCodeFirst).toBe(false);
    expect(prefs.conversationWidth).toBe('default');
  });

  it('codeWrap only parses true as true', () => {
    setLocalStorage('codeWrap', 'true');
    expect(loadDesktopPreferences().codeWrap).toBe(true);

    setLocalStorage('codeWrap', 'false');
    expect(loadDesktopPreferences().codeWrap).toBe(false);

    setLocalStorage('codeWrap', '');
    expect(loadDesktopPreferences().codeWrap).toBe(false);
  });
});

describe('DesktopPreferences saving and roundtrip', () => {
  beforeEach(() => {
    clearLocalStorage();
  });

  it('saves and reloads correctly', () => {
    const input: DesktopPreferences = {
      assistantTextSize: 'large',
      codeTextSize: 'small',
      codeWrap: true,
      toolDensity: 'compact',
      workDetailsExpanded: 'collapsed',
      artifactPreviewEnabled: true,
      artifactCodeFirst: true,
      verboseAgentChat: false,
      conversationWidth: 'narrow',
      appearanceMode: 'dark',
      lightTheme: {
        preset: 'default',
        background: '#FFFFFF',
        foreground: '#000000',
        accent: '#FF0000',
      },
      darkTheme: {
        preset: 'default',
        background: '#000000',
        foreground: '#FFFFFF',
        accent: '#00FF00',
      },
      dontAskRevertConfirm: true,
    };
    saveDesktopPreferences(input);

    const output = loadDesktopPreferences();
    expect(output).toEqual(input);
  });

  it('save then load with all-defaults roundtrips', () => {
    const defaults: DesktopPreferences = {
      assistantTextSize: 'default',
      codeTextSize: 'default',
      codeWrap: false,
      toolDensity: 'comfortable',
      workDetailsExpanded: 'auto',
      artifactPreviewEnabled: true,
      artifactCodeFirst: false,
      verboseAgentChat: true,
      conversationWidth: 'default',
      appearanceMode: 'system',
      lightTheme: {
        preset: 'default',
        background: '#EEEEEE',
        foreground: '#101010',
        accent: '#007ACC',
      },
      darkTheme: {
        preset: 'default',
        background: '#101010',
        foreground: '#CCCCCC',
        accent: '#007ACC',
      },
      dontAskRevertConfirm: false,
    };
    saveDesktopPreferences(defaults);

    const output = loadDesktopPreferences();
    expect(output).toEqual(defaults);
  });
});

describe('conversation width', () => {
  it('maps every width preference to its desktop conversation measure', () => {
    expect(resolveConversationWidth('narrow')).toBe('620px');
    expect(resolveConversationWidth('default')).toBe('780px');
    expect(resolveConversationWidth('wide')).toBe('1040px');
  });
});

describe('artifactCodeFirst', () => {
  beforeEach(() => {
    clearLocalStorage();
  });

  it('defaults to false when key missing', () => {
    expect(loadDesktopPreferences().artifactCodeFirst).toBe(false);
  });

  it('reads true from localStorage', () => {
    setLocalStorage('artifactCodeFirst', 'true');
    expect(loadDesktopPreferences().artifactCodeFirst).toBe(true);
  });

  it('reads false from localStorage', () => {
    setLocalStorage('artifactCodeFirst', 'false');
    expect(loadDesktopPreferences().artifactCodeFirst).toBe(false);
  });

  it('falls back to false on invalid value', () => {
    setLocalStorage('artifactCodeFirst', 'maybe');
    expect(loadDesktopPreferences().artifactCodeFirst).toBe(false);
  });

  it('roundtrips true through save/load', () => {
    saveDesktopPreferences({
      assistantTextSize: 'default',
      codeTextSize: 'default',
      codeWrap: false,
      toolDensity: 'comfortable',
      workDetailsExpanded: 'auto',
      artifactPreviewEnabled: true,
      artifactCodeFirst: true,
      verboseAgentChat: true,
      conversationWidth: 'wide',
      appearanceMode: 'system',
      lightTheme: {
        preset: 'default',
        background: '#EEEEEE',
        foreground: '#101010',
        accent: '#007ACC',
      },
      darkTheme: {
        preset: 'default',
        background: '#101010',
        foreground: '#CCCCCC',
        accent: '#007ACC',
      },
    });
    expect(loadDesktopPreferences().artifactCodeFirst).toBe(true);
  });
});
