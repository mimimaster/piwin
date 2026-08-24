/**
 * Build sandboxed HTML srcdoc for artifact preview.
 * Security-first: strict CSP, no external network by default (except allowlisted frames).
 */
import { buildArtifactFrameSrcCsp, createDefaultArtifactIframePolicy } from './iframe-policy.js';
import { createDefaultArtifactTheme } from './theme.js';
import { buildArtifactBridgeBootstrapScript } from './srcdoc-bridge.js';
import {
  buildArtifactFrameModePolicyCss,
  buildArtifactMotionPolicyCss,
  buildArtifactThemeCss,
  buildArtifactThemeGuardCss,
} from './srcdoc-css.js';
import type {
  ArtifactDocumentKind,
  ArtifactFrameMode,
  ArtifactIframePolicy,
  ArtifactSurface,
  ArtifactThemeVariables,
} from './types.js';

export { buildArtifactBridgeBootstrapScript } from './srcdoc-bridge.js';

export function buildStrictArtifactCsp(policy: ArtifactIframePolicy): string {
  return [
    "default-src 'none'",
    "base-uri 'none'",
    "script-src 'unsafe-inline'",
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

function applyHtmlFrameMode(source: string, frameMode: ArtifactFrameMode): string {
  const htmlOpenPattern = /<html\b([^>]*)>/i;
  if (!htmlOpenPattern.test(source)) {
    return source;
  }
  return source.replace(htmlOpenPattern, (_open, attrs: string) => {
    const modeAttr = `data-frame-mode="${escapeHtmlAttribute(frameMode)}"`;
    if (/\bdata-frame-mode\s*=/i.test(attrs)) {
      return `<html${attrs.replace(/\sdata-frame-mode\s*=\s*(["']).*?\1/i, ` ${modeAttr}`)}>`;
    }
    return `<html${attrs} ${modeAttr}>`;
  });
}

function injectArtifactHostIntoDocument(input: {
  source: string;
  headPrefix: string;
  headSuffix: string;
  frameMode: ArtifactFrameMode;
}): string {
  const framed = applyHtmlFrameMode(input.source, input.frameMode);
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
    return `${sourceDoctype}\n<html lang="en" data-frame-mode="${escapeHtmlAttribute(input.frameMode)}">\n${hostHead}\n${documentBody}\n</html>`;
  }
  return `${sourceDoctype}\n<html lang="en" data-frame-mode="${escapeHtmlAttribute(input.frameMode)}">\n${hostHead}\n<body>\n${documentBody}\n</body>\n</html>`;
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
  /** When false, omit the parent bridge entirely. Default true. */
  includeBridge?: boolean;
  /** Accept sanitized parent snapshots without replacing the iframe document. */
  enableStreamUpdates?: boolean;
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
  const csp = buildStrictArtifactCsp(iframePolicy);
  const css = buildArtifactThemeCss(theme);
  const themeGuardCss = buildArtifactThemeGuardCss();
  const frameModePolicyCss = buildArtifactFrameModePolicyCss();
  const motionPolicyCss = buildArtifactMotionPolicyCss();
  const channelId = input.channelId;
  const channelAttr = escapeHtmlAttribute(channelId);
  const frameModeAttr = escapeHtmlAttribute(frameMode);
  const bridge = includeBridge
    ? buildArtifactBridgeBootstrapScript(channelId, enableRenderCommand, frameMode)
    : '';

  const hostHeadPrefix = `
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="Content-Security-Policy" content="${escapeHtmlAttribute(csp)}" />
  <meta name="piwin-artifact-channel" content="${channelAttr}" />
  <style data-piwin-artifact-theme>${css}</style>
${bridge}`;
  const hostHeadSuffix = `
  <style data-piwin-artifact-theme-guard>${themeGuardCss}</style>
  <style data-piwin-artifact-frame-mode-policy>${frameModePolicyCss}</style>
  <style data-piwin-artifact-motion-policy>${motionPolicyCss}</style>`;

  const srcdoc =
    input.documentKind === 'document'
      ? injectArtifactHostIntoDocument({
          source: input.source,
          headPrefix: hostHeadPrefix,
          headSuffix: hostHeadSuffix,
          frameMode,
        })
      : `<!DOCTYPE html>
<html lang="en" data-frame-mode="${frameModeAttr}">
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
