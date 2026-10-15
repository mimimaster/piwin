/* piwin artifact viz 1.0.0 */
(function () {
'use strict';
if (window.__piwinViz) return;
window.__piwinViz = '1.0.0';

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

VIZ.array = function (s) {
  var items = vArr(s.items, 64), html = '<div class="pv-arr">';
  for (var i = 0; i < items.length; i++) {
    var empty = items[i] == null || items[i] === '', ptr = vGet(s.pointers, i);
    html += '<div class="pv-slot"><span class="pv-ptr">' + vEsc(ptr == null ? '' : ptr) + '</span><span class="pv-cell' +
      (empty ? ' pv-empty' : '') + '"' + vt(vGet(s.marks, i)) + '>' + (empty ? '' : vEsc(items[i])) + '</span>' +
      (s.index === false ? '' : '<span class="pv-idx">' + i + '</span>') + '</div>';
  }
  return html + '</div>';
};

VIZ.stack = function (s) {
  var items = vArr(s.items, 32), cap = Math.max(items.length, Math.min(32, vNum(s.capacity, items.length))), html = '<div class="pv-stack">';
  for (var i = 0; i < cap; i++) {
    var has = i < items.length;
    html += '<div class="pv-srow"><span class="pv-idx">' + i + '</span><span class="pv-cell' + (has ? '' : ' pv-empty') + '"' +
      vt(has ? vGet(s.marks, i) : '') + '>' + (has ? vEsc(items[i]) : '') + '</span><span class="pv-sptr">' +
      (i === items.length - 1 ? '← ' + vEsc(s.topLabel == null ? 'top' : s.topLabel) : '') + '</span></div>';
  }
  return html + '</div>';
};

var LIST_W = 64, LIST_H = 28, LIST_GX = 92, LIST_GY = 62;
function listNodes(s) {
  return vArr(s.nodes, 40).map(function (n, i) {
    n = vObj(n);
    return { id: String(n.id == null ? i : n.id), value: n.value == null ? '' : n.value, col: Math.max(0, vNum(n.col, i)), row: vNum(n.row, 0) > 0 ? 1 : 0, head: n.head === true };
  });
}
VIZ.list = function (s, ctx) {
  var maxCol = 0, maxRow = 0;
  ctx.frames.forEach(function (f) { listNodes(f).forEach(function (n) { maxCol = Math.max(maxCol, n.col); maxRow = Math.max(maxRow, n.row); }); });
  var pos = {}, next = vObj(s.next), body = '', id;
  listNodes(s).forEach(function (n) { pos[n.id] = { x: 16 + n.col * LIST_GX, y: 30 + n.row * LIST_GY, n: n }; });
  for (id in next) {
    if (!own(next, id) || !own(pos, id) || !own(pos, String(next[id]))) continue;
    var a = pos[id], b = pos[String(next[id])], tone = vGet(s.linkMarks, id), x1 = a.x + LIST_W - 12, y1 = a.y + LIST_H / 2;
    var x2, y2, cx, cy, angle;
    if (a.n.row === b.n.row) { x2 = b.x; y2 = b.y + LIST_H / 2; cx = x2 - 24; cy = y2; angle = 0; }
    else if (b.n.row > a.n.row) { x2 = b.x + 20; y2 = b.y; cx = x2; cy = y2 - 30; angle = Math.PI / 2; }
    else { x2 = b.x + 20; y2 = b.y + LIST_H; cx = x2; cy = y2 + 30; angle = -Math.PI / 2; }
    var ex = x2 - 7 * Math.cos(angle), ey = y2 - 7 * Math.sin(angle);
    body += '<path class="pv-edge"' + vt(tone) + ' d="M' + x1 + ' ' + y1 + 'C' + (x1 + 24) + ' ' + y1 + ' ' + cx + ' ' + cy + ' ' + vq(ex) + ' ' + vq(ey) + '"/>' +
      vHead(x2, y2, angle, tone);
  }
  for (id in pos) {
    if (!own(pos, id)) continue;
    var p = pos[id], split = p.x + LIST_W - 24, mid = p.y + LIST_H / 2;
    body += '<rect class="pv-node' + (p.n.head ? ' pv-headnode' : '') + '"' + vt(vGet(s.marks, id)) + ' x="' + p.x + '" y="' + p.y + '" width="' + LIST_W +
      '" height="' + LIST_H + '" rx="4"/><line class="pv-sep" x1="' + split + '" y1="' + p.y + '" x2="' + split + '" y2="' + (p.y + LIST_H) + '"/>' +
      vText(p.x + 20, mid, 'pv-mid pv-mono', p.n.value);
    body += own(next, id) ? '<circle class="pv-dot" cx="' + (p.x + LIST_W - 12) + '" cy="' + mid + '" r="2.5"/>' : vText(p.x + LIST_W - 12, mid + 1, 'pv-mid pv-muted', '∧');
    var label = vGet(s.pointers, id);
    if (label != null) {
      var up = p.n.row === 0, ty = up ? p.y - 16 : p.y + LIST_H + 16;
      body += vText(p.x + 20, ty, 'pv-mid pv-mono pv-accent', label) + vArrow(p.x + 20, up ? ty + 7 : ty - 7, p.x + 20, up ? p.y - 1 : p.y + LIST_H + 1, 'accent', 0);
    }
  }
  return vSvg(32 + maxCol * LIST_GX + LIST_W, 30 + maxRow * LIST_GY + LIST_H + (maxRow ? 26 : 8), body, 'list');
};

// Level-order array with heap indexing: children of k sit at 2k+1 and 2k+2.
function treeLayout(tree) {
  var out = [];
  (function walk(k, depth) {
    if (k >= tree.length || tree[k] == null) return;
    walk(2 * k + 1, depth + 1);
    out.push({ k: k, value: tree[k], depth: depth });
    walk(2 * k + 2, depth + 1);
  })(0, 0);
  return out;
}
function treeHeight(tree, k) { return k >= tree.length || tree[k] == null ? 0 : 1 + Math.max(treeHeight(tree, 2 * k + 1), treeHeight(tree, 2 * k + 2)); }
VIZ.tree = function (s, ctx) {
  var most = 1, deepest = 0;
  ctx.frames.forEach(function (f) {
    var nodes = treeLayout(vArr(f.tree, 255));
    most = Math.max(most, nodes.length);
    nodes.forEach(function (n) { deepest = Math.max(deepest, n.depth); });
  });
  var tree = vArr(s.tree, 255), nodes = treeLayout(tree), width = Math.max(240, (most + 1) * 48), pos = {}, body = '', k;
  nodes.forEach(function (n, i) { pos[n.k] = { x: width / 2 + (i - (nodes.length - 1) / 2) * 48, y: 26 + n.depth * 54, n: n }; });
  for (k in pos) if (own(pos, k) && +k > 0) {
    var above = pos[Math.floor((+k - 1) / 2)];
    if (above) body += '<line class="pv-edge" x1="' + vq(above.x) + '" y1="' + above.y + '" x2="' + vq(pos[k].x) + '" y2="' + pos[k].y + '"/>';
  }
  for (k in pos) if (own(pos, k)) {
    var p = pos[k];
    body += '<circle class="pv-node"' + vt(vGet(s.marks, String(p.n.value))) + ' cx="' + vq(p.x) + '" cy="' + p.y + '" r="16"/>' + vText(p.x, p.y, 'pv-mid pv-mono', p.n.value);
    if (s.balance) {
      var bf = treeHeight(tree, 2 * +k + 1) - treeHeight(tree, 2 * +k + 2);
      body += vText(p.x + 19, p.y - 13, Math.abs(bf) > 1 ? 'pv-mono pv-risk' : 'pv-mono pv-muted', bf);
    }
  }
  return vSvg(width, (deepest + 1) * 54 + 18, body, 'tree');
};

function graphNodes(s) {
  var out = [], raw = s.nodes;
  if (Array.isArray(raw)) raw.slice(0, 60).forEach(function (n) { n = vObj(n); if (n.id != null) out.push({ id: String(n.id), x: vNum(n.x), y: vNum(n.y) }); });
  else { raw = vObj(raw); for (var id in raw) if (own(raw, id) && out.length < 60) { var xy = vArr(raw[id], 2); out.push({ id: id, x: vNum(xy[0]), y: vNum(xy[1]) }); } }
  return out;
}
function edgeTone(list, a, b) {
  var tone = '';
  vArr(list, 200).forEach(function (e) { e = vArr(e, 3); if ((String(e[0]) === a && String(e[1]) === b) || (String(e[0]) === b && String(e[1]) === a)) tone = e[2]; });
  return tone;
}
VIZ.graph = function (s) {
  var nodes = graphNodes(s), at = {}, maxX = 0, maxY = 0, body = '';
  nodes.forEach(function (n) { at[n.id] = n; maxX = Math.max(maxX, n.x); maxY = Math.max(maxY, n.y); });
  vArr(s.edges, 200).forEach(function (e) {
    e = vArr(e, 3);
    var a = at[String(e[0])], b = at[String(e[1])];
    if (!a || !b) return;
    var tone = edgeTone(s.edgeMarks, a.id, b.id);
    body += s.directed ? vArrow(a.x, a.y, b.x, b.y, tone, 17) : '<line class="pv-edge"' + vt(tone) + ' x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y + '"/>';
    if (e[2] != null && e[2] !== '') body += vText((a.x + b.x) / 2, (a.y + b.y) / 2, 'pv-mid pv-mono pv-halo', e[2]);
  });
  nodes.forEach(function (n) {
    body += '<circle class="pv-node"' + vt(vGet(s.marks, n.id)) + ' cx="' + n.x + '" cy="' + n.y + '" r="16"/>' + vText(n.x, n.y, 'pv-mid pv-strong', n.id);
  });
  return vSvg(maxX + 40, maxY + 30, body, 'graph');
};

VIZ.hash = function (s) {
  var html = '<div class="pv-hash">';
  vArr(s.buckets, 64).forEach(function (chain, b) {
    chain = vArr(chain, 32);
    html += '<div class="pv-hrow"><span class="pv-cell pv-sm pv-bucket"' + vt(vGet(s.marks, String(b))) + '>' + b + '</span>';
    if (!chain.length) html += '<span class="pv-nil">∧</span>';
    chain.forEach(function (key, i) { html += '<span class="pv-link"></span><span class="pv-cell pv-sm"' + vt(vGet(s.marks, b + '.' + i)) + '>' + vEsc(key) + '</span>'; });
    html += '</div>';
  });
  return html + '</div>';
};

// Sliding window: unmarked cells inside the window are sendable, outside it unusable.
VIZ.window = function (s) {
  var count = Math.max(1, Math.min(64, vNum(s.count, 12))), size = Math.max(1, Math.min(count, vNum(s.size, 4)));
  var start = Math.max(0, Math.min(count - 1, vNum(s.start, 0))), html = '<div class="pv-win" style="--pv-ws:' + start + ';--pv-wn:' + size + '"><div class="pv-wbox"></div>';
  for (var i = 0; i < count; i++) {
    var tone = vGet(s.marks, i), cls = tone ? '' : (i >= start && i < start + size ? ' pv-usable' : ' pv-na');
    html += '<span class="pv-cell' + cls + '"' + vt(tone) + '>' + i + '</span>';
  }
  return html + '</div>';
};

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

var VIZ_ICONS = {
  host: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M9 20h6M12 16v4"/>',
  laptop: '<rect x="5" y="5" width="14" height="10" rx="1"/><path d="M3 18.5h18"/>',
  phone: '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 17.5h2"/>',
  server: '<rect x="4" y="3.5" width="16" height="7" rx="1.5"/><rect x="4" y="13.5" width="16" height="7" rx="1.5"/><path d="M7.5 7h.01M7.5 17h.01M11 7h5.5M11 17h5.5"/>',
  db: '<ellipse cx="12" cy="6" rx="7" ry="2.5"/><path d="M5 6v12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5"/>',
  hub: '<rect x="3" y="7" width="18" height="8" rx="1.5"/><path d="M6.5 15v2.5M10 15v2.5M14 15v2.5M17.5 15v2.5M7 11h.01M10 11h.01"/>',
  'switch': '<rect x="3" y="6.5" width="18" height="11" rx="2"/><path d="M7 10.5h10M15 8.5l2 2-2 2M17 13.5H7M9 11.5l-2 2 2 2"/>',
  router: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v10M7 12h10M10.3 8.7 12 7l1.7 1.7M10.3 15.3 12 17l1.7-1.7M8.7 10.3 7 12l1.7 1.7M15.3 10.3 17 12l-1.7 1.7"/>',
  firewall: '<rect x="3.5" y="5" width="17" height="14" rx="1.5"/><path d="M3.5 9.7h17M3.5 14.3h17M9 5v4.7M15 5v4.7M12 9.7v4.6M9 14.3V19M15 14.3V19"/>',
  ap: '<rect x="5" y="15" width="14" height="5" rx="1.5"/><path d="M12 15v-3.5M8.5 9a5 5 0 0 1 7 0M6 6.5a8.5 8.5 0 0 1 12 0M8.5 17.5h.01"/>',
  cloud: '<path d="M7.2 18.5a4.2 4.2 0 0 1-.4-8.38 5.5 5.5 0 0 1 10.7 1.3A3.6 3.6 0 0 1 17.2 18.5Z"/>'
};
// A 40px tile with the device icon centered on (x, y).
function deviceTile(x, y, icon, tone) {
  var body = own(VIZ_ICONS, icon) ? VIZ_ICONS[icon] : VIZ_ICONS.host;
  return '<rect class="pv-tile"' + vt(tone) + ' x="' + vq(x - 20) + '" y="' + vq(y - 20) + '" width="40" height="40" rx="9"/><svg class="pv-ico" x="' + vq(x - 13) + '" y="' +
    vq(y - 13) + '" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' + body + '</svg>';
}

VIZ.topo = function (s) {
  var nodes = {}, maxX = 0, maxY = 0, body = '', via = vArr(s.via, 2).map(String);
  vArr(s.nodes, 60).forEach(function (n) {
    n = vObj(n);
    if (n.id == null) return;
    nodes[String(n.id)] = { x: vNum(n.x), y: vNum(n.y), icon: n.icon, label: n.label, sub: n.sub };
    maxX = Math.max(maxX, vNum(n.x)); maxY = Math.max(maxY, vNum(n.y));
  });
  vArr(s.zones, 12).forEach(function (z) {
    z = vObj(z);
    var x = vNum(z.x), y = vNum(z.y), w = vNum(z.w), h = vNum(z.h);
    maxX = Math.max(maxX, x + w - 40); maxY = Math.max(maxY, y + h - 50);
    body += '<rect class="pv-zone" x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="12"/>' + vText(x + 12, y + 18, 'pv-mono pv-muted', z.label);
  });
  vArr(s.links, 120).forEach(function (l) {
    l = vArr(l, 3);
    var a = nodes[String(l[0])], b = nodes[String(l[1])];
    if (!a || !b) return;
    var hot = via.length === 2 && ((via[0] === String(l[0]) && via[1] === String(l[1])) || (via[1] === String(l[0]) && via[0] === String(l[1])));
    body += '<line class="pv-link-line' + (l[2] === 'wireless' ? ' pv-wireless' : '') + '"' + (hot ? vt('accent') : '') + ' x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y + '"/>';
  });
  for (var id in nodes) if (own(nodes, id)) {
    var n = nodes[id];
    body += deviceTile(n.x, n.y, n.icon, vGet(s.marks, id) || (s.at === id ? 'accent' : '')) + vText(n.x, n.y + 33, 'pv-mid', n.label == null ? id : n.label) +
      (n.sub == null || n.sub === '' ? '' : vText(n.x, n.y + 47, 'pv-mid pv-mono pv-muted', n.sub));
  }
  if (s.at != null && own(nodes, String(s.at))) {
    var p = nodes[String(s.at)];
    body += '<circle class="pv-packet" cx="' + (p.x + 18) + '" cy="' + (p.y - 18) + '" r="6"/>';
  }
  return vSvg(maxX + 70, maxY + 60, body, 'topology');
};

var SEQ_TOP = 70, SEQ_GAP = 55, SEQ_DROP = 40;
VIZ.seq = function (s) {
  var actors = vArr(s.actors, 6).map(function (a) { return vObj(a); }), msgs = vArr(s.msgs, 30).map(function (m) { return vObj(m); });
  var upto = s.upto == null ? msgs.length : vNum(s.upto, msgs.length), xs = {}, body = '';
  var height = SEQ_TOP + Math.max(1, msgs.length) * SEQ_GAP + 20, width = 220 + Math.max(1, actors.length - 1) * 200;
  actors.forEach(function (a, i) {
    var x = 110 + i * 200, id = String(a.id == null ? i : a.id), left = i === 0;
    xs[id] = { x: x, left: left };
    body += (a.icon ? deviceTile(x, 26, a.icon, '') : '') + vText(left ? x - 28 : x + 28, 31, left ? 'pv-end' : '', a.label == null ? id : a.label) +
      '<line class="pv-life" x1="' + x + '" y1="50" x2="' + x + '" y2="' + (height - 6) + '"/>';
  });
  msgs.forEach(function (m, k) {
    var a = xs[String(m.from)], b = xs[String(m.to)];
    if (!a || !b || k >= upto) return;
    var y1 = SEQ_TOP + k * SEQ_GAP, y2 = y1 + SEQ_DROP, tone = m.tone || (k === upto - 1 ? 'accent' : ''), deg = Math.atan2(y2 - y1, b.x - a.x) * 180 / Math.PI;
    if (deg > 90) deg -= 180; else if (deg < -90) deg += 180;
    body += vArrow(a.x, y1, b.x, y2, tone, 1) + '<text class="pv-mono pv-msg' + (tone === 'accent' ? ' pv-accent' : '') + '" text-anchor="middle" transform="translate(' +
      vq((a.x + b.x) / 2) + ',' + vq((y1 + y2) / 2) + ') rotate(' + vq(deg) + ') translate(0,-7)">' + vEsc(m.label) + '</text>';
  });
  // State labels sit beside each lifeline from the message that entered them.
  var states = vObj(s.states);
  for (var id in states) if (own(states, id) && own(xs, id)) {
    var lane = xs[id], list = vArr(states[id], 20).map(function (st) { return vArr(st, 2); }).filter(function (st) { return vNum(st[1]) <= upto; });
    list.forEach(function (st, i) {
      var after = vNum(st[1]), y = 66;
      if (after > 0) {
        var m = msgs[after - 1] || {};
        y = SEQ_TOP + (after - 1) * SEQ_GAP + (String(m.to) === id ? SEQ_DROP + 7 : 20);
      }
      body += vText(lane.left ? lane.x - 10 : lane.x + 10, y, 'pv-mono ' + (lane.left ? 'pv-end ' : '') + (i === list.length - 1 ? 'pv-accent' : 'pv-muted'), st[0]);
    });
  }
  return vSvg(width, height, body, 'sequence');
};

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

})();
