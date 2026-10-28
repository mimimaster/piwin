/*
 * Launch splash controller. Inlined at the end of <body>, so #root exists and
 * the app bundle (a deferred module) has not run yet. The splash leaves once the
 * app has put its own content into #root and the stamp has had time to land.
 * Plain ES5 on purpose: it runs before any bundle and on the oldest webview.
 */
(function () {
  var splash = document.getElementById('launch-splash');
  if (splash === null) {
    return;
  }
  var SHOWN_KEY = 'piwin.launch-splash.shown';
  var FULL_MIN_MS = 1600;
  var QUICK_MIN_MS = 320;
  var REDUCED_MIN_MS = 700;
  var WAIT_HINT_MS = 2000;
  var FAILSAFE_MS = 12000;
  var EXIT_MS = 600;

  var html = document.documentElement;
  var startedAt = Date.now();
  var leaving = false;
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
  var minimumMs = quick ? QUICK_MIN_MS : reduced ? REDUCED_MIN_MS : FULL_MIN_MS;

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
      // Private mode: the next launch just plays the full stamp again.
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

  function checkMounted() {
    if (scheduled || leaving || !appMounted()) {
      return;
    }
    scheduled = true;
    // A short extra beat lets the app's first frame paint under the splash.
    later(leave, Math.max(0, minimumMs - (Date.now() - startedAt)) + 40);
  }

  var observer = null;
  if (appRoot !== null && typeof window.MutationObserver === 'function') {
    observer = new window.MutationObserver(checkMounted);
    observer.observe(appRoot, { childList: true });
  }

  later(function () {
    if (!leaving && !scheduled) {
      splash.className += ' is-waiting';
    }
  }, WAIT_HINT_MS);
  // Never trap the user behind the splash if the app fails to boot.
  later(leave, FAILSAFE_MS);
  checkMounted();
})();
