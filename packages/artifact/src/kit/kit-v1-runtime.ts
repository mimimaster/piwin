/**
 * Artifact kit v1 runtime (design.md §8.1). Runs inside the sandbox iframe.
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
var VERSION = '1.0.0';
var NS = 'http://www.w3.org/2000/svg';
var COLOR = /^var\(--piwin-artifact-[a-z0-9-]+\)$/;
var KINDS = { bar: 1, line: 1, donut: 1, spark: 1 };
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

function normalize(spec, kindHint) {
  spec = spec && typeof spec === 'object' ? spec : {};
  var kind = KINDS[spec.kind] ? spec.kind : (KINDS[kindHint] ? kindHint : 'bar');
  var labels = Array.isArray(spec.labels) ? spec.labels.slice(0, 200).map(function (l) { return String(l); }) : [];
  var rawSeries = Array.isArray(spec.series) ? spec.series : (Array.isArray(spec.values) ? [{ values: spec.values }] : []);
  var series = rawSeries.slice(0, 8).map(function (s, i) {
    s = s && typeof s === 'object' ? s : {};
    var values = Array.isArray(s.values) ? s.values.slice(0, 500).map(num) : [];
    return { name: s.name == null ? '' : String(s.name), values: values, color: seriesColor(s.color, i, s.tone, s.name) };
  });
  var tones = Array.isArray(spec.tones) ? spec.tones.slice(0, 200) : [];
  // Donut slices are labels, not series: color each from tones[i] or its label.
  var sliceColors = labels.map(function (label, i) { return seriesColor(null, i, tones[i], label); });
  var count = labels.length;
  series.forEach(function (s) { if (s.values.length > count) count = s.values.length; });
  var height = num(spec.height) || (kind === 'spark' ? 28 : kind === 'donut' ? 160 : 150);
  height = Math.max(20, Math.min(480, height));
  var max = num(spec.max);
  if (!max) series.forEach(function (s) { s.values.forEach(function (v) { if (v > max) max = v; }); });
  return {
    kind: kind, labels: labels, series: series, sliceColors: sliceColors, count: count, height: height, max: max || 1,
    center: spec.center == null ? '' : String(spec.center).slice(0, 24),
    legend: spec.legend === false ? false : (series.length > 1 || kind === 'donut')
  };
}

function plotHost(figure) {
  var host = null;
  for (var i = 0; i < figure.children.length; i++) {
    if (figure.children[i].getAttribute && figure.children[i].getAttribute('data-piwin-chart-plot') !== null) host = figure.children[i];
  }
  if (!host) {
    host = document.createElement('div');
    host.setAttribute('data-piwin-chart-plot', '');
    host.className = 'piwin-chart-plot';
    var caption = figure.querySelector('figcaption');
    if (caption && caption.parentNode === figure) figure.insertBefore(host, caption); else figure.appendChild(host);
  }
  return host;
}

function drawBar(svg, c, width) {
  var pad = 18, top = 6, bottom = c.labels.length ? 18 : 4, h = c.height;
  var plotH = h - top - bottom;
  var groupW = (width - 4) / Math.max(1, c.count);
  var gap = Math.min(10, groupW * 0.25);
  var barW = Math.max(1, (groupW - gap) / Math.max(1, c.series.length));
  svgEl('line', { x1: 0, x2: width, y1: top + plotH + 0.5, y2: top + plotH + 0.5, 'class': 'piwin-chart-axis' }, svg);
  for (var i = 0; i < c.count; i++) {
    c.series.forEach(function (s, si) {
      var v = s.values[i] || 0;
      var bh = Math.max(0, (v / c.max) * plotH);
      var rect = svgEl('rect', {
        x: 2 + i * groupW + gap / 2 + si * barW, y: top + plotH - bh, width: Math.max(1, barW - 1), height: bh, rx: Math.min(3, barW / 3), fill: s.color
      }, svg);
      svgEl('title', {}, rect).textContent = (s.name ? s.name + ' · ' : '') + (c.labels[i] || '') + ': ' + fmt(v);
    });
    if (c.labels[i] !== undefined) {
      var t = svgEl('text', { x: 2 + i * groupW + groupW / 2, y: h - 4, 'text-anchor': 'middle' }, svg);
      t.textContent = c.labels[i];
    }
  }
  return pad;
}

function drawLine(svg, c, width, spark) {
  var top = spark ? 2 : 8, bottom = spark ? 2 : (c.labels.length ? 18 : 4), h = c.height;
  var plotH = h - top - bottom, n = Math.max(1, c.count - 1);
  var x = function (i) { return spark ? (i / n) * width : 6 + (i / n) * (width - 12); };
  var y = function (v) { return top + plotH - (v / c.max) * plotH; };
  if (!spark) svgEl('line', { x1: 0, x2: width, y1: top + plotH + 0.5, y2: top + plotH + 0.5, 'class': 'piwin-chart-axis' }, svg);
  c.series.forEach(function (s) {
    var points = s.values.map(function (v, i) { return x(i).toFixed(1) + ',' + y(v).toFixed(1); }).join(' ');
    svgEl('polyline', { points: points, fill: 'none', stroke: s.color, 'stroke-width': spark ? 1.5 : 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
    if (!spark && s.values.length <= 40) s.values.forEach(function (v, i) {
      var dot = svgEl('circle', { cx: x(i), cy: y(v), r: 2.5, fill: s.color }, svg);
      svgEl('title', {}, dot).textContent = (s.name ? s.name + ' · ' : '') + (c.labels[i] || '') + ': ' + fmt(v);
    });
  });
  if (!spark) c.labels.forEach(function (label, i) {
    if (c.labels.length > 12 && i % Math.ceil(c.labels.length / 12) !== 0) return;
    var t = svgEl('text', { x: x(i), y: h - 4, 'text-anchor': 'middle' }, svg);
    t.textContent = label;
  });
}

function drawDonut(svg, c, width) {
  var values = (c.series[0] || { values: [] }).values;
  var total = 0; values.forEach(function (v) { total += Math.max(0, v); });
  var size = Math.min(width, c.height), r = size / 2 - 6, cx = width / 2, cy = c.height / 2;
  var stroke = Math.max(8, r * 0.28), circumference = 2 * Math.PI * r, offset = 0;
  svgEl('circle', { cx: cx, cy: cy, r: r, fill: 'none', stroke: 'var(--piwin-artifact-surface-2)', 'stroke-width': stroke }, svg);
  values.forEach(function (v, i) {
    var part = total > 0 ? Math.max(0, v) / total : 0;
    var arc = svgEl('circle', {
      cx: cx, cy: cy, r: r, fill: 'none', stroke: (c.series.length > 1 && c.series[i]) ? c.series[i].color : (c.sliceColors[i] || seriesColor(null, i)),
      'stroke-width': stroke, 'stroke-dasharray': (part * circumference).toFixed(2) + ' ' + circumference.toFixed(2),
      'stroke-dashoffset': (-offset * circumference).toFixed(2), transform: 'rotate(-90 ' + cx + ' ' + cy + ')'
    }, svg);
    svgEl('title', {}, arc).textContent = (c.labels[i] || '') + ': ' + fmt(v);
    offset += part;
  });
  if (c.center) {
    var t = svgEl('text', { x: cx, y: cy, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'class': 'piwin-chart-center' }, svg);
    t.textContent = c.center;
  }
}

function drawLegend(host, c) {
  if (!c.legend) return;
  var legend = document.createElement('div');
  legend.className = 'piwin-chart-legend';
  var items = c.kind === 'donut' && c.series.length <= 1
    ? c.labels.map(function (label, i) { return { name: label, color: c.sliceColors[i] || seriesColor(null, i) }; })
    : c.series.map(function (s) { return { name: s.name, color: s.color }; });
  items.forEach(function (item) {
    if (!item.name) return;
    var span = document.createElement('span');
    var swatch = document.createElement('i');
    swatch.style.background = item.color;
    span.appendChild(swatch);
    span.appendChild(document.createTextNode(item.name));
    legend.appendChild(span);
  });
  host.appendChild(legend);
}

function render(figure, spec) {
  var c = normalize(spec, figure.getAttribute('data-piwin-chart'));
  figure.__piwinChart = spec;
  var host = plotHost(figure);
  var width = Math.max(40, Math.floor(host.clientWidth || figure.clientWidth || (c.kind === 'spark' ? 96 : 480)));
  while (host.firstChild) host.removeChild(host.firstChild);
  var svg = svgEl('svg', { viewBox: '0 0 ' + width + ' ' + c.height, width: width, height: c.height, role: 'img' }, host);
  var caption = figure.querySelector('figcaption');
  if (caption) svg.setAttribute('aria-label', caption.textContent || '');
  if (c.kind === 'bar') drawBar(svg, c, width);
  else if (c.kind === 'donut') drawDonut(svg, c, width);
  else drawLine(svg, c, width, c.kind === 'spark');
  drawLegend(host, c);
  figure.setAttribute('data-piwin-chart-ready', '');
  host.__piwinWidth = width;
  return figure;
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
