import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  loadDesktopPreferences,
  saveDesktopPreferences,
  loadToolCallDensity,
} from './ui-preferences';
import type { DesktopPreferences } from './ui-preferences';

const PREFIX = 'piwin.desktop.';

// Minimal localStorage mock for Node test environment.
function createMockStorage(): Record<string, string> {
  const store: Record<string, string> = {};
  return new Proxy(store, {
    get(target, prop) {
      if (prop === 'getItem') return (key: string) => target[key] ?? null;
      if (prop === 'setItem') return (key: string, value: string) => { target[key] = value; };
      if (prop === 'removeItem') return (key: string) => { delete target[key]; };
      if (prop === 'clear') return () => { for (const k of Object.keys(target)) delete target[k]; };
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
    });
  });

  it('parses stored values correctly', () => {
    setLocalStorage('assistantTextSize', 'large');
    setLocalStorage('codeTextSize', 'small');
    setLocalStorage('codeWrap', 'true');
    setLocalStorage('toolCallDensity', 'compact');
    setLocalStorage('workDetailsExpanded', 'always');

    const prefs = loadDesktopPreferences();
    expect(prefs).toEqual<DesktopPreferences>({
      assistantTextSize: 'large',
      codeTextSize: 'small',
      codeWrap: true,
      toolDensity: 'compact',
      workDetailsExpanded: 'always',
    });
  });

  it('handles missing keys gracefully (partial localStorage)', () => {
    setLocalStorage('assistantTextSize', 'small');
    // codeTextSize, codeWrap, toolCallDensity, workDetailsExpanded missing

    const prefs = loadDesktopPreferences();
    expect(prefs.assistantTextSize).toBe('small');
    expect(prefs.codeTextSize).toBe('default');
    expect(prefs.codeWrap).toBe(false);
    expect(prefs.toolDensity).toBe('comfortable');
    expect(prefs.workDetailsExpanded).toBe('auto');
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

    const prefs = loadDesktopPreferences();
    expect(prefs.assistantTextSize).toBe('default');
    expect(prefs.codeTextSize).toBe('default');
    expect(prefs.codeWrap).toBe(false);
    expect(prefs.toolDensity).toBe('comfortable');
    expect(prefs.workDetailsExpanded).toBe('auto');
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
    };
    saveDesktopPreferences(defaults);

    const output = loadDesktopPreferences();
    expect(output).toEqual(defaults);
  });
});
