/**
 * Build sandboxed HTML srcdoc for artifact preview.
 * Security-first: strict CSP, no external network by default (except allowlisted frames).
 * Inline includes one revisioned root-size bridge; Canvas owns its viewport.
 */
import {
  ARTIFACT_ACTION_NAMES,
  ARTIFACT_BRIDGE_ACTION_TYPE,
  ARTIFACT_BRIDGE_SIZE_TYPE,
  ARTIFACT_BRIDGE_STREAM_UPDATE_TYPE,
} from './constants.js';
import { buildArtifactFrameSrcCsp, createDefaultArtifactIframePolicy } from './iframe-policy.js';
import { createDefaultArtifactTheme } from './theme.js';
import type {
  ArtifactDocumentKind,
  ArtifactIframePolicy,
  ArtifactSurface,
  ArtifactThemeVariables,
} from './types.js';

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

function buildResponsiveCss(theme: ArtifactThemeVariables, surface: ArtifactSurface): string {
  const variables = Object.entries(theme)
    .map(([name, value]) => `  ${name}: ${escapeCssValue(value)};`)
    .join('\n');
  const colorScheme = theme['--piwin-artifact-theme'] === 'dark' ? 'dark' : 'light';
  if (surface === 'canvas') {
    return `
:root {
${variables}
  color-scheme: ${colorScheme};
}
html {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  min-height: 100%;
  height: 100%;
  background: transparent;
  overflow: auto;
}
*, *::before, *::after { box-sizing: inherit; }
body {
  margin: 0;
  width: 100%;
  min-width: 0;
  min-height: 100%;
  background: transparent;
  color: var(--piwin-artifact-text);
  font-family: var(--piwin-artifact-font);
  overflow: auto;
}
.piwin-artifact-root {
  width: 100%;
  min-width: 0;
  min-height: 100%;
}
img, svg, canvas, video { max-width: 100%; }
a { color: var(--piwin-artifact-accent); }
button, input, select, textarea { font: inherit; }
`;
  }
  const pageOverflow = 'hidden';
  const inlineFlowCss =
    surface === 'inline'
      ? `
.piwin-artifact-root {
  container-type: inline-size;
  overflow: visible !important;
}
.piwin-artifact-root > *,
.piwin-artifact-root img,
.piwin-artifact-root svg,
.piwin-artifact-root canvas,
.piwin-artifact-root video,
.piwin-artifact-root iframe,
.piwin-artifact-root table,
.piwin-artifact-root pre {
  min-width: 0 !important;
  max-width: 100% !important;
}
.piwin-artifact-root pre,
.piwin-artifact-root code {
  white-space: pre-wrap !important;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.piwin-artifact-root table {
  width: 100% !important;
  table-layout: fixed;
}
.piwin-artifact-root th,
.piwin-artifact-root td {
  overflow-wrap: anywhere;
}
`
      : '';
  return `
:root {
${variables}
  color-scheme: ${colorScheme};
}
html {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  min-height: auto !important;
  height: auto !important;
  background: transparent;
  overflow-x: ${pageOverflow} !important;
  overflow-y: ${pageOverflow} !important;
}
*, *::before, *::after { box-sizing: inherit; }
body {
  margin: 0;
  padding: 0;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  min-height: auto !important;
  height: auto !important;
  background: transparent;
  color: var(--piwin-artifact-text);
  font-family: var(--piwin-artifact-font);
  overflow-x: ${pageOverflow} !important;
  overflow-y: ${pageOverflow} !important;
  overflow-wrap: break-word;
}
body > *, body > div {
  min-height: auto !important;
}
img, svg, canvas, video { max-width: 100%; height: auto; }
/* Native SVG fences often declare a fixed width. Constrain to the iframe
   measure and center so fixed-width art is not left-pinned / clipped. */
.piwin-artifact-root > svg {
  display: block;
  width: auto;
  max-width: 100% !important;
  height: auto;
  margin-inline: auto;
  background: transparent;
  overflow: visible;
}
a { color: var(--piwin-artifact-accent); }
button, input, select, textarea { font: inherit; }
.piwin-artifact-root,
.artifact-root,
.owi-artifact-root {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  min-height: auto !important;
  height: auto !important;
  padding: 4px 0;
  background: transparent;
  color: var(--piwin-artifact-text);
  overflow-x: hidden;
  box-sizing: border-box;
}
/* HTML UI roots should stretch full width; only bare SVG fences stay centered. */
.piwin-artifact-root > :not(svg) {
  align-self: stretch;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
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
${inlineFlowCss}
`;
}

function buildArtifactMotionPolicyCss(): string {
  return `
.piwin-artifact-root,
.piwin-artifact-root *,
.piwin-artifact-root *::before,
.piwin-artifact-root *::after {
  animation: none !important;
  transition: none !important;
  scroll-behavior: auto !important;
}
.piwin-artifact-root animate,
.piwin-artifact-root animateMotion,
.piwin-artifact-root animateTransform,
.piwin-artifact-root set {
  display: none !important;
}
`;
}

/**
 * Final cascade layer ported from openwebui_m's artifactThemeContract.
 * The document canvas stays transparent while fixed-light model surfaces are
 * mapped to the active Artifact surface token. This is deliberately emitted
 * after model HTML.
 */
function buildArtifactThemeGuardCss(): string {
  return `
html,
body,
.piwin-artifact-root,
.artifact-root,
.owi-artifact-root {
  background: transparent !important;
  color: var(--piwin-artifact-text) !important;
}
.piwin-artifact-surface,
.bg-white,
.bg-gray-50,
.bg-gray-100,
.bg-gray-200,
.bg-gray-300,
[class*="bg-[rgba(255" i],
[class*="bg-[#fff" i],
[class*="bg-[#fafafa" i],
[class*="bg-[#f5f5f5" i],
[style*="background: white" i],
[style*="background-color: white" i],
[style*="background: #fff" i],
[style*="background-color: #fff" i],
[style*="background: #fafafa" i],
[style*="background-color: #fafafa" i],
[style*="background: #f5f5f5" i],
[style*="background-color: #f5f5f5" i],
[style*="background: rgb(255" i],
[style*="background-color: rgb(255" i],
[style*="background: rgb(250" i],
[style*="background-color: rgb(250" i],
[style*="background: rgba(255" i],
[style*="background-color: rgba(255" i],
[style*="background: rgba(250" i],
[style*="background-color: rgba(250" i] {
  background: var(--piwin-artifact-surface) !important;
  color: var(--piwin-artifact-text);
}
`;
}

function buildArtifactSurfacePolicyCss(surface: ArtifactSurface): string {
  const pageOverflow = surface === 'canvas' ? 'auto' : 'hidden';
  return `
html,
body {
  overflow-x: ${pageOverflow} !important;
  overflow-y: ${pageOverflow} !important;
}
${
  surface === 'inline'
    ? `.piwin-artifact-root {
  overflow: visible !important;
  min-width: 0 !important;
  max-width: 100% !important;
}
/* Never apply max-width to SVG *descendants* (path/circle/g) — that collapses
   intrinsic SVG layout in WKWebView. Only constrain the root svg / HTML kids. */
.piwin-artifact-root > :not(svg) {
  min-width: 0 !important;
  max-width: 100% !important;
}`
    : ''
}
`;
}

/**
 * Bootstrap script inside the sandboxed document.
 * Posts one revisioned content-size stream; parent validates source + channel.
 */
export function buildArtifactBridgeBootstrapScript(
  channelId: string,
  enableStreamUpdates = false,
  measureHeight = true,
): string {
  const serializedChannelId = JSON.stringify(channelId);
  const sizeType = JSON.stringify(ARTIFACT_BRIDGE_SIZE_TYPE);
  const heightBootstrap = measureHeight
    ? `
  var sizeType = ${sizeType};
  var sizeRevision = 0;
  var lastReportedHeight = -1;
  var heightFrame = null;
  var readHeight = function (height) {
    return Math.max(0, Math.ceil(height || 0));
  };
  var reportHeight = function () {
    heightFrame = null;
    var root = document.querySelector('.piwin-artifact-root');
    if (!root || !root.getBoundingClientRect) return;
    var height = readHeight(root.getBoundingClientRect().height);
    if (height === lastReportedHeight) return;
    lastReportedHeight = height;
    post(sizeType, {
      height: height,
      viewportHeight: readHeight(window.innerHeight),
      revision: sizeRevision
    });
    sizeRevision += 1;
  };
  var scheduleHeight = function () {
    if (heightFrame !== null) return;
    heightFrame = requestAnimationFrame(reportHeight);
  };
  var startHeightObserver = function () {
    var root = document.querySelector('.piwin-artifact-root');
    if (!root) return;
    if (window.ResizeObserver) {
      var observer = new window.ResizeObserver(scheduleHeight);
      observer.observe(root);
    }
    scheduleHeight();
  };`
    : `
  // Canvas owns its viewport and scrollport; it never reports document height.
  var scheduleHeight = function () {};
  var startHeightObserver = function () {};`;
  const streamUpdateBootstrap = enableStreamUpdates
    ? `
  var streamUpdateType = ${JSON.stringify(ARTIFACT_BRIDGE_STREAM_UPDATE_TYPE)};
  var syncAttributes = function (current, next) {
    Array.prototype.slice.call(current.attributes).forEach(function (attribute) {
      if (!next.hasAttribute(attribute.name)) current.removeAttribute(attribute.name);
    });
    Array.prototype.slice.call(next.attributes).forEach(function (attribute) {
      if (current.getAttribute(attribute.name) !== attribute.value) {
        current.setAttribute(attribute.name, attribute.value);
      }
    });
  };
  var syncNode = function (current, next) {
    if (
      current.nodeType !== next.nodeType ||
      (current.nodeType === 1 && current.nodeName !== next.nodeName)
    ) {
      current.replaceWith(next.cloneNode(true));
      return;
    }
    if (current.nodeType === 3 || current.nodeType === 8) {
      if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue;
      return;
    }
    if (current.nodeType === 1) syncAttributes(current, next);
    syncChildren(current, next);
  };
  var syncChildren = function (currentParent, nextParent) {
    var currentChild = currentParent.firstChild;
    var nextChild = nextParent.firstChild;
    while (nextChild) {
      var followingCurrentChild = currentChild ? currentChild.nextSibling : null;
      var followingNextChild = nextChild.nextSibling;
      if (currentChild) syncNode(currentChild, nextChild);
      else currentParent.appendChild(nextChild.cloneNode(true));
      currentChild = followingCurrentChild;
      nextChild = followingNextChild;
    }
    while (currentChild) {
      var removableChild = currentChild;
      currentChild = currentChild.nextSibling;
      removableChild.remove();
    }
  };
  var activateFinalScripts = function (root) {
    Array.prototype.slice.call(root.querySelectorAll('script')).forEach(function (current) {
      var replacement = document.createElement('script');
      Array.prototype.slice.call(current.attributes).forEach(function (attribute) {
        replacement.setAttribute(attribute.name, attribute.value);
      });
      replacement.textContent = current.textContent || '';
      current.replaceWith(replacement);
    });
  };
  var onStreamUpdate = function (event) {
    var data = event.data;
    if (
      !data ||
      data.type !== streamUpdateType ||
      data.channelId !== channelId ||
      typeof data.source !== 'string'
    ) return;
    var root = document.querySelector('.piwin-artifact-root');
    if (!root) return;
    var template = document.createElement('template');
    template.innerHTML = data.source;
    syncChildren(root, template.content);
    if (data.final === true) {
      // The final snapshot ends DOM streaming. Height observation remains
      // active because interactive scripts may change normal-flow size later.
      window.removeEventListener('message', onStreamUpdate);
      activateFinalScripts(root);
      setTimeout(function () {
        document.dispatchEvent(new Event('DOMContentLoaded'));
        window.dispatchEvent(new Event('load'));
        scheduleHeight();
      }, 0);
      return;
    }
    scheduleHeight();
  };
  window.addEventListener('message', onStreamUpdate);`
    : '';

  return `
<script data-piwin-artifact-bridge-bootstrap>
(function () {
  var channelId = ${serializedChannelId};
  var post = function (type, payload) {
    var message = Object.assign({ type: type, channelId: channelId }, payload || {});
    var nativeHandler =
      window.webkit &&
      window.webkit.messageHandlers &&
      window.webkit.messageHandlers.piwinArtifact;
    if (nativeHandler) {
      nativeHandler.postMessage(JSON.stringify(message));
      return;
    }
    // Browser/dev fallback; packaged WKWebView uses its frame-scoped handler.
    parent.postMessage(message, '*');
  };
  // Whitelisted action channel for interactive artifacts (e.g. flashcards).
  // Model HTML calls window.piwinArtifact.postAction(name, payload); the
  // parent validates name/payload again before acting.
  var actionType = ${JSON.stringify(ARTIFACT_BRIDGE_ACTION_TYPE)};
  var allowedActions = ${JSON.stringify([...ARTIFACT_ACTION_NAMES])};
  window.piwinArtifact = {
    postAction: function (action, payload) {
      if (allowedActions.indexOf(action) === -1) return false;
      post(actionType, { action: action, payload: payload || {} });
      return true;
    }
  };
  // Sandbox has no allow-downloads: intercept fake download buttons / <a download>
  // and tell the parent to toast "unsupported" instead of failing silently.
  var reportDownloadUnsupported = function (filename) {
    var payload = {};
    if (typeof filename === 'string' && filename.length > 0 && filename.length <= 256) {
      payload.filename = filename;
    }
    post(actionType, { action: 'artifact/download-unsupported', payload: payload });
  };
  var looksLikeDownloadAnchor = function (anchor) {
    if (!anchor || anchor.tagName !== 'A') return false;
    if (anchor.hasAttribute('download') || (anchor.download && anchor.download.length > 0)) {
      return true;
    }
    var href = anchor.getAttribute('href') || '';
    return /^(blob:|data:)/i.test(href);
  };
  document.addEventListener(
    'click',
    function (event) {
      var node = event.target;
      while (node && node !== document && node !== document.documentElement) {
        if (node.tagName === 'A' && looksLikeDownloadAnchor(node)) {
          event.preventDefault();
          event.stopPropagation();
          reportDownloadUnsupported(node.getAttribute('download') || node.download || '');
          return;
        }
        node = node.parentElement;
      }
    },
    true,
  );
  var originalAnchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (looksLikeDownloadAnchor(this)) {
      reportDownloadUnsupported(this.getAttribute('download') || this.download || '');
      return;
    }
    return originalAnchorClick.apply(this, arguments);
  };
${heightBootstrap}
${streamUpdateBootstrap}
  if (document.readyState === 'complete') {
    startHeightObserver();
  } else {
    window.addEventListener('load', startHeightObserver, { once: true });
  }
})();
</script>`;
}

export type BuildHtmlArtifactSrcdocInput = {
  source: string;
  channelId: string;
  theme?: ArtifactThemeVariables;
  iframePolicy?: ArtifactIframePolicy;
  /** Inline flows with the transcript; Canvas owns an internal scrollport. */
  surface?: ArtifactSurface;
  /** Preserve full HTML documents instead of nesting them inside a fragment root. */
  documentKind?: ArtifactDocumentKind;
  /** When false, omit the parent bridge entirely. Default true. */
  includeBridge?: boolean;
  /** Accept sanitized parent snapshots without replacing the iframe document. */
  enableStreamUpdates?: boolean;
};

function injectArtifactHostIntoDocument(input: {
  source: string;
  headPrefix: string;
  headSuffix: string;
}): string {
  const headOpenPattern = /<head\b[^>]*>/i;
  const headClosePattern = /<\/head\s*>/i;
  if (headOpenPattern.test(input.source)) {
    const withPrefix = input.source.replace(
      headOpenPattern,
      (headOpen) => `${headOpen}\n${input.headPrefix}`,
    );
    return headClosePattern.test(withPrefix)
      ? withPrefix.replace(headClosePattern, `${input.headSuffix}\n</head>`)
      : `${withPrefix}\n${input.headSuffix}`;
  }

  const hostHead = `<head>\n${input.headPrefix}\n${input.headSuffix}\n</head>`;
  const htmlOpenPattern = /<html\b[^>]*>/i;
  if (htmlOpenPattern.test(input.source)) {
    return input.source.replace(htmlOpenPattern, (htmlOpen) => `${htmlOpen}\n${hostHead}`);
  }

  const doctypePattern = /<!doctype\s+[^>]*>/i;
  const sourceDoctype = input.source.match(doctypePattern)?.[0] ?? '<!DOCTYPE html>';
  const documentBody = input.source.replace(doctypePattern, '').trim();
  if (/<body\b[^>]*>/i.test(documentBody)) {
    return `${sourceDoctype}\n<html lang="en">\n${hostHead}\n${documentBody}\n</html>`;
  }
  return `${sourceDoctype}\n<html lang="en">\n${hostHead}\n<body>\n${documentBody}\n</body>\n</html>`;
}

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
  const includeBridge = input.includeBridge !== false;
  const csp = buildStrictArtifactCsp(iframePolicy);
  const css = buildResponsiveCss(theme, surface);
  const themeGuardCss = buildArtifactThemeGuardCss();
  const surfacePolicyCss = buildArtifactSurfacePolicyCss(surface);
  const motionPolicyCss = buildArtifactMotionPolicyCss();
  const channelId = input.channelId;
  const channelAttr = escapeHtmlAttribute(channelId);
  const bridge = includeBridge
    ? buildArtifactBridgeBootstrapScript(
        channelId,
        input.enableStreamUpdates === true,
        surface === 'inline',
      )
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
  <style data-piwin-artifact-surface-policy>${surfacePolicyCss}</style>
  <style data-piwin-artifact-motion-policy>${motionPolicyCss}</style>`;

  const srcdoc =
    input.documentKind === 'document'
      ? injectArtifactHostIntoDocument({
          source: input.source,
          headPrefix: hostHeadPrefix,
          headSuffix: hostHeadSuffix,
        })
      : `<!DOCTYPE html>
<html lang="en">
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
