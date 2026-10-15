/**
 * Viz kit renderers for data structures (ADR 0093): array, stack, list,
 * tree, graph, hash, window. Each `VIZ.<kind>(spec, ctx)` returns markup for
 * one frame; `ctx.frames` lets a renderer size itself for every step so the
 * figure keeps its size while playing. Helpers come from `viz-runtime.ts`.
 *
 * Plain ES5-ish JavaScript in a string; no template literals or `${` inside.
 */
export const ARTIFACT_VIZ_STRUCTURES = String.raw`
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
`;
