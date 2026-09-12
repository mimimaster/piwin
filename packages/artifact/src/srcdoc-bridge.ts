/**
 * In-iframe bootstrap: one revisioned render command, unique scroll owner,
 * and a single size stream for inline-flow.
 */
import {
  ARTIFACT_ACTION_NAMES,
  ARTIFACT_BRIDGE_ACTION_TYPE,
  ARTIFACT_BRIDGE_MEASURE_REQUEST_TYPE,
  ARTIFACT_BRIDGE_SIZE_TYPE,
  ARTIFACT_BRIDGE_STREAM_UPDATE_TYPE,
  DEFAULT_MAX_ARTIFACT_BYTES,
} from './constants.js';
import { buildCanvasStageFitRuntime } from './srcdoc-canvas-fit.js';
import type { ArtifactFrameMode } from './types.js';

export function buildArtifactBridgeBootstrapScript(
  channelId: string,
  enableRenderCommand = true,
  initialFrameMode: ArtifactFrameMode = 'inline-flow',
  freezeSource = false,
): string {
  const serializedChannelId = JSON.stringify(channelId);
  const serializedFrameMode = JSON.stringify(initialFrameMode);
  const sizeType = JSON.stringify(ARTIFACT_BRIDGE_SIZE_TYPE);
  const measureRequestType = JSON.stringify(ARTIFACT_BRIDGE_MEASURE_REQUEST_TYPE);
  const renderType = JSON.stringify(ARTIFACT_BRIDGE_STREAM_UPDATE_TYPE);
  const maxSourceBytes = JSON.stringify(DEFAULT_MAX_ARTIFACT_BYTES);

  return `
<script data-piwin-artifact-bridge-bootstrap>
(function () {
  var channelId = ${serializedChannelId};
  var currentFrameMode = ${serializedFrameMode};
  var postSeq = 0;
  var warnBridge = function (label, error) {
    if (window.console && window.console.warn) window.console.warn(label, error);
  };
  var post = function (type, payload) {
    var message = Object.assign(
      { type: type, channelId: channelId, seq: postSeq },
      payload || {},
    );
    postSeq += 1;
    var nativeHandler =
      window.webkit &&
      window.webkit.messageHandlers &&
      window.webkit.messageHandlers.piwinArtifact;
    if (nativeHandler) {
      try {
        nativeHandler.postMessage(JSON.stringify(message));
      } catch (error) {
        warnBridge('piwin artifact native post failed', error);
      }
    }
    try {
      parent.postMessage(message, '*');
    } catch (error) {
      warnBridge('piwin artifact parent post failed', error);
    }
  };
  var actionType = ${JSON.stringify(ARTIFACT_BRIDGE_ACTION_TYPE)};
  var allowedActions = ${JSON.stringify([...ARTIFACT_ACTION_NAMES])};
  window.piwinArtifact = {
    postAction: function (action, payload) {
      if (allowedActions.indexOf(action) === -1) return false;
      post(actionType, { action: action, payload: payload || {} });
      return true;
    }
  };
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

  var sizeType = ${sizeType};
  var measureRequestType = ${measureRequestType};
  var sizeEnabled = currentFrameMode !== 'canvas';
  var sizeRevision = 0;
  var lastReportedHeight = -1;
  var heightFrame = null;
  var heightObserver = null;
  var contentObserver = null;
  var readHeight = function (height) {
    return Math.max(0, Math.ceil(height || 0));
  };
  var measureNode = function () {
    var root = document.querySelector('.piwin-artifact-root');
    if (root && root.getBoundingClientRect) return root;
    var body = document.body;
    if (body && body.getBoundingClientRect) return body;
    return null;
  };
  var reportHeight = function () {
    heightFrame = null;
    if (!sizeEnabled || currentFrameMode === 'canvas') return;
    var node = measureNode();
    if (!node) return;
    // The root box excludes visible overflow from constrained descendants.
    // Measure the content root, never documentElement (viewport feedback).
    var height = Math.max(
      readHeight(node.getBoundingClientRect().height),
      readHeight(node.scrollHeight)
    );
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
    if (!sizeEnabled || heightFrame !== null) return;
    heightFrame = requestAnimationFrame(reportHeight);
  };
  var onMeasureRequest = function (event) {
    var data = event.data;
    if (
      !data ||
      data.type !== measureRequestType ||
      data.channelId !== channelId ||
      typeof data.fallbackViewport !== 'boolean' ||
      typeof data.force !== 'boolean'
    ) return;
    if (document.documentElement) {
      document.documentElement.setAttribute(
        'data-measurement-fallback',
        data.fallbackViewport ? 'true' : 'false'
      );
    }
    if (data.force) {
      lastReportedHeight = -1;
      scheduleHeight();
    }
  };
  window.addEventListener('message', onMeasureRequest);
  var stopHeightObserver = function () {
    if (heightObserver) {
      heightObserver.disconnect();
      heightObserver = null;
    }
    if (contentObserver) {
      contentObserver.disconnect();
      contentObserver = null;
    }
  };
  var startHeightObserver = function () {
    stopHeightObserver();
    if (currentFrameMode !== 'inline-flow') {
      lastReportedHeight = -1;
      scheduleHeight();
      return;
    }
    var node = measureNode();
    if (!node) {
      scheduleHeight();
      return;
    }
    if (window.ResizeObserver) {
      heightObserver = new window.ResizeObserver(scheduleHeight);
      heightObserver.observe(node);
    }
    // An overflowing child can change without resizing the root box.
    // Coalesce DOM changes into the same one-per-frame measurement stream.
    if (window.MutationObserver) {
      contentObserver = new window.MutationObserver(scheduleHeight);
      contentObserver.observe(node, { subtree: true, childList: true, attributes: true, characterData: true });
    }
    scheduleHeight();
  };

  document.addEventListener('load', function () {
    if (currentFrameMode === 'inline-flow') scheduleHeight();
  }, true);
  var acceptFrameMode = function (mode) {
    if (mode === currentFrameMode) return currentFrameMode;
    if (currentFrameMode === 'canvas' || mode === 'canvas') return currentFrameMode;
    if (
      currentFrameMode === 'inline-flow' &&
      (mode === 'inline-viewport' || mode === 'inline-overflow')
    ) {
      return mode;
    }
    return currentFrameMode;
  };
  ${buildCanvasStageFitRuntime()}
  var applyFrameMode = function (mode) {
    var next = acceptFrameMode(mode);
    currentFrameMode = next;
    sizeEnabled = next !== 'canvas';
    if (document.documentElement) {
      document.documentElement.setAttribute('data-frame-mode', next);
    }
    stopHeightObserver();
    lastReportedHeight = -1;
    if (next === 'inline-flow') {
      startHeightObserver();
      return;
    }
    if (next === 'canvas') {
      startCanvasStageFit();
      return;
    }
    scheduleHeight();
  };

  ${
    enableRenderCommand
      ? `var streamUpdateType = ${renderType};
  var maxSourceBytes = ${maxSourceBytes};
  var lastSnapshotRevision = -1;
  var sourceFrozen = ${freezeSource ? 'true' : 'false'};
  var scriptsActivated = sourceFrozen;
  var pendingSnapshot = null;
  var utf8Bytes = function (value) {
    if (window.TextEncoder) return new window.TextEncoder().encode(value).length;
    return value.length;
  };
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
  var resolveStreamRoot = function () {
    return document.querySelector('.piwin-artifact-root') || document.body || null;
  };
  var applySnapshot = function (data) {
    var root = resolveStreamRoot();
    if (!root) {
      pendingSnapshot = data;
      return false;
    }
    pendingSnapshot = null;
    var template = document.createElement('template');
    template.innerHTML = data.source;
    syncChildren(root, template.content);
    if (data.final === true) {
      sourceFrozen = true;
      if (!scriptsActivated) {
        activateFinalScripts(root);
        scriptsActivated = true;
      }
      setTimeout(function () {
        document.dispatchEvent(new Event('DOMContentLoaded'));
        window.dispatchEvent(new Event('load'));
        if (currentFrameMode === 'inline-flow') scheduleHeight();
        if (currentFrameMode === 'canvas') scheduleCanvasStageFit();
      }, 0);
      return true;
    }
    if (currentFrameMode === 'inline-flow') scheduleHeight();
    if (currentFrameMode === 'canvas') scheduleCanvasStageFit();
    return true;
  };
  var flushPendingSnapshot = function () {
    if (pendingSnapshot && !sourceFrozen) applySnapshot(pendingSnapshot);
  };
  var onRenderCommand = function (event) {
    var data = event.data;
    if (
      !data ||
      data.type !== streamUpdateType ||
      data.channelId !== channelId ||
      typeof data.revision !== 'number' ||
      data.revision <= lastSnapshotRevision ||
      typeof data.source !== 'string' ||
      utf8Bytes(data.source) > maxSourceBytes ||
      typeof data.final !== 'boolean'
    ) return;
    var nextMode = acceptFrameMode(data.frameMode);
    lastSnapshotRevision = data.revision;
    if (nextMode !== currentFrameMode) applyFrameMode(nextMode);
    if (sourceFrozen) return;
    applySnapshot(data);
  };
  window.addEventListener('message', onRenderCommand);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', flushPendingSnapshot, { once: true });
  } else {
    flushPendingSnapshot();
  }`
      : ''
  }

  applyFrameMode(currentFrameMode);
  if (document.readyState === 'complete') {
    if (currentFrameMode === 'inline-flow') startHeightObserver();
    else if (currentFrameMode === 'canvas') startCanvasStageFit();
    else scheduleHeight();
  } else {
    window.addEventListener('load', function () {
      if (currentFrameMode === 'inline-flow') startHeightObserver();
      else if (currentFrameMode === 'canvas') startCanvasStageFit();
      else scheduleHeight();
    }, { once: true });
  }
})();
</script>`;
}
