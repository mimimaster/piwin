/**
 * Build sandboxed HTML srcdoc for artifact preview.
 * Security-first: strict CSP, no external network by default (except allowlisted frames).
 * Includes height postMessage bridge (ported from openwebui_m, renamed piwin).
 */
import {
  ARTIFACT_ACTION_NAMES,
  ARTIFACT_BRIDGE_ACTION_TYPE,
  ARTIFACT_BRIDGE_READY_TYPE,
  ARTIFACT_BRIDGE_RESIZE_TYPE,
  ARTIFACT_BRIDGE_STREAM_UPDATE_TYPE,
  ARTIFACT_HEIGHT_MEASURE_LADDER_MS,
} from './constants.js';
import { buildArtifactFrameSrcCsp, createDefaultArtifactIframePolicy } from './iframe-policy.js';
import { createDefaultArtifactTheme } from './theme.js';
import type { ArtifactIframePolicy, ArtifactSurface, ArtifactThemeVariables } from './types.js';

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
  const pageOverflow = surface === 'canvas' ? 'auto' : 'hidden';
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
 * Posts ready/resize with channelId; parent validates source + channel.
 */
export function buildArtifactBridgeBootstrapScript(
  channelId: string,
  enableStreamUpdates = false,
): string {
  const serializedChannelId = JSON.stringify(channelId);
  const readyType = JSON.stringify(ARTIFACT_BRIDGE_READY_TYPE);
  const resizeType = JSON.stringify(ARTIFACT_BRIDGE_RESIZE_TYPE);
  const ladder = JSON.stringify([...ARTIFACT_HEIGHT_MEASURE_LADDER_MS]);
  const streamUpdateBootstrap = enableStreamUpdates
    ? `
  // Streaming previews receive sanitized snapshots from the parent. Reconcile
  // nodes in place so text grows and complete UI blocks appear without
  // reloading the iframe or replacing the whole Artifact tree.
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
      if (currentChild) {
        syncNode(currentChild, nextChild);
      } else {
        currentParent.appendChild(nextChild.cloneNode(true));
      }
      currentChild = followingCurrentChild;
      nextChild = followingNextChild;
    }
    while (currentChild) {
      var removableChild = currentChild;
      currentChild = currentChild.nextSibling;
      removableChild.remove();
    }
  };
  var appliedFinalSource = null;
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
  var applyStreamSnapshot = function (source, final) {
    var root = document.querySelector('.piwin-artifact-root');
    if (!root) return;
    if (final && appliedFinalSource === source) {
      ready();
      return;
    }
    var template = document.createElement('template');
    template.innerHTML = source;
    syncChildren(root, template.content);
    if (final) {
      appliedFinalSource = source;
      activateFinalScripts(root);
      // Dynamically activated scripts must observe the same lifecycle events
      // they receive during a normal final srcdoc load.
      setTimeout(function () {
        document.dispatchEvent(new Event('DOMContentLoaded'));
        window.dispatchEvent(new Event('load'));
        ready();
        scheduleMeasureLadder('trim');
      }, 0);
      return;
    }
    scheduleMeasure();
  };
  window.addEventListener('message', function (event) {
    var data = event.data;
    // channelId + type bind the stream. Do NOT require event.source === parent:
    // packaged Tauri (custom protocol + sandbox without allow-same-origin) can
    // report a non-identical WindowProxy for the same parent, which would drop
    // every snapshot and leave a blank preview while dev (http://127.0.0.1) works.
    if (
      !data ||
      data.type !== streamUpdateType ||
      data.channelId !== channelId ||
      typeof data.source !== 'string'
    ) return;
    applyStreamSnapshot(data.source, data.final === true);
  });`
    : '';

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
  // Whitelisted action channel for interactive artifacts (e.g. flashcards).
  // Model HTML calls window.piwinArtifact.postAction(name, payload); the
  // parent validates name/payload again before acting.
  var actionType = ${JSON.stringify(ARTIFACT_BRIDGE_ACTION_TYPE)};
  var allowedActions = ${JSON.stringify([...ARTIFACT_ACTION_NAMES])};
  window.piwinArtifact = {
    postAction: function (action, payload) {
      if (allowedActions.indexOf(action) === -1) return false;
      parent.postMessage(
        { type: actionType, channelId: channelId, action: action, payload: payload || {} },
        '*'
      );
      return true;
    }
  };
${streamUpdateBootstrap}
  var readHeight = function (height) {
    return Math.max(0, Math.ceil(height || 0));
  };
  var isVisibleElement = function (element) {
    if (!element || !element.getBoundingClientRect) return false;
    var style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    return true;
  };
  var readElementBottom = function (element) {
    var rect = element.getBoundingClientRect();
    var elementTop = rect.top + window.scrollY;
    var elementBottom = Number.isFinite(rect.bottom)
      ? rect.bottom + window.scrollY
      : elementTop + (rect.height || 0);
    var style = window.getComputedStyle(element);
    // Keep visible overflow measurable, but let ancestor clipping prevent
    // scroll containers from inflating the iframe.
    if (style.overflowY === 'visible') {
      elementBottom = Math.max(elementBottom, elementTop + (element.scrollHeight || 0));
    }
    return Math.max(elementBottom, elementTop + (element.offsetHeight || 0));
  };
  var clipToAncestorBounds = function (element, bottom) {
    var ancestor = element.parentElement;
    while (ancestor) {
      var style = window.getComputedStyle(ancestor);
      // html/body are the document's own scroll containers. Their viewport
      // bottom must not clip the content-height measurement; the parent
      // iframe height policy provides the visible frame limit, while the
      // document root keeps the remaining content reachable by scrolling.
      var isDocumentScrollContainer =
        ancestor === document.body || ancestor === document.documentElement;
      if (!isDocumentScrollContainer && style.overflowY !== 'visible') {
        var rect = ancestor.getBoundingClientRect();
        if (Number.isFinite(rect.bottom)) {
          bottom = Math.min(bottom, rect.bottom + window.scrollY);
        }
      }
      ancestor = ancestor.parentElement;
    }
    return bottom;
  };
  var readVisibleElementBottom = function (element) {
    if (!element || !isVisibleElement(element)) return 0;
    return clipToAncestorBounds(element, readElementBottom(element));
  };
  var readRenderedBoxHeight = function (element) {
    if (!element || !isVisibleElement(element)) return 0;
    var rect = element.getBoundingClientRect();
    var elementTop = rect.top + window.scrollY;
    return Math.max(0, readVisibleElementBottom(element) - elementTop);
  };
  var readVisibleBoundsHeight = function (root) {
    if (!root || !root.querySelectorAll) return 0;
    var rootRect = root.getBoundingClientRect();
    var rootTop = rootRect.top + window.scrollY;
    var bottom = rootTop + readRenderedBoxHeight(root);
    root.querySelectorAll('*').forEach(function (element) {
      var elementBottom = readVisibleElementBottom(element);
      if (Number.isFinite(elementBottom)) bottom = Math.max(bottom, elementBottom);
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
  // Late-loading media (async image decode, dynamically added <img>/<svg>)
  // does not mutate the DOM, so the MutationObserver misses it. A spiked
  // final-trim measurement taken before the media arrives would otherwise
  // shrink the frame and stay locked there, cropping the lower part of the
  // rendered image. 'load' does not bubble — capture it at the document.
  document.addEventListener(
    'load',
    function (event) {
      var target = event.target;
      if (
        target &&
        typeof target.tagName === 'string' &&
        (target.tagName === 'IMG' || target.tagName === 'SVG' || target.tagName === 'VIDEO')
      ) {
        scheduleMeasureLadder('normal');
      }
    },
    true
  );
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
  /** Inline flows with the transcript; Canvas owns an internal scrollport. */
  surface?: ArtifactSurface;
  /** When false, omit height bridge (stream-preview can still include it). Default true. */
  includeBridge?: boolean;
  /** Accept sanitized parent snapshots without replacing srcdoc. Default false. */
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
  const includeBridge = input.includeBridge !== false;
  const csp = buildStrictArtifactCsp(iframePolicy);
  const css = buildResponsiveCss(theme, surface);
  const themeGuardCss = buildArtifactThemeGuardCss();
  const surfacePolicyCss = buildArtifactSurfacePolicyCss(surface);
  const motionPolicyCss = buildArtifactMotionPolicyCss();
  const channelId = input.channelId;
  const channelAttr = escapeHtmlAttribute(channelId);
  const bridge = includeBridge
    ? buildArtifactBridgeBootstrapScript(channelId, input.enableStreamUpdates === true)
    : '';

  const srcdoc = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="Content-Security-Policy" content="${escapeHtmlAttribute(csp)}" />
  <meta name="piwin-artifact-channel" content="${channelAttr}" />
  <style data-piwin-artifact-theme>${css}</style>
</head>
<body>
  <div class="piwin-artifact-root">${input.source}</div>
  <style data-piwin-artifact-theme-guard>${themeGuardCss}</style>
  <style data-piwin-artifact-surface-policy>${surfacePolicyCss}</style>
  <style data-piwin-artifact-motion-policy>${motionPolicyCss}</style>
${bridge}
</body>
</html>`;

  return { srcdoc, csp };
}
