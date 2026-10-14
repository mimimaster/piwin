/**
 * Artifact kit v1 chart drawing (design.md §8.1). Concatenated after
 * `kit-v1-runtime.ts` inside the same IIFE, so it may only hold function
 * declarations: the runtime hydrates before this text is reached, and only
 * hoisted functions exist at that point.
 *
 * Same rules as the runtime: plain ES5-ish JavaScript in a string, labels
 * written with textContent, colors resolved by the runtime's `seriesColor`.
 * No template literals or `${` inside.
 */
export const ARTIFACT_KIT_V1_CHARTS = String.raw`
function q(value) { return Math.round(value * 10) / 10; }
// Round an axis maximum up to 1 / 2 / 2.5 / 5 x 10^n so gridlines land on readable numbers.
function niceMax(value) {
  if (!(value > 0)) return 1;
  var pow = Math.pow(10, Math.floor(Math.log(value) / Math.LN10)), n = value / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
}
// SVG text cannot be measured before layout; CJK glyphs are about twice a Latin one.
function textWidth(text) {
  var width = 0;
  text = String(text);
  for (var i = 0; i < text.length; i++) width += text.charCodeAt(i) > 255 ? 11.5 : 6.9;
  return width;
}
function fitText(text, px) {
  text = String(text);
  if (textWidth(text) <= px) return text;
  var out = '';
  for (var i = 0; i < text.length && textWidth(out + text.charAt(i)) < px - 8; i++) out += text.charAt(i);
  return out + '…';
}
function textEl(svg, x, y, cls, anchor, value) {
  var node = svgEl('text', { x: q(x), y: q(y), 'class': cls, 'text-anchor': anchor }, svg);
  node.textContent = value;
  return node;
}
function tip(node, c, series, index, value) {
  svgEl('title', {}, node).textContent = (series && series.name ? series.name + ' · ' : '') +
    (c.labels[index] !== undefined ? c.labels[index] + ': ' : '') + fmt(value) + c.unit;
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
  // Donut / stack parts are labels, not series: color each from tones[i] or its label.
  var sliceColors = labels.map(function (label, i) { return seriesColor(null, i, tones[i], label); });
  var count = labels.length, dataMax = 0, dataMin = Infinity;
  series.forEach(function (s) {
    if (s.values.length > count) count = s.values.length;
    s.values.forEach(function (v) { if (v > dataMax) dataMax = v; if (v < dataMin) dataMin = v; });
  });
  var parts = kind === 'donut' || kind === 'stack';
  var height = num(spec.height) || (kind === 'spark' ? 28 : kind === 'donut' ? 168 : kind === 'stack' ? 14 : 180);
  height = Math.max(kind === 'stack' ? 8 : 20, Math.min(480, height));
  var top = num(spec.max) || (kind === 'spark' ? dataMax : niceMax(dataMax));
  var min = kind === 'spark' && isFinite(dataMin) ? dataMin : 0;
  if (spec.min != null && isFinite(Number(spec.min))) min = Number(spec.min);
  if (!(top > min)) top = min + 1;
  return {
    kind: kind, labels: labels, series: series, tones: tones, sliceColors: sliceColors, count: Math.min(count, 500),
    height: height, min: min, top: top, parts: parts,
    unit: spec.unit == null ? '' : String(spec.unit).slice(0, 6),
    values: spec.values === true ? true : spec.values === false ? false : null,
    area: spec.area === true,
    center: spec.center == null ? '' : String(spec.center).slice(0, 24),
    centerLabel: spec.centerLabel == null ? '' : String(spec.centerLabel).slice(0, 24),
    legend: spec.legend === false ? false : (parts || (series.length > 1 && kind !== 'hbar'))
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

// Plot area with a value axis: gridlines, tick labels in a left gutter sized to the widest tick.
function frame(svg, c, width, bottom) {
  // A 5 or 2.5 leading digit divides cleanly into five steps, the rest into four.
  var lead = c.top / Math.pow(10, Math.floor(Math.log(c.top) / Math.LN10));
  var ticks = c.min === 0 && (Math.abs(lead - 5) < 1e-9 || Math.abs(lead - 2.5) < 1e-9) ? 5 : 4;
  var top = 16, left = 0, labels = [], i;
  for (i = 0; i <= ticks; i++) labels.push(fmt(c.min + (c.top - c.min) * i / ticks) + c.unit);
  labels.forEach(function (label) { left = Math.max(left, textWidth(label) + 12); });
  var plotH = c.height - top - bottom, plotW = Math.max(10, width - left - 2);
  for (i = 0; i <= ticks; i++) {
    var gy = Math.round(top + plotH - plotH * i / ticks) + 0.5;
    svgEl('line', { x1: q(left), x2: width, y1: gy, y2: gy, 'class': i ? 'piwin-chart-grid' : 'piwin-chart-axis' }, svg);
    textEl(svg, left - 8, gy + 3.5, 'piwin-chart-tick', 'end', labels[i]);
  }
  return {
    left: left, top: top, w: plotW, h: plotH,
    y: function (v) { return top + plotH - (Math.max(c.min, Math.min(c.top, v)) - c.min) / (c.top - c.min) * plotH; }
  };
}
function categoryLabels(svg, c, x, slot) {
  var every = Math.max(1, Math.ceil(c.labels.length / Math.max(1, Math.floor(slot.total / 46))));
  c.labels.forEach(function (label, i) {
    if (i % every === 0) textEl(svg, x(i), c.height - 5, 'piwin-chart-label', 'middle', fitText(label, slot.each * every));
  });
}

function drawBar(svg, c, width) {
  var f = frame(svg, c, width, c.labels.length ? 22 : 6), n = Math.max(1, c.count), sn = Math.max(1, c.series.length);
  var groupW = f.w / n, inner = Math.min(groupW * 0.72, 56 * sn), barW = inner / sn, gap = barW > 6 ? Math.min(3, barW * 0.14) : 0;
  var showValues = c.values === true || (c.values === null && n * sn <= 12 && barW >= 22);
  var base = f.y(c.min);
  for (var i = 0; i < n; i++) {
    var gx = f.left + i * groupW + (groupW - inner) / 2;
    c.series.forEach(function (s, si) {
      var v = s.values[i] || 0, top = f.y(v), h = Math.max(0, base - top);
      var x = q(gx + si * barW + gap / 2), w = q(Math.max(1, barW - gap)), r = q(Math.min(4, w / 2, h));
      // Rounded on the value end only, so the bar sits flat on the axis.
      var bar = svgEl('path', {
        d: 'M' + x + ',' + q(base) + 'V' + q(top + r) + 'Q' + x + ',' + q(top) + ' ' + q(x + r) + ',' + q(top) + 'H' + q(x + w - r) +
          'Q' + q(x + w) + ',' + q(top) + ' ' + q(x + w) + ',' + q(top + r) + 'V' + q(base) + 'Z',
        fill: s.color, 'class': 'piwin-chart-bar'
      }, svg);
      tip(bar, c, s, i, v);
      if (showValues) textEl(svg, x + w / 2, top - 5, 'piwin-chart-value', 'middle', fmt(v));
    });
  }
  categoryLabels(svg, c, function (i) { return f.left + i * groupW + groupW / 2; }, { total: f.w, each: groupW });
}

function drawHbar(svg, c, width) {
  var s = c.series[0] || { values: [], name: '' }, rowH = 30, labelW = 0, valueW = 0, i;
  for (i = 0; i < c.count; i++) {
    labelW = Math.max(labelW, textWidth(c.labels[i] || '') * 1.1);
    valueW = Math.max(valueW, textWidth(fmt(s.values[i] || 0) + c.unit));
  }
  labelW = Math.min(labelW + 12, width * 0.4);
  valueW += 10;
  var trackW = Math.max(20, width - labelW - valueW);
  for (i = 0; i < c.count; i++) {
    var v = s.values[i] || 0, cy = i * rowH + rowH / 2;
    var w = Math.max(v > c.min ? 4 : 0, (Math.max(c.min, Math.min(c.top, v)) - c.min) / (c.top - c.min) * trackW);
    textEl(svg, 0, cy + 4, 'piwin-chart-label', 'start', fitText(c.labels[i] || '', (labelW - 4) / 1.1));
    svgEl('rect', { x: q(labelW), y: cy - 5, width: q(trackW), height: 10, rx: 5, 'class': 'piwin-chart-track' }, svg);
    // Rows share the series color unless a row states a status of its own.
    var bar = svgEl('rect', {
      x: q(labelW), y: cy - 5, width: q(w), height: 10, rx: 5, 'class': 'piwin-chart-bar',
      fill: toneColor(c.tones[i]) || toneColor(inferTone(c.labels[i])) || s.color
    }, svg);
    tip(bar, c, s, i, v);
    textEl(svg, width, cy + 4, 'piwin-chart-value', 'end', fmt(v) + c.unit);
  }
}

function drawLine(svg, c, width, spark) {
  var n = Math.max(1, c.count - 1), f = null, x, y, base;
  if (spark) {
    var plotH = c.height - 6;
    x = function (i) { return 3 + (i / n) * (width - 6); };
    y = function (v) { return 3 + plotH - (v - c.min) / (c.top - c.min) * plotH; };
    base = c.height;
  } else {
    f = frame(svg, c, width, c.labels.length ? 22 : 6);
    x = function (i) { return f.left + 10 + (i / n) * (f.w - 20); };
    y = f.y;
    base = f.y(c.min);
  }
  c.series.forEach(function (s) {
    if (!s.values.length) return;
    var last = s.values.length - 1;
    var points = s.values.map(function (v, i) { return q(x(i)) + ',' + q(y(v)); });
    if (c.area || c.series.length === 1) {
      svgEl('path', {
        d: 'M' + q(x(0)) + ',' + q(base) + 'L' + points.join('L') + 'L' + q(x(last)) + ',' + q(base) + 'Z',
        fill: s.color, 'fill-opacity': spark ? 0.16 : 0.1, 'class': 'piwin-chart-area'
      }, svg);
    }
    svgEl('polyline', { points: points.join(' '), fill: 'none', stroke: s.color, 'stroke-width': spark ? 1.5 : 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
    if (spark) { svgEl('circle', { cx: q(x(last)), cy: q(y(s.values[last])), r: 2, fill: s.color }, svg); return; }
    if (s.values.length <= 24) s.values.forEach(function (v, i) {
      var dot = svgEl('circle', { cx: q(x(i)), cy: q(y(v)), r: 3, fill: s.color, 'class': 'piwin-chart-dot' }, svg);
      tip(dot, c, s, i, v);
    });
    if (c.values === true || (c.values === null && c.series.length === 1)) {
      textEl(svg, x(last), y(s.values[last]) - 9, 'piwin-chart-value', 'end', fmt(s.values[last]) + c.unit);
    }
  });
  if (f) categoryLabels(svg, c, x, { total: f.w, each: f.w / Math.max(1, c.count) });
}

function partsOf(c) {
  var values = (c.series[0] || { values: [] }).values, total = 0;
  values.forEach(function (v) { total += Math.max(0, v); });
  return values.map(function (v, i) {
    return {
      value: v, share: total > 0 ? Math.max(0, v) / total : 0,
      color: (c.series.length > 1 && c.series[i]) ? c.series[i].color : (c.sliceColors[i] || seriesColor(null, i))
    };
  });
}

function drawDonut(svg, c, size) {
  var parts = partsOf(c), live = 0;
  var r = size / 2 - 9, cx = size / 2, cy = size / 2, stroke = Math.max(9, r * 0.3), length = 2 * Math.PI * r, offset = 0;
  parts.forEach(function (part) { if (part.share > 0) live++; });
  var gap = live > 1 ? 2.5 : 0;
  svgEl('circle', { cx: cx, cy: cy, r: q(r), fill: 'none', stroke: 'var(--piwin-artifact-surface-2)', 'stroke-width': q(stroke) }, svg);
  parts.forEach(function (part, i) {
    var arc = svgEl('circle', {
      cx: cx, cy: cy, r: q(r), fill: 'none', stroke: part.color, 'stroke-width': q(stroke), 'class': 'piwin-chart-bar',
      'stroke-dasharray': Math.max(0, part.share * length - gap).toFixed(2) + ' ' + length.toFixed(2),
      'stroke-dashoffset': (-(offset * length + gap / 2)).toFixed(2), transform: 'rotate(-90 ' + cx + ' ' + cy + ')'
    }, svg);
    tip(arc, c, null, i, part.value);
    offset += part.share;
  });
  if (c.center) {
    var center = textEl(svg, cx, c.centerLabel ? cy - 7 : cy, 'piwin-chart-center', 'middle', c.center);
    center.setAttribute('dominant-baseline', 'central');
  }
  if (c.centerLabel) textEl(svg, cx, cy + (c.center ? 15 : 4), 'piwin-chart-tick', 'middle', c.centerLabel);
}

// One bar split into shares: composition at a glance, read precisely from the legend.
function drawStack(svg, c, width) {
  var parts = partsOf(c), live = 0, x = 0;
  parts.forEach(function (part) { if (part.share > 0) live++; });
  var gap = live > 1 ? 3 : 0, usable = width - gap * (live - 1);
  parts.forEach(function (part, i) {
    if (!(part.share > 0)) return;
    var w = Math.max(2, part.share * usable);
    var seg = svgEl('rect', { x: q(x), y: 0, width: q(w), height: c.height, rx: Math.min(5, c.height / 2), fill: part.color, 'class': 'piwin-chart-bar' }, svg);
    tip(seg, c, null, i, part.value);
    x += w + gap;
  });
}

function drawLegend(host, c) {
  if (!c.legend) return;
  var legend = document.createElement('div');
  legend.className = 'piwin-chart-legend';
  var items = c.parts && c.series.length <= 1
    ? partsOf(c).map(function (part, i) { return { name: c.labels[i], color: part.color, note: Math.round(part.share * 100) + '%' }; })
    : c.series.map(function (s) { return { name: s.name, color: s.color, note: '' }; });
  items.forEach(function (item) {
    if (!item.name) return;
    var row = document.createElement('span');
    var swatch = document.createElement('i');
    swatch.style.background = item.color;
    row.appendChild(swatch);
    row.appendChild(document.createTextNode(item.name));
    if (item.note) {
      var note = document.createElement('b');
      note.textContent = item.note;
      row.appendChild(note);
    }
    legend.appendChild(row);
  });
  host.appendChild(legend);
}

function render(figure, spec) {
  var c = normalize(spec, figure.getAttribute('data-piwin-chart'));
  figure.__piwinChart = spec;
  var host = plotHost(figure);
  var width = Math.max(40, Math.floor(host.clientWidth || figure.clientWidth || (c.kind === 'spark' ? 96 : 480)));
  while (host.firstChild) host.removeChild(host.firstChild);
  host.setAttribute('data-kind', c.kind);
  if (c.kind === 'hbar') c.height = Math.max(1, c.count) * 30;
  // A donut is a square beside its legend; every other kind spans the figure.
  var plotW = c.kind === 'donut' ? Math.min(width, c.height) : width;
  var svg = svgEl('svg', { viewBox: '0 0 ' + plotW + ' ' + c.height, width: plotW, height: c.height, role: 'img' }, host);
  var caption = figure.querySelector('figcaption');
  if (caption) svg.setAttribute('aria-label', caption.textContent || '');
  if (c.kind === 'bar') drawBar(svg, c, plotW);
  else if (c.kind === 'hbar') drawHbar(svg, c, plotW);
  else if (c.kind === 'donut') drawDonut(svg, c, plotW);
  else if (c.kind === 'stack') drawStack(svg, c, plotW);
  else drawLine(svg, c, plotW, c.kind === 'spark');
  drawLegend(host, c);
  figure.setAttribute('data-piwin-chart-ready', '');
  host.__piwinWidth = width;
  return figure;
}
`;
