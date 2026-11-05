import {
  MAX_ARTIFACT_DOWNLOAD_BYTES,
  MAX_ARTIFACT_DOWNLOAD_DATA_URL_CHARS,
} from '@piwin/contracts';
import { ARTIFACT_ACTION_NAMES, ARTIFACT_BRIDGE_ACTION_TYPE } from './constants.js';

/** In-frame actions only serialize local bytes; the shell owns every save. */
export function buildArtifactActionsRuntime(): string {
  return `
  var actionType = ${JSON.stringify(ARTIFACT_BRIDGE_ACTION_TYPE)};
  var allowedActions = ${JSON.stringify([...ARTIFACT_ACTION_NAMES])};
  window.piwinArtifact = {
    postAction: function (action, payload) {
      if (allowedActions.indexOf(action) === -1) return false;
      post(actionType, { action: action, payload: payload || {} });
      return true;
    }
  };
  var maxDownloadBytes = ${MAX_ARTIFACT_DOWNLOAD_BYTES};
  var maxDownloadUrlChars = ${MAX_ARTIFACT_DOWNLOAD_DATA_URL_CHARS};
  // connect-src stays 'none'. Capture the actual Blob at creation instead of
  // fetching a blob URL, which also survives an immediate revoke after click.
  var downloadBlobs = new Map();
  if (window.URL && window.URL.createObjectURL && window.URL.revokeObjectURL) {
    var createObjectURL = window.URL.createObjectURL.bind(window.URL);
    var revokeObjectURL = window.URL.revokeObjectURL.bind(window.URL);
    window.URL.createObjectURL = function (blob) {
      var url = createObjectURL(blob);
      if (blob instanceof Blob) downloadBlobs.set(url, blob);
      return url;
    };
    window.URL.revokeObjectURL = function (url) {
      downloadBlobs.delete(String(url));
      return revokeObjectURL(url);
    };
  }
  var reportDownloadFailure = function (filename, reason) {
    post(actionType, {
      action: 'artifact/download-unsupported',
      payload: { filename: filename, reason: reason }
    });
  };
  var looksLikeDownloadAnchor = function (anchor) {
    if (!anchor || anchor.tagName !== 'A') return false;
    if (anchor.hasAttribute('download') || (anchor.download && anchor.download.length > 0)) {
      return true;
    }
    return /^(blob:|data:)/i.test(anchor.getAttribute('href') || '');
  };
  var externalLinkUrl = function (raw) {
    if (typeof raw !== 'string') return null;
    var text = raw.trim();
    if (!/^(https?:|mailto:)/i.test(text)) return null;
    return text.length > 2048 ? null : text;
  };
  var openExternalLink = function (url) {
    post(actionType, { action: 'artifact/open-link', payload: { url: url } });
  };
  var downloadAnchor = function (anchor) {
    var filename = (anchor.getAttribute('download') || anchor.download || '').slice(0, 256);
    var href = anchor.getAttribute('href') || '';
    var external = externalLinkUrl(href);
    if (external !== null) {
      openExternalLink(external);
      return;
    }
    var blob = downloadBlobs.get(href);
    try {
      if (!blob && /^data:/i.test(href)) {
        if (href.length > maxDownloadBytes * 3 + 256) {
          reportDownloadFailure(filename, 'too-large');
          return;
        }
        var comma = href.indexOf(',');
        if (comma < 0) throw new Error('Invalid download data URL');
        var header = href.slice(5, comma);
        var mime = header.split(';')[0] || 'text/plain';
        var contents = href.slice(comma + 1);
        if (/;base64$/i.test(header)) {
          if (contents.length > maxDownloadUrlChars) {
            reportDownloadFailure(filename, 'too-large');
            return;
          }
          var binary = atob(contents);
          var bytes = new Uint8Array(binary.length);
          for (var index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
          blob = new Blob([bytes], { type: mime });
        } else {
          blob = new Blob([decodeURIComponent(contents)], { type: mime });
        }
      }
      if (!blob) {
        reportDownloadFailure(filename, 'unsupported-url');
        return;
      }
      if (blob.size > maxDownloadBytes) {
        reportDownloadFailure(filename, 'too-large');
        return;
      }
      var reader = new FileReader();
      reader.onload = function () {
        if (typeof reader.result !== 'string') {
          reportDownloadFailure(filename, 'read-failed');
          return;
        }
        post(actionType, {
          action: 'artifact/download',
          payload: { filename: filename, dataUrl: reader.result }
        });
      };
      reader.onerror = function () { reportDownloadFailure(filename, 'read-failed'); };
      reader.readAsDataURL(blob.type ? blob : new Blob([blob], { type: 'application/octet-stream' }));
    } catch (error) {
      warnBridge('piwin artifact download read failed', error);
      reportDownloadFailure(filename, 'read-failed');
    }
  };
  // Links have no popup/top-navigation capability; the shell opens them.
  // In-page anchors keep their native behavior.
  var onLinkActivate = function (event) {
    if (event.type === 'auxclick' && event.button !== 1) return;
    var node = event.target;
    while (node && node !== document && node !== document.documentElement) {
      if (node.tagName === 'A') {
        if (looksLikeDownloadAnchor(node)) {
          event.preventDefault();
          downloadAnchor(node);
          return;
        }
        var url = externalLinkUrl(node.getAttribute('href'));
        if (url !== null) {
          event.preventDefault();
          openExternalLink(url);
        }
        return;
      }
      node = node.parentElement;
    }
  };
  document.addEventListener('click', onLinkActivate, true);
  document.addEventListener('auxclick', onLinkActivate, true);
  var originalWindowOpen = window.open;
  window.open = function (target) {
    var url = externalLinkUrl(target == null ? '' : String(target));
    if (url !== null) {
      openExternalLink(url);
      return null;
    }
    return originalWindowOpen ? originalWindowOpen.apply(window, arguments) : null;
  };
  var originalAnchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (looksLikeDownloadAnchor(this)) {
      downloadAnchor(this);
      return;
    }
    var scriptedUrl = externalLinkUrl(this.getAttribute('href'));
    if (scriptedUrl !== null) {
      openExternalLink(scriptedUrl);
      return;
    }
    return originalAnchorClick.apply(this, arguments);
  };`;
}
