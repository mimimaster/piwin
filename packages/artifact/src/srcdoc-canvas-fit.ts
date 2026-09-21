/**
 * In-iframe Canvas fit runtime. Keep the decision in lockstep with
 * `resolveCanvasStageFit` / `pickCanvasStageFit` via the shared constants.
 */
import {
  CANVAS_FIT_COVER_MIN_VISIBLE_RATIO,
  CANVAS_FIT_FILLS_RATIO,
  CANVAS_FIT_MAX_SCALE,
  CANVAS_FIT_MIN_CONTENT_PX,
  CANVAS_FIT_MIN_VIEWPORT_PX,
  CANVAS_FIT_OVERFLOW_SLACK_PX,
  CANVAS_FIT_POSTER_HEIGHT_RATIO,
  CANVAS_FIT_SCALE_EPSILON,
  CANVAS_FIT_UNUSED_RATIO,
} from './canvas-stage-fit.js';

export function buildCanvasStageFitRuntime(): string {
  return `
  var canvasFitFrame = null;
  var canvasFitTarget = null;
  var canvasFitListening = false;
  var readFitBox = function (value) {
    return typeof value === 'number' && isFinite(value) ? value : 0;
  };
  var resolveFitDecision = function (viewportWidth, viewportHeight, contentWidth, contentHeight) {
    if (
      viewportWidth < ${CANVAS_FIT_MIN_VIEWPORT_PX} ||
      viewportHeight < ${CANVAS_FIT_MIN_VIEWPORT_PX} ||
      contentWidth < ${CANVAS_FIT_MIN_CONTENT_PX} ||
      contentHeight < ${CANVAS_FIT_MIN_CONTENT_PX}
    ) {
      return { action: 'none', scale: 1 };
    }
    var widthRatio = contentWidth / viewportWidth;
    var heightRatio = contentHeight / viewportHeight;
    var fillsWidth = widthRatio >= ${CANVAS_FIT_FILLS_RATIO};
    var fillsHeight = heightRatio >= ${CANVAS_FIT_POSTER_HEIGHT_RATIO};
    var unusedWidth = widthRatio <= ${CANVAS_FIT_UNUSED_RATIO};
    var unusedHeight = heightRatio <= ${CANVAS_FIT_UNUSED_RATIO};
    if (fillsWidth && contentHeight > viewportHeight + ${CANVAS_FIT_OVERFLOW_SLACK_PX}) {
      return { action: 'none', scale: 1 };
    }
    if (fillsHeight && unusedWidth) {
      return { action: 'fill-viewport', scale: 1 };
    }
    if (unusedWidth && unusedHeight) {
      var scale = Math.min(viewportWidth / contentWidth, viewportHeight / contentHeight);
      if (scale > ${CANVAS_FIT_SCALE_EPSILON}) {
        return { action: 'contain-scale', scale: Math.min(scale, ${CANVAS_FIT_MAX_SCALE}) };
      }
    }
    return { action: 'none', scale: 1 };
  };
  // A cover-cropped viewBox hides part of the design box; the canvas shows the
  // whole box instead (mirrors resolveCanvasDesignBoxCorrection).
  var readViewBoxSize = function (svg) {
    var value = svg.getAttribute ? svg.getAttribute('viewBox') : null;
    if (!value) return null;
    var parts = value.replace(/,/g, ' ').trim().split(/\\s+/);
    if (parts.length !== 4) return null;
    var designWidth = parseFloat(parts[2]);
    var designHeight = parseFloat(parts[3]);
    if (!(designWidth > 0) || !(designHeight > 0)) return null;
    return { width: designWidth, height: designHeight };
  };
  var resolveDesignBoxMeet = function (boxWidth, boxHeight, designWidth, designHeight, preserve) {
    if (!preserve || !/slice/i.test(preserve)) return null;
    if (
      boxWidth < ${CANVAS_FIT_MIN_CONTENT_PX} ||
      boxHeight < ${CANVAS_FIT_MIN_CONTENT_PX}
    ) {
      return null;
    }
    var scale = Math.max(boxWidth / designWidth, boxHeight / designHeight);
    var visible =
      Math.min(1, boxWidth / (designWidth * scale)) * Math.min(1, boxHeight / (designHeight * scale));
    if (visible >= ${CANVAS_FIT_COVER_MIN_VISIBLE_RATIO}) return null;
    return preserve.replace(/slice/i, 'meet');
  };
  var canvasDesignTargets = [];
  var resetCanvasDesignBoxes = function () {
    for (var i = 0; i < canvasDesignTargets.length; i++) {
      var entry = canvasDesignTargets[i];
      if (!entry.node) continue;
      if (entry.original === null) entry.node.removeAttribute('preserveAspectRatio');
      else entry.node.setAttribute('preserveAspectRatio', entry.original);
      if (entry.node.removeAttribute) entry.node.removeAttribute('data-piwin-canvas-aspect');
    }
    canvasDesignTargets = [];
  };
  var applyCanvasDesignBoxes = function () {
    resetCanvasDesignBoxes();
    if (!document.body || !document.querySelectorAll) return;
    var viewportWidth = readFitBox(window.innerWidth);
    var viewportHeight = readFitBox(window.innerHeight);
    if (viewportWidth < ${CANVAS_FIT_MIN_VIEWPORT_PX} || viewportHeight < ${CANVAS_FIT_MIN_VIEWPORT_PX}) {
      return;
    }
    var svgs = document.querySelectorAll('svg');
    for (var index = 0; index < svgs.length; index += 1) {
      var svg = svgs[index];
      // Attribute reads only: an icon-heavy artifact must not pay layout reads.
      var preserve = svg.getAttribute ? svg.getAttribute('preserveAspectRatio') : null;
      if (!preserve || !/slice/i.test(preserve)) continue;
      var design = readViewBoxSize(svg);
      if (!design || !svg.getBoundingClientRect) continue;
      var rect = svg.getBoundingClientRect();
      var boxWidth = readFitBox(rect.width);
      var boxHeight = readFitBox(rect.height);
      if (
        boxWidth / viewportWidth < ${CANVAS_FIT_FILLS_RATIO} ||
        boxHeight / viewportHeight < ${CANVAS_FIT_FILLS_RATIO}
      ) {
        continue;
      }
      var meet = resolveDesignBoxMeet(boxWidth, boxHeight, design.width, design.height, preserve);
      if (meet === null) continue;
      canvasDesignTargets.push({ node: svg, original: preserve });
      svg.setAttribute('preserveAspectRatio', meet);
      if (svg.setAttribute) svg.setAttribute('data-piwin-canvas-aspect', 'letterbox');
    }
  };
  var isSkippableFitNode = function (node) {
    if (!node || node.nodeType !== 1) return true;
    var tag = node.tagName;
    return tag === 'SCRIPT' || tag === 'STYLE' || tag === 'META' || tag === 'LINK';
  };
  var firstFitChild = function (parent) {
    if (!parent) return null;
    var child = parent.firstElementChild;
    while (child && isSkippableFitNode(child)) child = child.nextElementSibling;
    return child;
  };
  // Overlay chrome (a play button pinned in a corner) is not a design box.
  var isOverlayFitNode = function (node) {
    if (!window.getComputedStyle) return false;
    var position = window.getComputedStyle(node).position;
    return position === 'absolute' || position === 'fixed' || position === 'sticky';
  };
  var collectFitCandidates = function (viewportWidth) {
    var candidates = [];
    var root = document.querySelector('.piwin-artifact-root') || document.body;
    if (!root) return candidates;
    var stage = firstFitChild(root);
    if (stage) candidates.push(stage);
    // A stage that already spans the column is the design box itself; its
    // children (svg, controls) must not be scaled on their own.
    var stageWidth = stage && stage.getBoundingClientRect ? readFitBox(stage.getBoundingClientRect().width) : 0;
    var stageFillsWidth = viewportWidth > 0 && stageWidth / viewportWidth >= ${CANVAS_FIT_FILLS_RATIO};
    if (stage && !stageFillsWidth && stage.children && stage.children.length > 0 && stage.children.length <= 8) {
      var child = stage.firstElementChild;
      while (child) {
        if (!isSkippableFitNode(child) && !isOverlayFitNode(child)) candidates.push(child);
        child = child.nextElementSibling;
      }
    }
    return candidates;
  };
  var resetCanvasFit = function (node) {
    if (!node || !node.style) return;
    node.style.removeProperty('width');
    node.style.removeProperty('height');
    node.style.removeProperty('max-width');
    node.style.removeProperty('max-height');
    node.style.removeProperty('min-width');
    node.style.removeProperty('min-height');
    node.style.removeProperty('aspect-ratio');
    node.style.removeProperty('margin-left');
    node.style.removeProperty('margin-right');
    node.style.removeProperty('zoom');
    node.style.removeProperty('transform');
    node.style.removeProperty('transform-origin');
    if (node.removeAttribute) node.removeAttribute('data-piwin-canvas-fit');
  };
  var applyFillViewport = function (node) {
    node.style.setProperty('width', '100%', 'important');
    node.style.setProperty('height', '100%', 'important');
    node.style.setProperty('max-width', 'none', 'important');
    node.style.setProperty('max-height', 'none', 'important');
    node.style.setProperty('min-width', '0', 'important');
    node.style.setProperty('min-height', '0', 'important');
    node.style.setProperty('aspect-ratio', 'auto', 'important');
    node.style.setProperty('margin-left', '0', 'important');
    node.style.setProperty('margin-right', '0', 'important');
    node.style.removeProperty('zoom');
    node.style.removeProperty('transform');
    if (node.setAttribute) node.setAttribute('data-piwin-canvas-fit', 'fill-viewport');
  };
  var applyContainScale = function (node, scale) {
    node.style.zoom = String(scale);
    node.style.marginLeft = 'auto';
    node.style.marginRight = 'auto';
    if (node.setAttribute) node.setAttribute('data-piwin-canvas-fit', 'contain-scale');
  };
  var applyCanvasStageFit = function () {
    canvasFitFrame = null;
    if (currentFrameMode !== 'canvas' || !document.body) {
      resetCanvasDesignBoxes();
      return;
    }
    applyCanvasDesignBoxes();
    var viewportWidth = readFitBox(window.innerWidth);
    var viewportHeight = readFitBox(window.innerHeight);
    if (canvasFitTarget) resetCanvasFit(canvasFitTarget);
    var candidates = collectFitCandidates(viewportWidth);
    var best = null;
    var bestDecision = { action: 'none', scale: 1 };
    var bestRank = 0;
    for (var i = 0; i < candidates.length; i++) {
      var node = candidates[i];
      if (!node.getBoundingClientRect) continue;
      var rect = node.getBoundingClientRect();
      var decision = resolveFitDecision(
        viewportWidth,
        viewportHeight,
        readFitBox(rect.width),
        readFitBox(rect.height),
      );
      if (decision.action === 'none') continue;
      var widthRatio = readFitBox(rect.width) / Math.max(1, viewportWidth);
      var rank = decision.action === 'fill-viewport' ? 100 + (1 - widthRatio) : decision.scale;
      if (best === null || rank > bestRank) {
        best = node;
        bestDecision = decision;
        bestRank = rank;
      }
    }
    canvasFitTarget = best;
    if (!best) return;
    if (bestDecision.action === 'fill-viewport') applyFillViewport(best);
    else applyContainScale(best, bestDecision.scale);
  };
  var scheduleCanvasStageFit = function () {
    if (currentFrameMode !== 'canvas' || canvasFitFrame !== null) return;
    canvasFitFrame = requestAnimationFrame(applyCanvasStageFit);
  };
  var startCanvasStageFit = function () {
    scheduleCanvasStageFit();
    if (canvasFitListening) return;
    canvasFitListening = true;
    window.addEventListener('resize', scheduleCanvasStageFit);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', scheduleCanvasStageFit);
    }
    if (window.ResizeObserver && document.documentElement) {
      var canvasFitObserver = new window.ResizeObserver(scheduleCanvasStageFit);
      canvasFitObserver.observe(document.documentElement);
    }
  };
`;
}
