/**
 * Viz kit renderers for layouts on a scale (ADR 0093): bits, grid, gantt,
 * blocks, seek, layers. Same contract as `viz-structures.ts`.
 *
 * Plain ES5-ish JavaScript in a string; no template literals or `${` inside.
 */
export const ARTIFACT_VIZ_GRIDS = String.raw`
function bitFields(s) {
  return vArr(s.fields, 64).map(function (f, i) {
    f = vObj(f);
    return { name: f.name == null ? '' : f.name, bits: Math.max(1, Math.min(128, Math.round(vNum(f.bits, 1)))), value: f.value, tone: f.tone, dashed: f.dashed === true, series: i % 4 + 1 };
  });
}
VIZ.bits = function (s) {
  var fields = bitFields(s), total = 0;
  fields.forEach(function (f) { total += f.bits; });
  var width = Math.max(1, Math.min(64, Math.round(vNum(s.width, total))));
  if (total <= width) {
    // One register: each field as wide as its bit count, labelled with its bit range.
    var hi = total - 1, html = '<div class="pv-bits">';
    fields.forEach(function (f) {
      var lo = hi - f.bits + 1;
      html += '<div class="pv-bf" style="flex-grow:' + f.bits + '"><span class="pv-br"><span>' + hi + '</span>' + (f.bits > 1 ? '<span>' + lo + '</span>' : '') +
        '</span><span class="pv-bv' + (f.dashed ? ' pv-dashed' : '') + '" data-s="' + f.series + '"' + vt(f.tone) + '>' + (f.value == null || f.value === '' ? '&nbsp;' : vEsc(f.value)) +
        '</span><span class="pv-bn">' + vEsc(f.name) + ' <span class="pv-idx">' + f.bits + '</span></span></div>';
      hi = lo - 1;
    });
    return html + '</div>';
  }
  // A header: fields flow into rows of width bits under a bit ruler.
  var grid = '<div class="pv-hdr" style="grid-template-columns:repeat(' + width + ',minmax(0,1fr));min-width:' + Math.max(320, width * 17) + 'px">';
  for (var b = 0; b < width; b += 8) {
    var end = Math.min(width, b + 8);
    grid += '<span class="pv-rl" style="grid-column:' + (b + 1) + '/' + (end + 1) + '"><span>' + b + '</span>' + (end === width ? '<span>' + (width - 1) + '</span>' : '') + '</span>';
  }
  fields.forEach(function (f) {
    var label = f.value == null || f.value === '' ? f.name : f.name + ' ' + f.value;
    grid += '<span class="pv-hf' + (f.dashed ? ' pv-dashed' : '') + (f.bits === 1 ? ' pv-flag' : '') + '"' + vt(f.tone) + ' style="grid-column:span ' + Math.min(width, f.bits) +
      '" title="' + vEsc(label) + '">' + vEsc(label) + '</span>';
  });
  return grid + '</div>';
};

// Time-space grid: cell "~" is a pipeline bubble; cells after column upto stay empty.
VIZ.grid = function (s) {
  var cols = Array.isArray(s.cols) ? vArr(s.cols, 60) : [], marks = vObj(s.marks), now = s.now == null ? -1 : vNum(s.now, -1);
  if (!cols.length) for (var n = 0; n < Math.min(60, vNum(s.cols, 0)); n++) cols.push(n + 1);
  var upto = s.upto == null ? cols.length - 1 : vNum(s.upto, cols.length - 1);
  var html = '<table class="pv-grid"><tr><th></th>' + cols.map(function (c, i) { return '<th' + (i === now ? ' class="pv-now"' : '') + '>' + vEsc(c) + '</th>'; }).join('') + '</tr>';
  vArr(s.rows, 40).forEach(function (row, r) {
    row = vObj(row);
    var cells = vArr(row.cells, 60);
    html += '<tr><th class="pv-rh">' + vEsc(row.label) + '</th>';
    for (var c = 0; c < cols.length; c++) {
      var v = c <= upto ? cells[c] : null, filled = v != null && v !== '', cls = filled ? (v === '~' ? 'pv-bubble' : 'pv-on') : '';
      if (filled && c === now) cls += ' pv-nowcell';
      html += '<td' + (cls ? ' class="' + cls + '"' : '') + (filled ? vt(marks[r + '.' + c]) : '') + '>' + (filled ? (v === '~' ? '·' : vEsc(v)) : '') + '</td>';
    }
    html += '</tr>';
  });
  return html + '</table>';
};

// Axis labels under a bar, skipping any that would collide with the previous one.
function scaleTicks(values, min, max) {
  var seen = {}, out = '', last = -1e9;
  values.sort(function (a, b) { return a - b; }).forEach(function (v) {
    var pct = (v - min) / (max - min) * 100;
    if (seen[v] || pct - last < 5) return;
    seen[v] = 1; last = pct;
    out += '<span class="pv-tick" style="left:' + vq(pct) + '%">' + vEsc(v) + '</span>';
  });
  return '<div class="pv-ticks">' + out + '</div>';
}
VIZ.gantt = function (s) {
  var segments = vArr(s.segments, 120).map(function (g) { g = vObj(g); return { label: g.label == null ? '' : String(g.label), from: vNum(g.from), to: vNum(g.to) }; });
  var start = 0, end = vNum(s.end, 0), series = {}, used = 0, ticks = [];
  segments.forEach(function (g) {
    start = Math.min(start, g.from); end = Math.max(end, g.to); ticks.push(g.from, g.to);
    if (!own(series, g.label)) series[g.label] = used++ % 6 + 1;
  });
  if (!(end > start)) end = start + 1;
  var upto = s.upto == null ? segments.length - 1 : vNum(s.upto, segments.length - 1), html = '<div class="pv-scale"><div class="pv-gbar">';
  segments.forEach(function (g, i) {
    html += '<div class="pv-gseg' + (i > upto ? ' pv-off' : '') + '" data-s="' + series[g.label] + '" style="left:' + vq((g.from - start) / (end - start) * 100) + '%;width:' +
      vq((g.to - g.from) / (end - start) * 100) + '%">' + vEsc(g.label) + '</div>';
  });
  return html + '</div>' + scaleTicks(ticks, start, end) + '</div>';
};

VIZ.blocks = function (s) {
  var blocks = vArr(s.blocks, 60).map(function (k) { k = vObj(k); return { label: k.label == null ? '' : k.label, from: vNum(k.from), to: vNum(k.to), kind: k.kind, tone: k.tone }; });
  var total = vNum(s.total, 0), unit = s.unit == null ? '' : String(s.unit).slice(0, 4), ticks = [0];
  blocks.forEach(function (k) { total = Math.max(total, k.to); ticks.push(k.from, k.to); });
  if (!(total > 0)) total = 1;
  var html = '<div class="pv-scale"><div class="pv-mbar">';
  blocks.forEach(function (k) {
    var size = k.to - k.from, cls = k.kind === 'free' ? ' pv-free' : k.kind === 'fixed' ? ' pv-fixed' : '';
    var label = size / total >= 0.06 ? vEsc(k.label === '' && k.kind === 'free' ? '空闲' : k.label) + '<small>' + vEsc(size + unit) + '</small>' : '';
    html += '<div class="pv-mblk' + cls + '"' + vt(k.tone) + ' style="left:' + vq(k.from / total * 100) + '%;width:' + vq(size / total * 100) + '%">' + label + '</div>';
  });
  return html + '</div>' + scaleTicks(ticks, 0, total) + '</div>';
};

// Head movement: track on the x axis, one row per visit going down.
VIZ.seek = function (s, ctx) {
  var range = vArr(s.range, 2), min = vNum(range[0], 0), max = vNum(range[1], 199), path = vArr(s.path, 60).map(function (t) { return vNum(t); });
  var rows = 1;
  ctx.frames.forEach(function (f) { rows = Math.max(rows, vArr(f.path, 60).length); });
  if (!(max > min)) max = min + 1;
  var upto = s.upto == null ? path.length - 1 : vNum(s.upto, path.length - 1), body = '', x = function (t) { return 24 + (t - min) / (max - min) * 384; };
  var y = function (k) { return 46 + k * 19; };
  body += '<line class="pv-axis" x1="' + x(min) + '" y1="28" x2="' + x(max) + '" y2="28"/>';
  [0, 0.25, 0.5, 0.75, 1].forEach(function (p) {
    var t = Math.round(min + (max - min) * p);
    body += '<line class="pv-axis" x1="' + vq(x(t)) + '" y1="24" x2="' + vq(x(t)) + '" y2="32"/>' + vText(x(t), 14, 'pv-mid pv-mono pv-muted', t);
  });
  var shown = path.slice(0, upto + 1);
  body += '<polyline class="pv-line" points="' + shown.map(function (t, k) { return vq(x(t)) + ',' + y(k); }).join(' ') + '"/>';
  shown.forEach(function (t, k) {
    var last = k === shown.length - 1;
    body += '<circle class="pv-pt"' + vt(last ? 'accent' : k === 0 ? 'warn' : '') + ' cx="' + vq(x(t)) + '" cy="' + y(k) + '" r="' + (last ? 4.5 : 3.5) + '"/>' +
      vText(x(t) + 8, y(k) + 4, 'pv-mono pv-muted', t);
  });
  return vSvg(440, y(rows - 1) + 18, body, 'seek');
};

// Encapsulation rows: parts span columns from..to (1-based); rows after upto fade.
VIZ.layers = function (s) {
  var cols = vArr(s.cols, 12).map(function (w) { return Math.max(0.2, vNum(w, 1)); }), rows = vArr(s.rows, 12), maxTo = 1;
  rows.forEach(function (row) { vArr(vObj(row).parts, 12).forEach(function (p) { maxTo = Math.max(maxTo, vNum(vObj(p).to, vNum(vObj(p).from, 1))); }); });
  while (cols.length < maxTo) cols.push(1);
  var upto = s.upto == null ? rows.length - 1 : vNum(s.upto, rows.length - 1);
  var html = '<div class="pv-layers" style="grid-template-columns:auto ' + cols.map(function (w) { return w + 'fr'; }).join(' ') + '">';
  rows.forEach(function (row, r) {
    row = vObj(row);
    var off = r > upto ? ' pv-off' : '';
    html += '<span class="pv-lay' + off + '" style="grid-row:' + (r + 1) + '">' + vEsc(row.label) + (row.sub == null ? '' : '<small>' + vEsc(row.sub) + '</small>') + '</span>';
    vArr(row.parts, 12).forEach(function (p) {
      p = vObj(p);
      var from = Math.max(1, vNum(p.from, 1)), to = Math.max(from, vNum(p.to, from)), series = vNum(p.series, 0);
      html += '<span class="pv-part' + off + '"' + (series >= 1 && series <= 6 ? ' data-s="' + Math.round(series) + '"' : '') + vt(p.tone) +
        ' style="grid-row:' + (r + 1) + ';grid-column:' + (from + 1) + '/' + (to + 2) + '">' + vEsc(p.text) + '</span>';
    });
  });
  return html + '</div>';
};
`;
