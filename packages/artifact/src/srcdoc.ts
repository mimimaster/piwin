/**
 * Build sandboxed HTML srcdoc for artifact preview.
 * Security-first: strict CSP, no external network by default (except allowlisted frames).
 */
import { buildArtifactFrameSrcCsp, createDefaultArtifactIframePolicy } from './iframe-policy.js';
import { createDefaultArtifactTheme } from './theme.js';
import { buildArtifactBridgeBootstrapScript } from './srcdoc-bridge.js';
import { buildArtifactComponentKitCss } from './srcdoc-component-kit.js';
import { buildArtifactDiagramKitCss } from './srcdoc-diagram-kit.js';
import { buildArtifactReportKitCss } from './srcdoc-report-kit.js';
import {
  artifactPaletteNeedsContrastProbe,
  artifactPaletteStyleAttribute,
  type ArtifactPalette,
} from './artifact-style.js';
import { buildEmojiIconSrcdocHead, collectEmojiIcons } from './emoji-icons/emoji-icon-render.js';
import { artifactKitScriptSource, buildArtifactKitHead, usesArtifactKit } from './kit/index.js';
import {
  buildArtifactFrameModePolicyCss,
  buildArtifactMotionPolicyCss,
  buildArtifactScrollbarCss,
  buildArtifactThemeCss,
  buildArtifactThemeGuardCss,
} from './srcdoc-css.js';
import type {
  ArtifactDocumentKind,
  ArtifactFrameMode,
  ArtifactIframePolicy,
  ArtifactRules,
  ArtifactStyle,
  ArtifactSurface,
  ArtifactThemeVariables,
} from './types.js';

export { buildArtifactBridgeBootstrapScript } from './srcdoc-bridge.js';

export function buildStrictArtifactCsp(
  policy: ArtifactIframePolicy,
  options: { kitScriptSource?: string | null } = {},
): string {
  // The kit is the only non-inline script, and only on the scheme path.
  const kit = options.kitScriptSource ? ` ${options.kitScriptSource}` : '';
  return [
    "default-src 'none'",
    "base-uri 'none'",
    `script-src 'unsafe-inline'${kit}`,
    "style-src 'unsafe-inline'",
    'img-src data: blob:',
    'font-src data:',
    'media-src data: blob:',
    "connect-src 'none'",
    buildArtifactFrameSrcCsp(policy),
    "object-src 'none'",
    "form-action 'none'",
  ].join('; ');
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function frameModeFromSurface(surface: ArtifactSurface): ArtifactFrameMode {
  return surface === 'canvas' ? 'canvas' : 'inline-flow';
}

function setHtmlAttribute(attrs: string, name: string, value: string): string {
  const attr = `${name}="${escapeHtmlAttribute(value)}"`;
  const existing = new RegExp(`\\s${name}\\s*=\\s*(["']).*?\\1`, 'i');
  return existing.test(attrs) ? attrs.replace(existing, ` ${attr}`) : `${attrs} ${attr}`;
}

function applyHtmlFrameMode(
  source: string,
  frameMode: ArtifactFrameMode,
  style: ArtifactStyle,
): string {
  const htmlOpenPattern = /<html\b([^>]*)>/i;
  if (!htmlOpenPattern.test(source)) {
    return source;
  }
  return source.replace(
    htmlOpenPattern,
    (_open, attrs: string) =>
      `<html${setHtmlAttribute(setHtmlAttribute(attrs, 'data-frame-mode', frameMode), 'data-piwin-style', style)}>`,
  );
}

function injectArtifactHostIntoDocument(input: {
  source: string;
  headPrefix: string;
  headSuffix: string;
  frameMode: ArtifactFrameMode;
  style: ArtifactStyle;
}): string {
  const framed = applyHtmlFrameMode(input.source, input.frameMode, input.style);
  const headOpenPattern = /<head\b[^>]*>/i;
  const headClosePattern = /<\/head\s*>/i;
  if (headOpenPattern.test(framed)) {
    const withPrefix = framed.replace(
      headOpenPattern,
      (headOpen) => `${headOpen}\n${input.headPrefix}`,
    );
    return headClosePattern.test(withPrefix)
      ? withPrefix.replace(headClosePattern, `${input.headSuffix}\n</head>`)
      : `${withPrefix}\n${input.headSuffix}`;
  }

  const hostHead = `<head>\n${input.headPrefix}\n${input.headSuffix}\n</head>`;
  const htmlOpenPattern = /<html\b[^>]*>/i;
  if (htmlOpenPattern.test(framed)) {
    return framed.replace(htmlOpenPattern, (htmlOpen) => `${htmlOpen}\n${hostHead}`);
  }

  const doctypePattern = /<!doctype\s+[^>]*>/i;
  const sourceDoctype = framed.match(doctypePattern)?.[0] ?? '<!DOCTYPE html>';
  const documentBody = framed.replace(doctypePattern, '').trim();
  if (/<body\b[^>]*>/i.test(documentBody)) {
    return `${sourceDoctype}\n<html lang="en" data-frame-mode="${escapeHtmlAttribute(input.frameMode)}" data-piwin-style="${escapeHtmlAttribute(input.style)}">\n${hostHead}\n${documentBody}\n</html>`;
  }
  return `${sourceDoctype}\n<html lang="en" data-frame-mode="${escapeHtmlAttribute(input.frameMode)}" data-piwin-style="${escapeHtmlAttribute(input.style)}">\n${hostHead}\n<body>\n${documentBody}\n</body>\n</html>`;
}

export type BuildHtmlArtifactSrcdocInput = {
  source: string;
  channelId: string;
  theme?: ArtifactThemeVariables;
  iframePolicy?: ArtifactIframePolicy;
  /** Inline flows with the transcript; Canvas owns an internal scrollport. */
  surface?: ArtifactSurface;
  frameMode?: ArtifactFrameMode;
  /** Preserve full HTML documents instead of nesting them inside a fragment root. */
  documentKind?: ArtifactDocumentKind;
  /**
   * `host` (default) installs the full theme guard. `stage` (expressive)
   * guards only the page shell. `own` paints its own scene: no guard.
   */
  palette?: ArtifactPalette;
  /** Rules the source was written under (see `resolveArtifactRules`). Default legacy. */
  rules?: ArtifactRules;
  /**
   * Inject the chart/icon kit. Default: only when the source uses it. Stream
   * previews of v14 fences pass true because the source is still arriving.
   */
  kit?: boolean;
  /** When false, omit the parent bridge entirely. Default true. */
  includeBridge?: boolean;
  /** Accept sanitized parent snapshots without replacing the iframe document. */
  enableStreamUpdates?: boolean;
  /**
   * Interactive srcdocs already ran their scripts on load. Freeze source so
   * later render commands only change frameMode.
   */
  freezeSource?: boolean;
  /**
   * Emoji → Tabler icon runtime (ADR 0090). Default: glyphs the source uses;
   * a stream preview (`freezeSource: false`) ships all of them. False: off.
   */
  emojiIcons?: boolean;
};

/**
 * Wrap raw model HTML in a document with CSP meta + theme CSS + optional bridge.
 * Copy/export callers must use the original `source`, never this srcdoc.
 */
export function buildHtmlArtifactSrcdoc(input: BuildHtmlArtifactSrcdocInput): {
  srcdoc: string;
  csp: string;
} {
  const theme = input.theme ?? createDefaultArtifactTheme('dark');
  const iframePolicy = input.iframePolicy ?? createDefaultArtifactIframePolicy('allowlist');
  const surface = input.surface ?? 'inline';
  const frameMode = input.frameMode ?? frameModeFromSurface(surface);
  const includeBridge = input.includeBridge !== false;
  const enableRenderCommand = input.enableStreamUpdates !== false && includeBridge;
  const kit = input.kit ?? usesArtifactKit(input.source);
  const csp = buildStrictArtifactCsp(iframePolicy, {
    kitScriptSource: kit ? artifactKitScriptSource() : null,
  });
  const css = buildArtifactThemeCss(theme, { rules: input.rules ?? 'legacy' });
  const palette = input.palette ?? 'host';
  const themeGuardCss = palette === 'own' ? '' : buildArtifactThemeGuardCss(palette);
  const styleAttr = artifactPaletteStyleAttribute(palette);
  const frameModePolicyCss = buildArtifactFrameModePolicyCss();
  const motionPolicyCss = buildArtifactMotionPolicyCss();
  const channelId = input.channelId;
  const channelAttr = escapeHtmlAttribute(channelId);
  const frameModeAttr = escapeHtmlAttribute(frameMode);
  const bridge = includeBridge
    ? buildArtifactBridgeBootstrapScript(
        channelId,
        enableRenderCommand,
        frameMode,
        input.freezeSource === true,
        artifactPaletteNeedsContrastProbe(palette),
      )
    : '';

  const emojiIconHead =
    input.emojiIcons === false
      ? ''
      : buildEmojiIconSrcdocHead(
          input.freezeSource === false && enableRenderCommand ? 'all' : collectEmojiIcons(input.source),
        );
  const hostHeadPrefix = `
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="Content-Security-Policy" content="${escapeHtmlAttribute(csp)}" />
  <meta name="piwin-artifact-channel" content="${channelAttr}" />
  <style data-piwin-artifact-theme>${css}</style>
  <style data-piwin-artifact-report-kit>${buildArtifactReportKitCss({ rules: input.rules ?? 'legacy' })}</style>
  <style data-piwin-artifact-diagram-kit>${buildArtifactDiagramKitCss()}</style>
  <style data-piwin-artifact-component-kit>${buildArtifactComponentKitCss()}</style>
${bridge}${kit ? `\n  ${buildArtifactKitHead()}` : ''}${emojiIconHead ? `\n  ${emojiIconHead}` : ''}`;
  const themeGuardStyle = themeGuardCss
    ? `\n  <style data-piwin-artifact-theme-guard>${themeGuardCss}</style>`
    : '';
  const hostHeadSuffix = `${themeGuardStyle}
  <style data-piwin-artifact-frame-mode-policy>${frameModePolicyCss}</style>
  <style data-piwin-artifact-motion-policy>${motionPolicyCss}</style>
  <style data-piwin-artifact-scrollbar>${buildArtifactScrollbarCss()}</style>`;

  const srcdoc =
    input.documentKind === 'document'
      ? injectArtifactHostIntoDocument({
          source: input.source,
          headPrefix: hostHeadPrefix,
          headSuffix: hostHeadSuffix,
          frameMode,
          style: styleAttr,
        })
      : `<!DOCTYPE html>
<html lang="en" data-frame-mode="${frameModeAttr}" data-piwin-style="${styleAttr}">
<head>
${hostHeadPrefix}
</head>
<body>
  <div class="piwin-artifact-root">${input.source}</div>
${hostHeadSuffix}
</body>
</html>`;

  return { srcdoc, csp };
}
