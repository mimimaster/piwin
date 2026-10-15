/**
 * Viz kit renderers for networks (ADR 0093): device icons, topo (devices,
 * links, zones, a packet on its path) and seq (message sequence with slanted
 * arrows and per-actor states). Same contract as `viz-structures.ts`.
 *
 * Icons are trusted constant markup on a 24 grid with the kit v1 stroke.
 * Plain ES5-ish JavaScript in a string; no template literals or `${` inside.
 */
export const ARTIFACT_VIZ_ICON_NAMES = ['host', 'laptop', 'phone', 'server', 'db', 'hub', 'switch', 'router', 'firewall', 'ap', 'cloud'] as const;

export const ARTIFACT_VIZ_NETWORK = String.raw`
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
`;
