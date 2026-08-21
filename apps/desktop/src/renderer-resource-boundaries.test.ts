import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function readSource(relativeUrl: string): string {
  return readFileSync(new URL(relativeUrl, import.meta.url), 'utf8');
}

/** Permanent product glass — change only with the memory-diet execution plan. */
const PRODUCT_GLASS_WHITELIST = [
  '.provider-editor-overlay',
  '.settings-feedback-host .ui-notice',
  '.collapsible-content-toggle',
  '.media-lightbox-close',
  ".app-shell[data-layout='compact'].nav-open > .sidebar",
  ".app-shell[data-layout='compact'].has-right-panel > .right-panel.outward-column:not(.is-collapsed)",
] as const;

const ALLOWED_PRODUCT_GLASS = new Set<string>(PRODUCT_GLASS_WHITELIST);

function normalizeSelector(selector: string): string {
  return selector.replace(/\s+/g, ' ').trim();
}

function listCssFiles(directory: string): string[] {
  const entries = readdirSync(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listCssFiles(fullPath));
      continue;
    }
    if (entry.name.endsWith('.css')) {
      files.push(fullPath);
    }
  }
  return files;
}

function ruleHasActiveBackdropBlur(declarations: string): boolean {
  for (const match of declarations.matchAll(/(-webkit-backdrop-filter|backdrop-filter)\s*:\s*([^;]+)/gi)) {
    const value = match[2]?.trim().toLowerCase() ?? '';
    if (value.length > 0 && !value.startsWith('none')) {
      return true;
    }
  }
  return false;
}

function collectActiveGlassSelectors(source: string): string[] {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const selectors: string[] = [];
  for (const rule of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectorList = rule[1];
    const declarations = rule[2];
    if (selectorList === undefined || declarations === undefined) {
      continue;
    }
    if (!ruleHasActiveBackdropBlur(declarations)) {
      continue;
    }
    for (const raw of selectorList.split(',')) {
      const selector = normalizeSelector(raw);
      if (selector.length > 0) {
        selectors.push(selector);
      }
    }
  }
  return selectors;
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
  it('allows backdrop-filter blur only on the memory-diet whitelist', () => {
    const srcRoot = fileURLToPath(new URL('.', import.meta.url));
    const unexpected: string[] = [];
    for (const cssPath of listCssFiles(srcRoot)) {
      const source = readFileSync(cssPath, 'utf8');
      for (const selector of collectActiveGlassSelectors(source)) {
        if (!ALLOWED_PRODUCT_GLASS.has(selector)) {
          unexpected.push(`${cssPath.slice(srcRoot.length)} :: ${selector}`);
        }
      }
    }
    expect(unexpected).toEqual([]);
  });

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

  it('ships a last-imported degradation layer that strips glass under pressure', () => {
    const mainStyles = readSource('./styles.css');
    const degradation = readSource('./styles/memory-degradation.css');

    // Must import last: the layer overrides every region sheet above it.
    const imports = [...mainStyles.matchAll(/@import\s+'([^']+)'/g)].map((match) => match[1]);
    expect(imports[imports.length - 1]).toBe('./styles/memory-degradation.css');

    for (const tier of ['moderate', 'critical']) {
      const declarations = ruleDeclarations(degradation, `html[data-memory-pressure='${tier}'] *`);
      expect(declarations).toContain('backdrop-filter: none !important');
      expect(declarations).toContain('-webkit-backdrop-filter: none !important');
    }
    // Critical additionally sheds decoded decorative textures.
    expect(ruleDeclarations(degradation, "html[data-memory-pressure='critical']")).toContain(
      '--ink-wash-hero: none !important',
    );

    // Parking may strip blur with the pressure rules, but must keep textures
    // so waking the window does not flash white while JPEGs re-decode.
    expect(ruleDeclarations(degradation, 'html[data-memory-parked] *')).toContain(
      'backdrop-filter: none !important',
    );
    expect(degradation).not.toMatch(/html\[data-memory-parked\]\s*\{[^}]*--ink-wash-/);
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
      'region-settings-plugins.css',
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

    const petBubble = readSource('./components/pet-bubble.css');
    expect(petBubble).not.toMatch(/@keyframes\s+pet-bubble-pulse[\s\S]*?box-shadow/);
  });

  it('does not ship deleted ink-wash source files', () => {
    const inkWashDir = fileURLToPath(new URL('../public/ui/ink-wash/', import.meta.url));
    const deadStems = ['lion-seal', 'inkstone-brush'] as const;
    for (const stem of deadStems) {
      expect(existsSync(join(inkWashDir, `${stem}.png`))).toBe(false);
      expect(existsSync(join(inkWashDir, `${stem}.jpg`))).toBe(false);
      expect(existsSync(join(inkWashDir, `${stem}-v2.png`))).toBe(true);
    }
    expect(existsSync(join(inkWashDir, 'card-paper-bg' + '.jpg'))).toBe(false);
    expect(existsSync(join(inkWashDir, 'master-bg.jpg'))).toBe(true);
    expect(existsSync(join(inkWashDir, 'hero.jpg'))).toBe(true);

    const deadRef = /lion-seal\.(png|jpg)|inkstone-brush\.(png|jpg)|card-paper-bg/;
    const desktopSrc = fileURLToPath(new URL('.', import.meta.url));
    const hits: string[] = [];
    for (const cssPath of listCssFiles(desktopSrc)) {
      if (deadRef.test(readFileSync(cssPath, 'utf8'))) {
        hits.push(cssPath.slice(desktopSrc.length));
      }
    }
    expect(hits).toEqual([]);
  });

  it('keeps composer and transcript thumbs off the original File / asset URL', () => {
    const composerMedia = readSource('./hooks/use-composer-media.ts');
    const mediaPreview = readSource('./MediaPreview.tsx');
    const transcriptPreview = readSource('./transcript-media-preview.ts');
    expect(composerMedia).toContain('beginComposerImagePreview');
    expect(composerMedia).toContain('commitLimitedChipPreview');
    expect(transcriptPreview).toContain('createLimitedPreviewUrlFromHref');
    expect(transcriptPreview).toContain('TRANSCRIPT_THUMB_MAX_EDGE_PX');
    expect(mediaPreview).toContain('decoding="async"');
  });

  it('does not import the Node flashcards barrel into the renderer', () => {
    // `@piwin/flashcards` re-exports card-store (node:fs). Loading that barrel
    // in the WebView whitescreens the shell. Browser code may only use /cloze.
    const desktopSrc = fileURLToPath(new URL('.', import.meta.url));
    const hits: string[] = [];
    const files: string[] = [];
    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const fullPath = join(directory, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
          continue;
        }
        if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
          files.push(fullPath);
        }
      }
    };
    walk(desktopSrc);
    const barrel = /from ['"]@piwin\/flashcards['"]/;
    for (const filePath of files) {
      const source = readFileSync(filePath, 'utf8');
      if (barrel.test(source)) {
        hits.push(filePath.slice(desktopSrc.length));
      }
    }
    expect(hits).toEqual([]);
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
