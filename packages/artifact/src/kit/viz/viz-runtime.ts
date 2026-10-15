/**
 * Artifact viz kit runtime (ADR 0093): shared helpers, the step player and
 * the boot code. Renderers (`viz-structures.ts`, `viz-grids.ts`,
 * `viz-network.ts`) are concatenated between `ARTIFACT_VIZ_HELPERS` and
 * `ARTIFACT_VIZ_BOOT` inside one IIFE, each adding `VIZ.<kind>`.
 *
 * Same rules as kit v1: plain ES5-ish JavaScript kept as a string, no
 * template literals or `${` inside. Every model-provided string goes through
 * `vEsc`, numbers through `vNum`, tones through the `TONE` allowlist; colors
 * only ever come from `--piwin-artifact-*` (in the stylesheet). No eval,
 * fetch or `parent`.
 */
export const ARTIFACT_VIZ_HELPERS = String.raw`
var VIZ_VERSION = '1.0.0';
var VIZ = {};
var TONE = { warn: 1, accent: 1, ok: 1, risk: 1, info: 1, muted: 1 };
function own(map, key) { return !!map && Object.prototype.hasOwnProperty.call(map, key); }
function vObj(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function vArr(value, max) { return Array.isArray(value) ? value.slice(0, max || 200) : []; }
function vNum(value, fallback) { var n = Number(value); return isFinite(n) ? n : (fallback || 0); }
function vGet(map, key) { map = vObj(map); return own(map, key) ? map[key] : undefined; }
function vEsc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
    return c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;';
  });
}
// Tone attribute for a state name; anything outside the allowlist draws neutral.
function vt(tone) { return typeof tone === 'string' && TONE[tone] ? ' data-t="' + tone + '"' : ''; }
function vq(value) { return Math.round(value * 10) / 10; }
// Width, not max-width: the inline-flow host forces max-width:100% !important on svg.
function vSvg(width, height, body, label) {
  return '<svg class="pv-svg" viewBox="0 0 ' + vq(width) + ' ' + vq(height) + '" style="width:min(100%,' + vq(width) + 'px)" role="img" aria-label="' +
    vEsc(label) + '">' + body + '</svg>';
}
// Filled arrowhead with its tip at (x, y), pointing along angle (radians).
function vHead(x, y, angle, tone) {
  var len = 8, half = 4, cx = Math.cos(angle), sy = Math.sin(angle);
  var bx = x - len * cx, by = y - len * sy;
  return '<path class="pv-head"' + vt(tone) + ' d="M' + vq(x) + ' ' + vq(y) + 'L' + vq(bx - half * sy) + ' ' + vq(by + half * cx) +
    'L' + vq(bx + half * sy) + ' ' + vq(by - half * cx) + 'Z"/>';
}
// Straight arrow from (x1, y1) to (x2, y2), stopping gap short of the target.
function vArrow(x1, y1, x2, y2, tone, gap) {
  var angle = Math.atan2(y2 - y1, x2 - x1), ex = x2 - (gap || 0) * Math.cos(angle), ey = y2 - (gap || 0) * Math.sin(angle);
  return '<line class="pv-edge"' + vt(tone) + ' x1="' + vq(x1) + '" y1="' + vq(y1) + '" x2="' + vq(ex - 6 * Math.cos(angle)) + '" y2="' +
    vq(ey - 6 * Math.sin(angle)) + '"/>' + vHead(ex, ey, angle, tone);
}
function vText(x, y, cls, value) {
  return '<text class="' + cls + '" x="' + vq(x) + '" y="' + vq(y) + '">' + vEsc(value) + '</text>';
}
// Optional table under any figure: {head:[..], rows:[[label, ..cells]], marks:{"r.c": tone}}.
function vTable(spec) {
  if (!spec || typeof spec !== 'object') return '';
  var head = vArr(spec.head, 40), rows = vArr(spec.rows, 40), marks = vObj(spec.marks), html = '<table class="pv-table">';
  if (head.length) html += '<tr>' + head.map(function (cell) { return '<th>' + vEsc(cell) + '</th>'; }).join('') + '</tr>';
  rows.forEach(function (row, r) {
    html += '<tr>' + vArr(row, 40).map(function (cell, c) {
      return c === 0 ? '<th class="pv-rh">' + vEsc(cell) + '</th>' : '<td' + vt(marks[r + '.' + c]) + '>' + vEsc(cell) + '</td>';
    }).join('') + '</tr>';
  });
  return html + '</table>';
}
`;

export const ARTIFACT_VIZ_BOOT = String.raw`
var PLAYER_ICONS = {
  prev: '<path d="M14.5 6.5 9 12l5.5 5.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  next: '<path d="M9.5 6.5 15 12l-5.5 5.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  play: '<path d="M8.5 6.2v11.6a.6.6 0 0 0 .9.5l9-5.8a.6.6 0 0 0 0-1l-9-5.8a.6.6 0 0 0-.9.5Z" fill="currentColor"/>',
  pause: '<path d="M9 6.5v11M15 6.5v11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>'
};
var PLAYER_LABELS = { prev: '上一步', next: '下一步', play: '播放', pause: '暂停' };
function playerIcon(name) { return '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">' + PLAYER_ICONS[name] + '</svg>'; }
function playerButton(action, icon) {
  return '<button type="button" class="pv-btn" data-pv="' + action + '" aria-label="' + PLAYER_LABELS[icon] + '">' + playerIcon(icon) + '</button>';
}

function mergeStep(base, step) {
  var out = {}, key;
  for (key in base) if (own(base, key) && key !== 'steps') out[key] = base[key];
  for (key in step) if (own(step, key)) out[key] = step[key];
  return out;
}

function readVizSpec(figure) {
  var script = figure.querySelector('script[type="application/json"]');
  if (!script) return null;
  try { return JSON.parse(script.textContent || 'null'); } catch (error) { return null; }
}

function stageOf(figure) {
  var stage = document.createElement('div');
  stage.className = 'pv-stage';
  var caption = figure.querySelector('figcaption');
  if (caption && caption.parentNode === figure) figure.insertBefore(stage, caption); else figure.appendChild(stage);
  return stage;
}

// Rests on the last frame (the finished picture); play replays from the first.
function mountPlayer(figure, stage, frames, paint, speed) {
  var bar = document.createElement('div');
  bar.className = 'pv-bar';
  bar.innerHTML = playerButton('prev', 'prev') + playerButton('play', 'play') + playerButton('next', 'next') +
    '<span class="pv-note"></span><span class="pv-count"></span>';
  stage.parentNode.insertBefore(bar, stage.nextSibling);
  var note = bar.querySelector('.pv-note'), count = bar.querySelector('.pv-count'), play = bar.querySelector('[data-pv="play"]');
  var index = frames.length - 1, timer = null;
  function show(next) {
    index = Math.max(0, Math.min(frames.length - 1, next));
    paint(index);
    note.textContent = frames[index].note == null ? '' : String(frames[index].note);
    count.textContent = (index + 1) + '/' + frames.length;
  }
  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    play.innerHTML = playerIcon('play');
    play.setAttribute('aria-label', PLAYER_LABELS.play);
  }
  bar.addEventListener('click', function (event) {
    var button = event.target && event.target.closest ? event.target.closest('button[data-pv]') : null;
    if (!button) return;
    var action = button.getAttribute('data-pv');
    if (action === 'prev') { stop(); show(index - 1); return; }
    if (action === 'next') { stop(); show(index + 1); return; }
    if (timer) { stop(); return; }
    if (index === frames.length - 1) show(0);
    play.innerHTML = playerIcon('pause');
    play.setAttribute('aria-label', PLAYER_LABELS.pause);
    timer = setInterval(function () { if (index >= frames.length - 1) stop(); else show(index + 1); }, speed);
  });
  show(index);
}

function mountViz(figure, spec) {
  var kind = figure.getAttribute('data-piwin-viz');
  if (!own(VIZ, kind)) return;
  spec = vObj(spec);
  var steps = vArr(spec.steps, 120);
  var frames = steps.length ? steps.map(function (step) { return mergeStep(spec, vObj(step)); }) : [spec];
  var ctx = { frames: frames }, draw = VIZ[kind], stage = stageOf(figure);
  figure.setAttribute('data-piwin-viz-ready', '');
  function paint(i) { stage.innerHTML = draw(frames[i], ctx) + vTable(frames[i].table); }
  if (frames.length > 1) {
    // Hold the tallest frame's height so the figure never jumps while playing.
    var tallest = 0;
    for (var i = 0; i < frames.length; i++) { paint(i); tallest = Math.max(tallest, stage.offsetHeight); }
    if (tallest) stage.style.minHeight = tallest + 'px';
    mountPlayer(figure, stage, frames, paint, Math.max(300, Math.min(3000, vNum(spec.speed, 1000))));
  } else {
    paint(0);
  }
}

function hydrateViz(root) {
  var figures = (root || document).querySelectorAll('figure[data-piwin-viz]:not([data-piwin-viz-ready])');
  for (var i = 0; i < figures.length; i++) {
    var spec = readVizSpec(figures[i]);
    if (spec) mountViz(figures[i], spec);
  }
}

var vizScheduled = false;
function scheduleViz() {
  if (vizScheduled) return;
  vizScheduled = true;
  (window.requestAnimationFrame || setTimeout)(function () { vizScheduled = false; hydrateViz(document); });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { hydrateViz(document); });
else hydrateViz(document);
// Streaming previews replace the body as tokens arrive; hydrate what lands.
if (typeof MutationObserver === 'function') {
  new MutationObserver(scheduleViz).observe(document.documentElement, { childList: true, subtree: true });
}
`;
