/* piwin artifact kit 1.0.0 */
(function (ICONS) {
'use strict';
if (window.piwin && window.piwin.version) return;

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

})({"activity":{"viewBox":"0 0 24 24","body":"<path d=\"M3.75 12h3.35l2.4-5.7 4.05 11.4 2.35-5.7h4.35\"></path>"},"alert":{"viewBox":"0 0 24 24","body":"<path d=\"M10.2 4.9a2.05 2.05 0 0 1 3.6 0l6.5 11.25a2.05 2.05 0 0 1-1.8 3.1H5.5a2.05 2.05 0 0 1-1.8-3.1Z\"></path><path d=\"M12 9.4v4.1\"></path><path d=\"M12 16.4h.01\"></path>"},"arrow-down":{"viewBox":"0 0 24 24","body":"<path d=\"M12 4.75v14.5M5.85 13.1 12 19.25l6.15-6.15\"></path>"},"arrow-left":{"viewBox":"0 0 24 24","body":"<path d=\"M19.25 12H4.75M10.9 5.85 4.75 12l6.15 6.15\"></path>"},"arrow-right":{"viewBox":"0 0 24 24","body":"<path d=\"M4.75 12h14.5M13.1 5.85 19.25 12l-6.15 6.15\"></path>"},"arrow-up":{"viewBox":"0 0 24 24","body":"<path d=\"M12 19.25V4.75M5.85 10.9 12 4.75l6.15 6.15\"></path>"},"book":{"viewBox":"0 0 24 24","body":"<path d=\"M12 6.4C10.55 5.1 8.6 4.55 5.5 4.55c-.4 0-.75.33-.75.74v11.9c0 .41.34.74.75.74 3.1 0 5.05.56 6.5 1.85 1.45-1.3 3.4-1.85 6.5-1.85.4 0 .75-.33.75-.74V5.3c0-.41-.34-.74-.75-.74-3.1 0-5.05.56-6.5 1.85Z\"></path><path d=\"M12 6.4v12.6\"></path>"},"bookmark":{"viewBox":"0 0 16 16","body":"<path d=\"M4.5 2.5h7v9l-3.5-2.6-3.5 2.6z\"></path>"},"brain":{"viewBox":"0 0 16 16","body":"<path d=\"M7.5 3.2A2.2 2.2 0 0 0 4 4.5a2 2 0 0 0-1 3.4A2.2 2.2 0 0 0 4.2 11.8 2.1 2.1 0 0 0 7.5 12.8zM8.5 3.2A2.2 2.2 0 0 1 12 4.5a2 2 0 0 1 1 3.4 2.2 2.2 0 0 1-1.2 3.9 2.1 2.1 0 0 1-3.3 1zM8 3v10\"></path>"},"bug":{"viewBox":"0 0 24 24","body":"<rect x=\"7.5\" y=\"8\" width=\"9\" height=\"11\" rx=\"4.5\"></rect><path d=\"M12 8v11\"></path><path d=\"M9.5 5.5 10.8 8M14.5 5.5 13.2 8\"></path><path d=\"M7.5 12H4.5M19.5 12h-3M7.8 16.3l-2.6 1.6M16.2 16.3l2.6 1.6M7.8 9.7 5.2 8.1M16.2 9.7l2.6-1.6\"></path>"},"calendar":{"viewBox":"0 0 24 24","body":"<rect x=\"4.5\" y=\"5.5\" width=\"15\" height=\"14\" rx=\"2\"></rect><path d=\"M4.5 10h15M8.5 3.5v4M15.5 3.5v4\"></path>"},"chart":{"viewBox":"0 0 24 24","body":"<rect x=\"5.15\" y=\"13.4\" width=\"3.2\" height=\"5.85\" rx=\"1.1\"></rect><rect x=\"10.4\" y=\"7.6\" width=\"3.2\" height=\"11.65\" rx=\"1.1\"></rect><rect x=\"15.65\" y=\"10.5\" width=\"3.2\" height=\"8.75\" rx=\"1.1\"></rect>"},"check":{"viewBox":"0 0 24 24","body":"<path d=\"M4.9 12.9l4.95 4.7L19.1 7.3\"></path>"},"check-circle":{"viewBox":"0 0 24 24","body":"<circle cx=\"12\" cy=\"12\" r=\"8.25\"></circle><path d=\"M8.4 12.35l2.55 2.55 4.65-4.9\"></path>"},"clock":{"viewBox":"0 0 24 24","body":"<circle cx=\"12\" cy=\"12\" r=\"8.25\"></circle><path d=\"M12 7.25v5.1l3.4 2.05\"></path>"},"cloud":{"viewBox":"0 0 24 24","body":"<path d=\"M7.1 17.9h9.6a3.9 3.9 0 0 0 .5-7.77 5.3 5.3 0 0 0-10.3-1.45A3.85 3.85 0 0 0 7.1 17.9Z\"></path>"},"code":{"viewBox":"0 0 24 24","body":"<path d=\"M15.75 7.5 20.25 12l-4.5 4.5\"></path><path d=\"M8.25 7.5 3.75 12l4.5 4.5\"></path>"},"coffee":{"viewBox":"0 0 24 24","body":"<path d=\"M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5Z\"></path><path d=\"M16 10.5h1.5a2.5 2.5 0 0 1 0 5H16\"></path><path d=\"M8.5 3.8v2.4M12 3.8v2.4\"></path>"},"database":{"viewBox":"0 0 24 24","body":"<ellipse cx=\"12\" cy=\"6.25\" rx=\"7.75\" ry=\"3\"></ellipse><path d=\"M4.25 6.25V12c0 1.65 3.47 3 7.75 3s7.75-1.35 7.75-3V6.25\"></path><path d=\"M4.25 12v5.75c0 1.65 3.47 3 7.75 3s7.75-1.35 7.75-3V12\"></path>"},"doc":{"viewBox":"0 0 24 24","body":"<path d=\"M13.6 3.75H8.15c-1.16 0-2.1.94-2.1 2.1v12.3c0 1.16.94 2.1 2.1 2.1h7.7c1.16 0 2.1-.94 2.1-2.1V8.1Z\"></path><path d=\"M13.6 3.75V8.1h4.35\"></path><path d=\"M9.4 12.75h5.2M9.4 16h3.4\"></path>"},"download":{"viewBox":"0 0 24 24","body":"<path d=\"M4.75 15.4v2.35c0 1.1.9 2 2 2h10.5c1.1 0 2-.9 2-2V15.4\"></path><path d=\"M12 4.25v10.1M7.9 10.5l4.1 4.1 4.1-4.1\"></path>"},"external":{"viewBox":"0 0 24 24","body":"<path d=\"M12 6H7a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-5\"></path><path d=\"M12.75 11.25 20 4\"></path><path d=\"M15 4h5v5\"></path>"},"eye":{"viewBox":"0 0 24 24","body":"<path d=\"M3.75 12c2.3-3.85 5.05-5.8 8.25-5.8s5.95 1.95 8.25 5.8c-2.3 3.85-5.05 5.8-8.25 5.8S6.05 15.85 3.75 12Z\"></path><circle cx=\"12\" cy=\"12\" r=\"2.4\"></circle>"},"file":{"viewBox":"0 0 16 16","body":"<path d=\"M4 2h5l3 3v9H4zM9 2v3h3\"></path>"},"flame":{"viewBox":"0 0 24 24","body":"<path d=\"M12 12c2-2.96 0-7-1-8 0 3.04-1.77 4.74-3 6-1.23 1.26-2 3.24-2 5a6 6 0 1 0 12 0c0-1.53-1.06-3.94-2-5-1.79 3-2.79 3-4 2Z\"></path>"},"folder":{"viewBox":"0 0 24 24","body":"<path d=\"M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z\"></path>"},"fork":{"viewBox":"0 0 16 16","body":"<path d=\"M8 2v5.5M8 7.5c0 2.5-4 3-4 6.5M8 7.5c0 2.5 4 3 4 6.5\"></path>"},"git":{"viewBox":"0 0 16 16","body":"<circle cx=\"4.5\" cy=\"3.5\" r=\"1.5\"></circle><circle cx=\"4.5\" cy=\"12.5\" r=\"1.5\"></circle><circle cx=\"11.5\" cy=\"5.5\" r=\"1.5\"></circle><path d=\"M4.5 5v6M11.5 7c0 2.5-3 3-7 3.5\"></path>"},"globe":{"viewBox":"0 0 16 16","body":"<circle cx=\"8\" cy=\"8\" r=\"6\"></circle><path d=\"M2 8h12M8 2c2.5 3 2.5 9 0 12M8 2c-2.5 3-2.5 9 0 12\"></path>"},"heart":{"viewBox":"0 0 24 24","body":"<path d=\"M12 19.25c-4.4-2.85-7.25-5.6-7.25-8.9A4.05 4.05 0 0 1 12 7.8a4.05 4.05 0 0 1 7.25 2.55c0 3.3-2.85 6.05-7.25 8.9Z\"></path>"},"image":{"viewBox":"0 0 16 16","body":"<rect x=\"2\" y=\"3\" width=\"12\" height=\"10\" rx=\"1.5\"></rect><circle cx=\"6\" cy=\"7\" r=\"1.2\"></circle><path d=\"M14 11l-3.5-3.5L5 13\"></path>"},"info":{"viewBox":"0 0 24 24","body":"<circle cx=\"12\" cy=\"12\" r=\"8.25\"></circle><path d=\"M12 11v5\"></path><path d=\"M12 7.9h.01\"></path>"},"leaf":{"viewBox":"0 0 24 24","body":"<path d=\"M5 19c0-7.5 5-12.5 14-14 0 9-5 14-12 14Z\"></path><path d=\"M5 19l7-7\"></path>"},"link":{"viewBox":"0 0 24 24","body":"<path d=\"M10.4 7.15l1.7-1.7a4.35 4.35 0 0 1 6.15 6.15l-1.7 1.7\"></path><path d=\"M13.6 16.85l-1.7 1.7a4.35 4.35 0 0 1-6.15-6.15l1.7-1.7\"></path><path d=\"M9.4 14.6l5.2-5.2\"></path>"},"lock":{"viewBox":"0 0 24 24","body":"<rect x=\"5.5\" y=\"10.5\" width=\"13\" height=\"9\" rx=\"2\"></rect><path d=\"M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5\"></path>"},"minus":{"viewBox":"0 0 24 24","body":"<path d=\"M6 12h12\"></path>"},"moon":{"viewBox":"0 0 24 24","body":"<path d=\"M11.7 3.75a6.75 6.75 0 0 0 8.55 8.55A8.4 8.4 0 1 1 11.7 3.75Z\"></path><path d=\"M17.25 4.75c.2 1.2.85 1.85 2.05 2.05-1.2.2-1.85.85-2.05 2.05-.2-1.2-.85-1.85-2.05-2.05 1.2-.2 1.85-.85 2.05-2.05Z\"></path>"},"pause":{"viewBox":"0 0 16 16","body":"<path d=\"M6 4v8M10 4v8\" stroke-width=\"2\"></path>"},"pin":{"viewBox":"0 0 16 16","body":"<path d=\"M8 14V9.5M4.5 9.5h7L10 5.5V3H6v2.5z\"></path>"},"play":{"viewBox":"0 0 24 24","body":"<path d=\"M7 5.5l12 6.5-12 6.5V5.5Z\" fill=\"currentColor\" stroke=\"none\"></path>"},"plus":{"viewBox":"0 0 16 16","body":"<path d=\"M8 3v10M3 8h10\"></path>"},"refresh":{"viewBox":"0 0 16 16","body":"<path d=\"M13 8A5 5 0 1 1 11.6 4.5M13.5 2.5v3h-3\"></path>"},"search":{"viewBox":"0 0 16 16","body":"<circle cx=\"7\" cy=\"7\" r=\"4.5\"></circle><path d=\"M10.5 10.5L14 14\"></path>"},"server":{"viewBox":"0 0 24 24","body":"<rect x=\"3.75\" y=\"4.25\" width=\"16.5\" height=\"6.5\" rx=\"1.9\"></rect><rect x=\"3.75\" y=\"13.25\" width=\"16.5\" height=\"6.5\" rx=\"1.9\"></rect><path d=\"M7.4 7.5h.01M7.4 16.5h.01\"></path>"},"settings":{"viewBox":"0 0 24 24","body":"<path d=\"M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z\"></path><circle cx=\"12\" cy=\"12\" r=\"3\"></circle>"},"shield":{"viewBox":"0 0 24 24","body":"<path d=\"M12 3.9c2.3 1.45 4.55 2.2 6.9 2.35v5.4c0 4.25-2.75 7.2-6.9 8.8-4.15-1.6-6.9-4.55-6.9-8.8v-5.4C7.45 6.1 9.7 5.35 12 3.9Z\"></path><path d=\"M9.4 11.9l1.85 1.85 3.35-3.45\"></path>"},"star":{"viewBox":"0 0 24 24","body":"<path d=\"M12 4.75l2.1 4.3 4.75.7-3.45 3.35.8 4.75L12 15.6l-4.2 2.25.8-4.75-3.45-3.35 4.75-.7Z\"></path>"},"sun":{"viewBox":"0 0 24 24","body":"<circle cx=\"12\" cy=\"12\" r=\"3.9\"></circle><path d=\"M12 3.5v2.1M12 18.4v2.1M3.5 12h2.1M18.4 12h2.1M5.99 5.99l1.49 1.49M16.52 16.52l1.49 1.49M18.01 5.99l-1.49 1.49M7.48 16.52l-1.49 1.49\"></path>"},"table":{"viewBox":"0 0 24 24","body":"<rect x=\"3.5\" y=\"4.5\" width=\"17\" height=\"15\" rx=\"2.5\"></rect><path d=\"M3.5 10h17M10 4.5v15\"></path>"},"target":{"viewBox":"0 0 24 24","body":"<circle cx=\"12\" cy=\"12\" r=\"8.25\"></circle><circle cx=\"12\" cy=\"12\" r=\"4.25\"></circle><circle cx=\"12\" cy=\"12\" r=\".6\"></circle>"},"terminal":{"viewBox":"0 0 16 16","body":"<path d=\"M3 4l4 4-4 4M8.5 12h4.5\"></path>"},"trend-down":{"viewBox":"0 0 24 24","body":"<path d=\"M4 7.5l5.2 5.2 3.4-3.4L20 16.7\"></path><path d=\"M14.6 16.7H20v-5.4\"></path>"},"trend-up":{"viewBox":"0 0 24 24","body":"<path d=\"M4 16.5l5.2-5.2 3.4 3.4L20 7.3\"></path><path d=\"M14.6 7.3H20v5.4\"></path>"},"user":{"viewBox":"0 0 24 24","body":"<circle cx=\"12\" cy=\"7.9\" r=\"3.4\"></circle><path d=\"M5.5 19.5c.4-3.4 3.1-5.4 6.5-5.4s6.1 2 6.5 5.4\"></path>"},"users":{"viewBox":"0 0 24 24","body":"<circle cx=\"9.25\" cy=\"8.4\" r=\"3.1\"></circle><path d=\"M3.75 19.25c.35-3.1 2.6-4.9 5.5-4.9s5.15 1.8 5.5 4.9\"></path><path d=\"M15.1 5.9a3.1 3.1 0 0 1 0 5M17.1 14.6c1.8.55 3 1.9 3.35 4.05\"></path>"},"warn":{"viewBox":"0 0 24 24","body":"<path d=\"M10.2 4.9a2.05 2.05 0 0 1 3.6 0l6.5 11.25a2.05 2.05 0 0 1-1.8 3.1H5.5a2.05 2.05 0 0 1-1.8-3.1Z\"></path><path d=\"M12 9.4v4.1\"></path><path d=\"M12 16.4h.01\"></path>"},"x":{"viewBox":"0 0 16 16","body":"<path d=\"M4 4l8 8M12 4l-8 8\"></path>"},"x-circle":{"viewBox":"0 0 24 24","body":"<circle cx=\"12\" cy=\"12\" r=\"8.25\"></circle><path d=\"M9.55 9.55l4.9 4.9M14.45 9.55l-4.9 4.9\"></path>"},"zap":{"viewBox":"0 0 24 24","body":"<path d=\"M10.25 8.2c.48 2.95 2 4.47 4.95 4.95-2.95.48-4.47 2-4.95 4.95-.48-2.95-2-4.47-4.95-4.95 2.95-.48 4.47-2 4.95-4.95Z\"></path><path d=\"M17.75 4.1c.24 1.48 1 2.24 2.48 2.48-1.48.24-2.24 1-2.48 2.48-.24-1.48-1-2.24-2.48-2.48 1.48-.24 2.24-1 2.48-2.48Z\"></path>"}});
