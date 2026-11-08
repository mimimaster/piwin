/*
 * Launch splash controller. Inlined at the end of <body>, so #root exists and
 * the app bundle (a deferred module) has not run yet.
 *
 * The brush is a paint animation (stroke-dashoffset on a masked path), so it
 * only advances while the main thread is idle. Starting it at page load made it
 * freeze mid-stroke: the entry chunk and React's first render are the only long
 * tasks on this page, and they land inside the stroke window (measured: a
 * 400ms block held the dash at 67.96px and then jumped to 1.62px). The splash
 * therefore waits — plain paper, like the native LaunchScreen — and plays the
 * stroke once the app has mounted.
 *
 * Plain ES5 on purpose: it runs before any bundle and on the oldest webview.
 */
(function () {
  var splash = document.getElementById('launch-splash');
  if (splash === null) {
    return;
  }
  var SHOWN_KEY = 'piwin.launch-splash.shown';
  // One paint beat after mount so the app's first frame is on screen underneath.
  var DRAW_LEAD_MS = 60;
  // Stroke 560ms, dot lands at 860ms; the CSS timeline is the source of truth.
  var DRAW_HOLD_MS = 920;
  var QUICK_HOLD_MS = 240;
  var REDUCED_HOLD_MS = 320;
  var WAIT_HINT_MS = 700;
  var FAILSAFE_MS = 12000;
  var EXIT_MS = 340;

  var html = document.documentElement;
  var leaving = false;
  var drawing = false;
  var scheduled = false;
  var timers = [];

  var quick = false;
  try {
    quick = window.sessionStorage.getItem(SHOWN_KEY) === '1';
  } catch (error) {
    quick = false;
  }
  var reduced =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (quick) {
    splash.className += ' is-quick';
  }
  var holdMs = quick ? QUICK_HOLD_MS : reduced ? REDUCED_HOLD_MS : DRAW_HOLD_MS;

  function later(callback, delay) {
    timers.push(window.setTimeout(callback, delay));
  }

  // Web entry: the desktop boot script picked a face. Classic entry: html[data-face].
  // Applied a frame late so the background eases over from the system colour.
  var face = html.getAttribute('data-boot-face') || html.getAttribute('data-face') || 'paper';
  later(function () {
    splash.setAttribute('data-face', face === 'ink' ? 'ink' : 'paper');
  }, 16);

  var appRoot = document.getElementById('root');

  function appMounted() {
    if (appRoot === null) {
      return true;
    }
    for (var node = appRoot.firstElementChild; node !== null; node = node.nextElementSibling) {
      // The desktop entry ships its own static placeholder inside #root.
      if (!/(^|\s)boot-splash(\s|$)/.test(node.getAttribute('class') || '')) {
        return true;
      }
    }
    return false;
  }

  function leave() {
    if (leaving) {
      return;
    }
    leaving = true;
    for (var index = 0; index < timers.length; index += 1) {
      window.clearTimeout(timers[index]);
    }
    if (observer !== null) {
      observer.disconnect();
    }
    try {
      window.sessionStorage.setItem(SHOWN_KEY, '1');
    } catch (error) {
      // Private mode: the next launch just plays the full stroke again.
    }
    splash.className += ' is-leaving';
    window.setTimeout(function () {
      if (splash.parentNode !== null) {
        splash.parentNode.removeChild(splash);
      }
      var style = document.getElementById('launch-splash-style');
      if (style !== null && style.parentNode !== null) {
        style.parentNode.removeChild(style);
      }
    }, EXIT_MS);
  }

  function startDraw() {
    if (drawing || leaving) {
      return;
    }
    drawing = true;
    splash.className = splash.className.replace(/\s*is-waiting\b/, '') + ' is-drawing';
    later(leave, holdMs);
  }

  function checkMounted() {
    if (scheduled || drawing || leaving || !appMounted()) {
      return;
    }
    scheduled = true;
    later(startDraw, DRAW_LEAD_MS);
  }

  var observer = null;
  if (appRoot !== null && typeof window.MutationObserver === 'function') {
    observer = new window.MutationObserver(checkMounted);
    observer.observe(appRoot, { childList: true });
  }

  // A slow bundle gets motion instead of a still page: three ink dots.
  later(function () {
    if (!drawing && !leaving) {
      splash.className += ' is-waiting';
    }
  }, WAIT_HINT_MS);
  // Never trap the user behind the splash if the app fails to boot.
  later(leave, FAILSAFE_MS);
  checkMounted();
})();
