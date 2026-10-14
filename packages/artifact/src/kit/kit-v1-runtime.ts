/**
 * Artifact kit v1 runtime (design.md §8.1). Runs inside the sandbox iframe.
 * Chart drawing lives in `kit-v1-charts.ts`, appended to this text.
 *
 * Plain ES5-ish JavaScript kept as a string so the same bytes are inlined into
 * a srcdoc (browser/e2e) or served from `piwin-artifact://localhost/lib/v1/`
 * (packaged desktop). It never touches `parent`, never fetches, never evals:
 * labels and names are written with textContent / setAttribute, colors are
 * accepted only as `var(--piwin-artifact-*)`, and icon markup is the trusted
 * constant set the caller passes in.
 *
 * No template literals or `${` inside, because this file wraps it in one.
 */
export const ARTIFACT_KIT_V1_RUNTIME = String.raw`
var VERSION = '1.1.0';
var NS = 'http://www.w3.org/2000/svg';
var COLOR = /^var\(--piwin-artifact-[a-z0-9-]+\)$/;
var KINDS = { bar: 1, hbar: 1, line: 1, donut: 1, stack: 1, spark: 1 };
var TONES = { ok: 1, warn: 1, risk: 1, info: 1, accent: 1, 'accent-2': 1, muted: 1 };
// Status names color themselves when the author gave no tone or color, so a
// "失败" series is never painted in a cheerful accent.
var TONE_WORDS = [
  ['ok', /^(?:ok|success(?:ful)?|succeeded|pass(?:ed|ing)?|done|healthy|成功|通过|完成|正常|健康)$/i],
  ['risk', /^(?:fail(?:ed|s|ure|ures)?|error(?:s)?|blocked|blocker(?:s)?|critical|失败|错误|阻塞|异常|严重)$/i],
  ['warn', /^(?:warn(?:ing|ings)?|flaky|suggest(?:ion|ions)?|skipped|警告|建议|不稳定|跳过)$/i],
  ['info', /^(?:info|note|notes|提示|信息)$/i]
];
function inferTone(name) {
  var text = String(name == null ? '' : name).trim();
  for (var i = 0; i < TONE_WORDS.length; i++) if (TONE_WORDS[i][1].test(text)) return TONE_WORDS[i][0];
  return null;
}
function toneColor(tone) {
  return typeof tone === 'string' && TONES[tone] ? 'var(--piwin-artifact-' + tone + ')' : null;
}

function svgEl(tag, attrs, into) {
  var node = document.createElementNS(NS, tag);
  for (var key in attrs) if (Object.prototype.hasOwnProperty.call(attrs, key)) node.setAttribute(key, String(attrs[key]));
  if (into) into.appendChild(node);
  return node;
}
function num(value) { var n = Number(value); return isFinite(n) ? n : 0; }
function seriesColor(color, index, tone, name) {
  if (typeof color === 'string' && COLOR.test(color.trim())) return color.trim();
  var toned = toneColor(tone) || toneColor(inferTone(name));
  if (toned) return toned;
  return 'var(--piwin-artifact-series-' + ((index % 6) + 1) + ')';
}
function fmt(value) {
  var abs = Math.abs(value);
  if (abs >= 1e6) return (value / 1e6).toFixed(abs >= 1e7 ? 0 : 1) + 'M';
  if (abs >= 1e4) return (value / 1e3).toFixed(abs >= 1e5 ? 0 : 1) + 'k';
  return String(Math.round(value * 100) / 100);
}

var resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(function (entries) {
  entries.forEach(function (entry) {
    var figure = entry.target;
    var host = plotHost(figure);
    var width = Math.floor(host.clientWidth || 0);
    if (width && Math.abs(width - (host.__piwinWidth || 0)) > 1 && figure.__piwinChart) render(figure, figure.__piwinChart);
  });
}) : null;

function readSpec(figure) {
  var script = figure.querySelector('script[type="application/json"]');
  if (!script) return null;
  try { return JSON.parse(script.textContent || 'null'); } catch (error) { return null; }
}

function icon(name, size) {
  var entry = Object.prototype.hasOwnProperty.call(ICONS, name) ? ICONS[name] : null;
  if (!entry) return '';
  var px = Math.max(8, Math.min(96, num(size) || 16));
  return '<svg xmlns="' + NS + '" viewBox="' + entry.viewBox + '" width="' + px + '" height="' + px +
    '" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + entry.body + '</svg>';
}

function hydrate(root) {
  root = root || document;
  var icons = root.querySelectorAll('[data-piwin-icon]:not([data-piwin-icon-ready])');
  for (var i = 0; i < icons.length; i++) {
    var markup = icon(icons[i].getAttribute('data-piwin-icon'), icons[i].getAttribute('data-size'));
    if (!markup) continue;
    icons[i].innerHTML = markup;
    icons[i].setAttribute('data-piwin-icon-ready', '');
    if (!icons[i].hasAttribute('aria-label')) icons[i].setAttribute('aria-hidden', 'true');
  }
  var charts = root.querySelectorAll('figure[data-piwin-chart]:not([data-piwin-chart-ready])');
  for (var j = 0; j < charts.length; j++) {
    var spec = readSpec(charts[j]);
    if (!spec) continue;
    render(charts[j], spec);
    if (resizeObserver) resizeObserver.observe(charts[j]);
  }
}

var api = {
  version: VERSION,
  chart: function (figure, spec) {
    if (!figure || figure.nodeType !== 1) return null;
    render(figure, spec);
    if (resizeObserver) resizeObserver.observe(figure);
    return figure;
  },
  icon: icon,
  hydrate: hydrate
};
try { Object.defineProperty(window, 'piwin', { value: Object.freeze(api), configurable: false, writable: false }); }
catch (error) { window.piwin = api; }

var scheduled = false;
function schedule() {
  if (scheduled) return;
  scheduled = true;
  (window.requestAnimationFrame || setTimeout)(function () { scheduled = false; hydrate(document); });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { hydrate(document); });
else hydrate(document);
// Streaming previews replace the body as tokens arrive; hydrate what lands.
if (typeof MutationObserver === 'function') {
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
}
`;
