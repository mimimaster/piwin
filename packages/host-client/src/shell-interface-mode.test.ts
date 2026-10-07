import { describe, expect, it } from 'vitest';
import {
  SHELL_INTERFACE_MODE_STORAGE_KEY,
  injectShellInterfaceBoot,
  parseShellInterfaceMode,
  readShellInterfaceMode,
  shellInterfaceBootScript,
  shellInterfaceEntryPath,
  switchShellInterface,
  writeShellInterfaceMode,
} from './shell-interface-mode.js';

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

describe('shell interface mode', () => {
  it('defaults to the web interface for missing or unknown values', () => {
    expect(parseShellInterfaceMode(null)).toBe('web');
    expect(parseShellInterfaceMode('inkstone')).toBe('web');
    expect(parseShellInterfaceMode('classic')).toBe('classic');
    expect(readShellInterfaceMode(undefined)).toBe('web');
    expect(readShellInterfaceMode(memoryStorage())).toBe('web');
  });

  it('round-trips the choice through storage', () => {
    const storage = memoryStorage();
    writeShellInterfaceMode(storage, 'classic');
    expect(readShellInterfaceMode(storage)).toBe('classic');
    writeShellInterfaceMode(storage, 'web');
    expect(readShellInterfaceMode(storage)).toBe('web');
  });

  it('switching stores the mode before navigating to its entry page', () => {
    const storage = memoryStorage();
    const visited: string[] = [];
    const view = {
      localStorage: storage,
      location: {
        replace: (target: string | URL) => {
          // The destination page reads the mode as it boots.
          expect(readShellInterfaceMode(storage)).toBe('classic');
          visited.push(String(target));
        },
      },
    };
    switchShellInterface('classic', view);
    expect(visited).toEqual(['/classic/index.html']);
  });

  it('boots the default interface when storage throws', () => {
    const storage = {
      getItem: () => {
        throw new Error('storage disabled');
      },
      setItem: () => undefined,
    };
    expect(readShellInterfaceMode(storage)).toBe('web');
  });

  it('serves the web interface from the root and classic from its own folder', () => {
    expect(shellInterfaceEntryPath('web')).toBe('/index.html');
    expect(shellInterfaceEntryPath('classic')).toBe('/classic/index.html');
  });

  it('redirects to classic only when the stored mode says so', () => {
    const run = (stored: string | null): string | undefined => {
      let redirected: string | undefined;
      const fakeWindow = {
        localStorage: { getItem: () => stored },
        location: {
          replace: (target: string) => {
            redirected = target;
          },
        },
      };
      new Function('window', shellInterfaceBootScript())(fakeWindow);
      return redirected;
    };
    expect(run('classic')).toBe('/classic/index.html');
    expect(run('web')).toBeUndefined();
    expect(run(null)).toBeUndefined();
    expect(shellInterfaceBootScript()).toContain(SHELL_INTERFACE_MODE_STORAGE_KEY);
  });

  it('puts the boot script ahead of everything else in the page head', () => {
    const html = '<!doctype html><html><head><meta charset="UTF-8" /><script src="/a.js"></script></head></html>';
    const injected = injectShellInterfaceBoot(html);
    expect(injected.indexOf('<script>(function')).toBe(html.indexOf('<head>') + '<head>'.length);
    expect(injected.indexOf('<script>(function')).toBeLessThan(injected.indexOf('/a.js'));
    expect(() => injectShellInterfaceBoot('<html></html>')).toThrow();
  });
});
