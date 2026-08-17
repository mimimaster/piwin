import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readSource(relativeUrl: string): string {
  return readFileSync(new URL(relativeUrl, import.meta.url), 'utf8');
}

function ruleDeclarations(source: string, selector: string): string {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g);
  for (const rule of rules) {
    const selectorList = rule[1];
    const declarations = rule[2];
    if (selectorList === undefined || declarations === undefined) {
      continue;
    }
    if (selectorList.split(',').some((candidate) => candidate.trim() === selector)) {
      return declarations;
    }
  }
  throw new Error(`CSS rule not found: ${selector}`);
}

describe('Desktop renderer resource boundaries', () => {
  it('keeps the stage a solid canvas without per-panel backdrop filters', () => {
    const shell = readSource('./styles/region-shell.css');
    const contextBar = readSource('./styles/region-context-bar.css');

    // The stage is a solid canvas since the glass mix flashed white during
    // high-frequency stream reflow (SVG artifact height growth). Blur must
    // not be re-applied per panel (chat-column / document stage / context
    // bar) — that would re-composite expensive backdrop filters.
    expect(ruleDeclarations(shell, '.workspace')).not.toContain('backdrop-filter');
    expect(ruleDeclarations(shell, '.chat-column')).not.toContain('backdrop-filter');
    expect(ruleDeclarations(shell, '.workspace-document-stage')).not.toContain('backdrop-filter');
    expect(ruleDeclarations(contextBar, '.context-bar')).not.toContain('backdrop-filter');
  });

  it('keeps settings CSS and feature modules out of the cold main entries', () => {
    const mainStyles = readSource('./styles.css');
    const settingsStyles = readSource('./styles/settings.css');
    const settingsPanel = readSource('./SettingsPanel.tsx');
    const app = readSource('./App.tsx');
    const deferredSurfaces = readSource('./deferred-desktop-surfaces.tsx');
    const composerMedia = readSource('./hooks/use-composer-media.ts');
    const hostClient = readSource('./host-client.ts');
    const mockHostClient = readSource('./host-client-mock.ts');
    const syntaxHighlight = readSource('./syntax-highlight.tsx');

    for (const settingsSheet of [
      'region-settings-shell.css',
      'region-settings-models.css',
      'region-settings-speech.css',
      'region-settings-vision.css',
      'region-settings-knowledge.css',
      'settings-resources.css',
    ]) {
      expect(mainStyles).not.toContain(settingsSheet);
      expect(settingsStyles).toContain(settingsSheet);
    }
    expect(settingsPanel).toContain("import './styles/settings.css'");
    expect(app).not.toContain("from './SettingsPanel'");
    expect(app).not.toContain("from './KnowledgeCenterPanel'");
    expect(deferredSurfaces).toContain("import('./SettingsPanel')");
    expect(deferredSurfaces).toContain("import('./browser-session-panel')");
    expect(deferredSurfaces).toContain("import('./terminal-dock')");
    expect(composerMedia).not.toContain("from '../file-tree-panel'");
    expect(composerMedia).toContain("from '../workspace-path-drag'");
    expect(hostClient).toContain("import type { MockHostBackend } from './host-client-mock'");
    expect(hostClient).toContain("import('./host-client-mock')");
    expect(mockHostClient).not.toContain("from '@piwin/session'");
    expect(mockHostClient).toContain("from '@piwin/session/fork-session-name'");
    expect(syntaxHighlight).toContain("import type { Highlighter, ThemedToken } from 'shiki'");
    expect(syntaxHighlight).toContain("import('shiki')");
  });

  it('uses one deterministic local development origin', () => {
    const viteConfig = readSource('../vite.config.ts');
    const tauriConfig = JSON.parse(readSource('../src-tauri/tauri.conf.json')) as {
      build?: { devUrl?: unknown };
    };

    expect(viteConfig).toContain("const serverHost = remoteDevHost ?? '127.0.0.1'");
    expect(viteConfig).toContain('host: serverHost');
    expect(tauriConfig.build?.devUrl).toBe('http://127.0.0.1:1420');
  });
});
