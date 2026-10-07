/**
 * In-iframe scroll continuity runtime.
 *
 * A Canvas document is replaced more than once while it is written (stream
 * shell → seeded shell → final document), and every replacement is a fresh
 * browsing context that starts at the top. The runtime reports where the
 * reader is and lets the host put a successor document back there.
 *
 * The primary scrollport is found, not assumed: the stream shell scrolls in
 * `body`, while a finished document usually scrolls in a stage of its own.
 *
 * Embedded in the bridge bootstrap; relies on its `post` and `channelId`.
 */
import {
  ARTIFACT_BRIDGE_RETIRE_TYPE,
  ARTIFACT_BRIDGE_SCROLL_RESTORE_TYPE,
  ARTIFACT_BRIDGE_SCROLL_TYPE,
} from './constants.js';

/** Scroll ranges below this are layout slack, not a place a reader can be. */
export const SCROLL_CONTINUITY_MIN_RANGE_PX = 24;
/** Elements inspected when looking for the primary scrollport. */
export const SCROLL_CONTINUITY_MAX_CANDIDATES = 400;
/** Nesting depth below `body` searched for an author-owned scroll stage. */
export const SCROLL_CONTINUITY_MAX_DEPTH = 4;
/** Coalesces a scroll gesture into one report. */
export const SCROLL_CONTINUITY_REPORT_DELAY_MS = 80;
/** A restore waits for late layout (fonts, scripted content) this many times. */
export const SCROLL_CONTINUITY_RESTORE_ATTEMPTS = 6;
export const SCROLL_CONTINUITY_RESTORE_RETRY_MS = 60;

export function buildScrollContinuityRuntime(): string {
  return `
  var scrollType = ${JSON.stringify(ARTIFACT_BRIDGE_SCROLL_TYPE)};
  var scrollRestoreType = ${JSON.stringify(ARTIFACT_BRIDGE_SCROLL_RESTORE_TYPE)};
  var retireType = ${JSON.stringify(ARTIFACT_BRIDGE_RETIRE_TYPE)};
  var primaryScroller = null;
  var scrollReportTimer = null;
  var lastReportedScrollTop = -1;
  var scrollRangeOf = function (node) {
    if (!node) return 0;
    return Math.max(0, (node.scrollHeight || 0) - (node.clientHeight || 0));
  };
  var canScroll = function (node) {
    if (!node || scrollRangeOf(node) < ${SCROLL_CONTINUITY_MIN_RANGE_PX}) return false;
    if (node === document.scrollingElement || node === document.documentElement) return true;
    if (!window.getComputedStyle) return false;
    var overflowY = window.getComputedStyle(node).overflowY;
    return overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
  };
  var resolvePrimaryScroller = function () {
    if (
      primaryScroller &&
      primaryScroller.isConnected !== false &&
      canScroll(primaryScroller)
    ) {
      return primaryScroller;
    }
    var best = null;
    var bestRange = 0;
    var consider = function (node) {
      if (!canScroll(node)) return;
      var range = scrollRangeOf(node);
      if (range > bestRange) {
        best = node;
        bestRange = range;
      }
    };
    consider(document.scrollingElement);
    consider(document.body);
    var queue = [];
    var enqueue = function (parent, depth) {
      if (!parent || !parent.children) return;
      for (var index = 0; index < parent.children.length; index += 1) {
        queue.push({ node: parent.children[index], depth: depth });
      }
    };
    enqueue(document.body, 1);
    var inspected = 0;
    while (queue.length > 0 && inspected < ${SCROLL_CONTINUITY_MAX_CANDIDATES}) {
      var entry = queue.shift();
      inspected += 1;
      consider(entry.node);
      if (entry.depth < ${SCROLL_CONTINUITY_MAX_DEPTH}) enqueue(entry.node, entry.depth + 1);
    }
    primaryScroller = best;
    return best;
  };
  var reportScroll = function () {
    scrollReportTimer = null;
    var scroller = resolvePrimaryScroller();
    var top = scroller ? Math.max(0, Math.round(scroller.scrollTop || 0)) : 0;
    if (top === lastReportedScrollTop) return;
    lastReportedScrollTop = top;
    post(scrollType, { top: top, restored: false });
  };
  document.addEventListener(
    'scroll',
    function () {
      if (scrollReportTimer !== null) return;
      scrollReportTimer = setTimeout(reportScroll, ${SCROLL_CONTINUITY_REPORT_DELAY_MS});
    },
    true,
  );
  var restoreScroll = function (top, attempt) {
    primaryScroller = null;
    var scroller = resolvePrimaryScroller();
    var range = scrollRangeOf(scroller);
    if ((!scroller || range < top) && attempt < ${SCROLL_CONTINUITY_RESTORE_ATTEMPTS}) {
      setTimeout(function () {
        restoreScroll(top, attempt + 1);
      }, ${SCROLL_CONTINUITY_RESTORE_RETRY_MS});
      return;
    }
    var applied = 0;
    if (scroller) {
      var target = Math.min(top, range);
      // An author's smooth scrolling would animate the jump the handoff hides.
      try {
        scroller.scrollTo({ top: target, behavior: 'instant' });
      } catch (error) {
        scroller.scrollTop = target;
      }
      applied = Math.max(0, Math.round(scroller.scrollTop || 0));
    }
    lastReportedScrollTop = applied;
    post(scrollType, { top: applied, restored: true });
  };
  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || data.channelId !== channelId) return;
    if (data.type === retireType) {
      retired = true;
      return;
    }
    if (
      data.type !== scrollRestoreType ||
      typeof data.top !== 'number' ||
      !isFinite(data.top) ||
      data.top < 0
    ) return;
    restoreScroll(Math.round(data.top), 0);
  });
`;
}
