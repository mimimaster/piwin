/**
 * Build sandboxed HTML srcdoc for artifact preview.
 * Security-first: strict CSP, no external network by default (except allowlisted frames).
 * Includes height postMessage bridge (ported from openwebui_m, renamed piwin).
 */
import {
  ARTIFACT_BRIDGE_READY_TYPE,
  ARTIFACT_BRIDGE_RESIZE_TYPE,
  ARTIFACT_HEIGHT_MEASURE_LADDER_MS,
} from './constants.js';
import { buildArtifactFrameSrcCsp, createDefaultArtifactIframePolicy } from './iframe-policy.js';
import { createDefaultArtifactTheme } from './theme.js';
import type { ArtifactIframePolicy, ArtifactThemeVariables } from './types.js';

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

function escapeCssValue(value: string): string {
  return value.replace(/[;{}]/g, '').trim();
}

function buildResponsiveCss(theme: ArtifactThemeVariables): string {
  const variables = Object.entries(theme)
    .map(([name, value]) => `  ${name}: ${escapeCssValue(value)};`)
    .join('\n');
  const colorScheme = theme['--piwin-artifact-theme'] === 'dark' ? 'dark' : 'light';
  return `
:root {
${variables}
  color-scheme: ${colorScheme};
}
html {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  background: transparent;
  overflow: hidden;
}
*, *::before, *::after { box-sizing: inherit; }
body {
  margin: 0;
  padding: 0;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  background: transparent;
  color: var(--piwin-artifact-text);
  font-family: var(--piwin-artifact-font);
  overflow: hidden;
  overflow-wrap: break-word;
}
img, svg, canvas, video { max-width: 100%; height: auto; }
a { color: var(--piwin-artifact-accent); }
button, input, select, textarea { font: inherit; }
.piwin-artifact-root {
  width: 100%;
  min-width: 0;
  max-width: 100%;
  padding: 8px;
  background: transparent;
  color: var(--piwin-artifact-text);
}
.piwin-artifact-surface {
  background: var(--piwin-artifact-surface);
  color: var(--piwin-artifact-text);
  border-radius: var(--piwin-artifact-radius);
}
.piwin-artifact-root iframe {
  display: block;
  width: 100%;
  max-width: 100%;
  border: 0;
}
.piwin-artifact-root iframe[src*="youtube.com/embed"],
.piwin-artifact-root iframe[src*="youtube-nocookie.com/embed"] {
  aspect-ratio: 16 / 9;
  min-height: 180px;
}
.piwin-artifact-root iframe[src*="google.com/maps"],
.piwin-artifact-root iframe[src*="maps.google.com"] {
  height: 360px;
  max-height: 480px;
  min-height: 240px;
}
`;
}

/**
 * Bootstrap script inside the sandboxed document.
 * Posts ready/resize with channelId; parent validates source + channel.
 */
export function buildArtifactBridgeBootstrapScript(channelId: string): string {
  const serializedChannelId = JSON.stringify(channelId);
  const readyType = JSON.stringify(ARTIFACT_BRIDGE_READY_TYPE);
  const resizeType = JSON.stringify(ARTIFACT_BRIDGE_RESIZE_TYPE);
  const ladder = JSON.stringify([...ARTIFACT_HEIGHT_MEASURE_LADDER_MS]);

  return `
<script data-piwin-artifact-bridge-bootstrap>
(function () {
  var channelId = ${serializedChannelId};
  var readyType = ${readyType};
  var resizeType = ${resizeType};
  var measureLadder = ${ladder};
  var post = function (type, payload) {
    parent.postMessage(Object.assign({ type: type, channelId: channelId }, payload || {}), '*');
  };
  var readHeight = function (height) {
    return Math.max(0, Math.ceil(height || 0));
  };
  var isVisibleElement = function (element) {
    if (!element || !element.getBoundingClientRect) return false;
    var style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    return true;
  };
  var readRenderedBoxHeight = function (element) {
    if (!element || !isVisibleElement(element)) return 0;
    var rect = element.getBoundingClientRect();
    return Math.max(0, rect.height || 0, element.scrollHeight || 0, element.offsetHeight || 0);
  };
  var readVisibleBoundsHeight = function (root) {
    if (!root || !root.querySelectorAll) return 0;
    var rootRect = root.getBoundingClientRect();
    var rootTop = rootRect.top + window.scrollY;
    var bottom = rootTop + readRenderedBoxHeight(root);
    root.querySelectorAll('*').forEach(function (element) {
      if (!isVisibleElement(element)) return;
      var rect = element.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;
      var elementTop = rect.top + window.scrollY;
      var elementBoxHeight = Math.max(rect.height || 0, element.scrollHeight || 0, element.offsetHeight || 0);
      if (Number.isFinite(rect.bottom)) bottom = Math.max(bottom, rect.bottom + window.scrollY);
      if (Number.isFinite(elementTop) && elementBoxHeight > 0) {
        bottom = Math.max(bottom, elementTop + elementBoxHeight);
      }
    });
    return Math.max(0, bottom - rootTop);
  };
  var readBootstrapContentHeight = function () {
    var root = document.querySelector('.piwin-artifact-root');
    var body = document.body;
    var documentElement = document.documentElement;
    if (root) {
      return Math.max(readRenderedBoxHeight(root), readVisibleBoundsHeight(root));
    }
    return Math.max(
      readRenderedBoxHeight(body),
      readVisibleBoundsHeight(body),
      readRenderedBoxHeight(documentElement)
    );
  };
  var measure = function (mode) {
    post(resizeType, {
      height: readHeight(readBootstrapContentHeight()),
      mode: mode || 'normal'
    });
  };
  var ready = function () {
    post(readyType, { height: readHeight(readBootstrapContentHeight()) });
    measure('normal');
  };
  var scheduleMeasure = function () {
    requestAnimationFrame(function () { measure('normal'); });
  };
  var scheduleMeasureLadder = function (mode) {
    measureLadder.forEach(function (delay) {
      setTimeout(function () { measure(mode || 'normal'); }, delay);
    });
  };
  var mutationObserverInstalled = false;
  var installMutationObserver = function () {
    if (mutationObserverInstalled || !document.body || !('MutationObserver' in window)) return;
    mutationObserverInstalled = true;
    new MutationObserver(scheduleMeasure).observe(document.body, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true
    });
  };

  window.addEventListener('DOMContentLoaded', function () {
    installMutationObserver();
    ready();
    scheduleMeasureLadder('normal');
  });
  window.addEventListener('load', function () {
    installMutationObserver();
    ready();
    scheduleMeasureLadder('normal');
  });
  window.addEventListener('resize', scheduleMeasure, true);
  window.addEventListener('click', function () { scheduleMeasureLadder('interaction'); }, true);
  window.addEventListener('input', function () { scheduleMeasureLadder('interaction'); }, true);
  window.addEventListener('change', function () { scheduleMeasureLadder('interaction'); }, true);
  window.addEventListener('toggle', function () { scheduleMeasureLadder('interaction'); }, true);
  window.addEventListener('transitionend', function () { scheduleMeasureLadder('interaction'); }, true);
  window.addEventListener('animationend', function () { scheduleMeasureLadder('interaction'); }, true);

  requestAnimationFrame(function () {
    installMutationObserver();
    ready();
    scheduleMeasureLadder('normal');
  });
})();
</script>`;
}

export type BuildHtmlArtifactSrcdocInput = {
  source: string;
  channelId: string;
  theme?: ArtifactThemeVariables;
  iframePolicy?: ArtifactIframePolicy;
  /** When false, omit height bridge (stream-preview can still include it). Default true. */
  includeBridge?: boolean;
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
  const includeBridge = input.includeBridge !== false;
  const csp = buildStrictArtifactCsp(iframePolicy);
  const css = buildResponsiveCss(theme);
  const channelId = input.channelId;
  const channelAttr = escapeHtmlAttribute(channelId);
  const bridge = includeBridge ? buildArtifactBridgeBootstrapScript(channelId) : '';

  const srcdoc = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="${escapeHtmlAttribute(csp)}" />
  <meta name="piwin-artifact-channel" content="${channelAttr}" />
  <style data-piwin-artifact-theme>${css}</style>
</head>
<body>
  <div class="piwin-artifact-root">
${input.source}
  </div>
${bridge}
</body>
</html>`;

  return { srcdoc, csp };
}
