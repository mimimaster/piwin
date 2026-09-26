// Scene-specific motion that the declarative animator cannot express:
// canvas washes, travelling packets, the voice orb, scrolling transcripts.
import {
  COLORS, H, W, drawAmbient, drawDrop, drawEnso, drawPageStroke, drawSealDot, drawWash,
} from './ink.js';
import {
  DURATION, FEATURE_END, FEATURE_SPAN, FEATURE_START, clamp, easeInOut, easeOut, lerp, progress, seededRandom,
} from './timeline.js';

const PAGE_TURNS = [22.4, 28.8, 35.2, 41.6, 48, 54.4, 60.8, 86.4];

// ── canvas layers ──────────────────────────────────────────

export function renderBackground(ctx, t) {
  ctx.globalAlpha = 1;
  ctx.fillStyle = COLORS.INK;
  ctx.fillRect(0, 0, W, H);

  const paperIn = t >= 66.9 && t < 77.8;
  const ambient = t < 3.2 ? 0 : Math.min(progress(t, 3.2, 2), paperIn ? 1 - progress(t, 66.9, 0.6) : 1);
  drawAmbient(ctx, t, paperIn && t > 67.5 && t < 76.5 ? 0 : ambient);

  // Intro: paper, a drop, and ink blooming to fill the desk.
  if (t < 4.4) {
    ctx.fillStyle = COLORS.PAPER;
    ctx.fillRect(0, 0, W, H);
    drawDrop(ctx, 960, 470, t, 0.5, 1.6);
    const bloom = easeInOut(progress(t, 1.6, 2.6));
    drawWash(ctx, COLORS.INK, 960, 470, bloom * 1450, 11, t);
    if (t < 1.6) drawWash(ctx, COLORS.INK, 960, 470, 0, 11, t);
  }

  // Steps: paper washes in, then ink returns from the send button.
  if (paperIn) {
    drawWash(ctx, COLORS.PAPER, 960, 560, easeInOut(progress(t, 66.9, 1.1)) * 1450, 23, t);
    const back = easeInOut(progress(t, 76.4, 1.2));
    if (back > 0) drawWash(ctx, COLORS.INK, 1690, 790, back * 2050, 31, t);
  }

  // Intro ensō.
  if (t > 3.5 && t < 13) {
    const move = easeInOut(progress(t, 6.9, 1.2));
    const cx = 960;
    const cy = lerp(470, 300, move);
    const radius = lerp(230, 150, move);
    const alpha = 1 - progress(t, 12.1, 0.7);
    drawEnso(ctx, cx, cy, radius, easeOut(progress(t, 3.6, 2.5)), alpha);
    drawSealDot(ctx, cx, cy, radius, progress(t, 6.2, 0.55), alpha);
  }

  // Finale ensō.
  if (t > 96.4) {
    const alpha = 1 - progress(t, 107, 2);
    drawEnso(ctx, 960, 380, 170, easeOut(progress(t, 96.6, 2.3)), alpha, 19);
    drawSealDot(ctx, 960, 380, 170, progress(t, 99.2, 0.55), alpha);
  }
}

export function renderFx(ctx, t) {
  ctx.clearRect(0, 0, W, H);
  PAGE_TURNS.forEach((at, index) => drawPageStroke(ctx, t, at, 100 + index * 17));
}

// ── DOM scenes ─────────────────────────────────────────────

/** One-time DOM generation for repetitive pieces (kept out of index.html). */
export function buildDynamicDom(doc) {
  buildHostPackets(doc);
  buildNoiseDots(doc);
  buildOrb(doc);
  buildModelTable(doc);
  buildCodeFall(doc);
  buildRail(doc);
}

function buildHostPackets(doc) {
  const group = doc.getElementById('host-pkts');
  const ns = 'http://www.w3.org/2000/svg';
  for (let i = 0; i < 10; i += 1) {
    const circle = doc.createElementNS(ns, 'circle');
    circle.setAttribute('r', i % 2 ? '4' : '5');
    circle.setAttribute('class', i % 2 ? 'pkt down' : 'pkt');
    circle.style.opacity = '0';
    group.appendChild(circle);
  }
}

function buildNoiseDots(doc) {
  const host = doc.getElementById('f2-noise');
  const rand = seededRandom(5);
  const scouts = [[150, 300], [416, 320], [682, 300]];
  scouts.forEach(([x, y], s) => {
    for (let i = 0; i < 16; i += 1) {
      const angle = rand() * Math.PI * 2;
      const r = 62 + rand() * 50;
      const dot = doc.createElement('i');
      dot.className = 'noise-dot';
      dot.style.left = `${x + Math.cos(angle) * r * 1.5}px`;
      dot.style.top = `${y + Math.sin(angle) * r * 0.8 + 30}px`;
      dot.dataset.in = String(1.4 + s * 0.1 + rand() * 0.6);
      dot.dataset.fx = 'pop';
      dot.dataset.dur = '0.3';
      dot.dataset.out = '2.15';
      host.appendChild(dot);
    }
  });
}

function buildOrb(doc) {
  const svg = doc.getElementById('f3-orb');
  const ns = 'http://www.w3.org/2000/svg';
  for (let i = 0; i < 72; i += 1) {
    const line = doc.createElementNS(ns, 'line');
    svg.appendChild(line);
  }
}

const MODEL_ROWS = [
  ['对话 / 推理', 'C', 'Claude Sonnet 4.6'],
  ['视觉委托', 'G', 'Gemini 2.5 Flash'],
  ['输出委托', 'D', 'DeepSeek V3'],
  ['图片生成', 'O', 'gpt-image-1'],
  ['视频生成', 'K', 'Kling 2.1'],
  ['实时语音', 'X', 'Codex Live'],
  ['Embedding · 重排', 'B', 'bge-m3 · reranker'],
  ['code_search', 'D', 'Devin Fast-Context'],
];

function buildModelTable(doc) {
  const table = doc.getElementById('f4-table');
  MODEL_ROWS.forEach(([cap, letter, model], index) => {
    const at = 0.6 + index * 0.32;
    const ms = 180 + ((index * 97) % 320);
    const row = doc.createElement('div');
    row.className = 'mrow';
    row.dataset.in = at.toFixed(2);
    row.dataset.fx = 'right';
    row.dataset.steps = `${(at + 0.2).toFixed(2)}:run,${(at + 0.85).toFixed(2)}:done`;
    row.innerHTML = `<span class="cap">${cap}</span><span class="model"><span class="av">${letter}</span>${model}</span>`
      + `<span class="st run"><i class="grind"></i>调用测试…</span><span class="st done">✓ 通过 · ${ms}ms</span>`;
    table.appendChild(row);
  });
}

const CODE_LINES = [
  'export function buildArtifactSrcdoc(input) {', '  const theme = resolveTheme(input.theme);', 'import { escapeAttribute } from "./escape.js";',
  '  if (!policy.allowScripts) return BLOCKED;', 'const DEFAULT_ARTIFACT_CSP = "default-src \'self\'";', '  frameSources: input.frameSources ?? [],',
  'function detectExternalArtifactResources(html) {', '  for (const node of walk(dom)) {', 'export type SrcdocInput = {', '  sandbox="allow-scripts"',
  '  return directives.join("; ");', 'describe("buildStrictArtifactCsp", () => {', '  expect(csp).toContain("default-src \'none\'");',
  'const iframe = document.createElement("iframe");', '  onMessage(event => bridge.handle(event));', 'export const MAX_ARTIFACT_BYTES = 2_000_000;',
  '  "img-src data: blob:",', '  "style-src \'unsafe-inline\'",', 'if (resources.external.length > 0) {', '  queue.push({ kind: "confirm-frame" });',
];

function buildCodeFall(doc) {
  const fall = doc.getElementById('f7-fall');
  const rand = seededRandom(9);
  const lines = [];
  for (let i = 0; i < 80; i += 1) {
    const text = CODE_LINES[Math.floor(rand() * CODE_LINES.length)] ?? '';
    const hit = /Csp|CSP|sandbox/.test(text) && rand() > 0.5;
    lines.push(hit ? `<span class="hit">${escapeHtml(text)}</span>` : escapeHtml(text));
  }
  fall.innerHTML = lines.join('\n');
}

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

function buildRail(doc) {
  const rail = doc.getElementById('rail');
  rail.innerHTML = ['壹', '贰', '叁', '肆', '伍', '陆', '柒'].map((ch) => `<span>${ch}</span>`).join('<i></i>');
}

// ── per-frame custom motion ────────────────────────────────

export function createCustomUpdaters(doc) {
  const hostPaths = [...doc.querySelectorAll('#s-host .host-links path')];
  const hostLengths = hostPaths.map((path) => path.getTotalLength());
  const packets = [...doc.querySelectorAll('#host-pkts circle')];
  const cursor = doc.getElementById('f1-cursor');
  const orbLines = [...doc.querySelectorAll('#f3-orb line')];
  const railItems = [...doc.querySelectorAll('#rail span')];
  const rail = doc.getElementById('rail');
  const grinds = [...doc.querySelectorAll('.grind')];
  const demoScroll = doc.getElementById('demo-scroll');
  const demoItems = [...doc.querySelectorAll('#s-demo .demo-item')].map((el) => ({ el, at: Number(el.dataset.in ?? 0) }));
  const drifts = [...doc.querySelectorAll('#s-gallery .drift')];
  const stIcon = doc.getElementById('st-icon');
  const status = doc.getElementById('demo-status');
  let demoMetrics = null;

  const measureDemo = () => {
    const viewport = 860 - 54 - 60;
    demoMetrics = demoItems.map(({ el }) => Math.max(0, el.offsetTop + el.offsetHeight - viewport));
  };

  return {
    global(t) {
      const railAlpha = progress(t, FEATURE_START + 0.3, 0.5) * (1 - progress(t, FEATURE_END - 0.5, 0.4));
      rail.style.opacity = String(railAlpha);
      const active = Math.floor((t - FEATURE_START) / FEATURE_SPAN);
      railItems.forEach((item, index) => item.classList.toggle('on', index === active));
      const spin = `rotate(${(t * 300) % 360}deg)`;
      for (const grind of grinds) grind.style.transform = spin;
    },
    host(lt) {
      packets.forEach((dot, index) => {
        const pathIndex = index % hostPaths.length;
        const path = hostPaths[pathIndex];
        const length = hostLengths[pathIndex] ?? 0;
        if (!path || lt < 3.4) {
          dot.style.opacity = '0';
          return;
        }
        const reverse = dot.classList.contains('down');
        const phase = ((lt - 3.4) / 1.5 + index * 0.37) % 1;
        const pt = path.getPointAtLength(length * (reverse ? 1 - phase : phase));
        dot.setAttribute('cx', pt.x.toFixed(1));
        dot.setAttribute('cy', pt.y.toFixed(1));
        dot.style.opacity = String(Math.sin(phase * Math.PI) * progress(lt, 3.4, 0.5) * (1 - progress(lt, 9.1, 0.4)));
      });
    },
    f1(lt) {
      const move = easeInOut(progress(lt, 0.7, 0.8));
      const press = lt > 1.5 && lt < 1.75 ? 0.85 : 1;
      cursor.style.left = `${lerp(300, 440, move)}px`;
      cursor.style.top = `${lerp(420, 148, move)}px`;
      cursor.style.transform = `scale(${press})`;
      cursor.style.opacity = String(progress(lt, 0.6, 0.3) * (1 - progress(lt, 2.4, 0.4)));
    },
    f2(lt, root) {
      const modes = [
        ['#f2-ultra', 0.55, 2.55],
        ['#f2-fusion', 2.7, 4.15],
        ['#f2-review', 4.3, 7],
      ];
      for (const [selector, start, end] of modes) {
        const el = root.querySelector(selector);
        el.style.opacity = String(progress(lt, start, 0.3) * (1 - progress(lt, end, 0.25)));
      }
      const target = lt < 2.7 ? 0 : lt < 4.3 ? 1 : 2;
      const from = lt < 2.7 ? 0 : lt < 4.3 ? 0 : 1;
      const switchAt = lt < 4.3 ? 2.7 : 4.3;
      const pos = lerp(from, target, easeInOut(progress(lt, switchAt, 0.35)));
      root.querySelector('#f2-ind').style.transform = `translateX(${pos * 100}%)`;
      root.querySelectorAll('.carry').forEach((dot, index) => {
        const [x, y] = (dot.dataset.from ?? '0,0').split(',').map(Number);
        const p = easeInOut(progress(lt, 2.05 + index * 0.08, 0.45));
        dot.style.left = `${lerp(x, 416, p)}px`;
        dot.style.top = `${lerp(y, 62, p)}px`;
        dot.style.opacity = String(p > 0 && p < 1 ? 1 : 0);
      });
      const brief = root.querySelector('#f2-brief');
      const result = root.querySelector('#f2-result');
      const bp = easeInOut(progress(lt, 3.1, 0.55));
      const rp = easeInOut(progress(lt, 3.6, 0.55));
      brief.style.left = `${lerp(260, 580, bp)}px`;
      brief.style.top = `${150 - Math.sin(bp * Math.PI) * 30}px`;
      brief.style.opacity = String(bp > 0 && bp < 1 ? 1 : 0);
      result.style.left = `${lerp(580, 260, rp)}px`;
      result.style.top = `${270 + Math.sin(rp * Math.PI) * 30}px`;
      result.style.opacity = String(rp > 0 && rp < 1 ? 1 : 0);
    },
    f3(lt) {
      const user = progress(lt, 0.8, 0.2) * (1 - progress(lt, 2.2, 0.2));
      const live = Math.max(
        progress(lt, 2.5, 0.2) * (1 - progress(lt, 3.3, 0.2)),
        progress(lt, 5.3, 0.2) * (1 - progress(lt, 6.1, 0.2)),
      );
      const energy = Math.max(user, live);
      const color = live > user ? '#e7b352' : '#ebe5da';
      orbLines.forEach((line, index) => {
        const angle = (index / orbLines.length) * Math.PI * 2 - Math.PI / 2;
        const wobble = Math.abs(Math.sin(lt * 9 + index * 0.9) * Math.sin(lt * 3.3 + index * 0.37));
        const idle = 6 + Math.sin(lt * 2 + index * 0.5) * 3;
        const len = idle + energy * (14 + wobble * 60);
        const r0 = 118;
        line.setAttribute('x1', (Math.cos(angle) * r0).toFixed(1));
        line.setAttribute('y1', (Math.sin(angle) * r0).toFixed(1));
        line.setAttribute('x2', (Math.cos(angle) * (r0 + len)).toFixed(1));
        line.setAttribute('y2', (Math.sin(angle) * (r0 + len)).toFixed(1));
        line.style.stroke = color;
        line.style.opacity = String(0.35 + energy * 0.65);
      });
    },
    f6(lt, root) {
      const scan = progress(lt, 0.9, 1.4);
      const line = root.querySelector('#f6-scan');
      const mask = root.querySelector('#f6-mask');
      line.style.top = `${scan * 290}px`;
      line.style.opacity = String(scan > 0 && scan < 1 ? 1 : 0);
      mask.style.height = `${scan * 290}px`;
      mask.style.opacity = String(1 - progress(lt, 2.4, 0.4));
    },
    f7(lt, root) {
      const fall = root.querySelector('#f7-fall');
      const speed = lt < 2.6 ? lt * 620 : 2.6 * 620 + (lt - 2.6) * 40;
      fall.style.transform = `translateY(${-(speed % 1200)}px)`;
    },
    steps(lt) {
      const move = easeInOut(progress(lt, 1.7, 0.9));
      stIcon.style.transform = `translateX(${move * 262}px) scale(${lerp(1, 0.5, move)})`;
      stIcon.style.opacity = String(1 - progress(lt, 2.5, 0.3));
    },
    demo(lt) {
      if (!demoMetrics) measureDemo();
      const metrics = demoMetrics ?? [];
      let index = -1;
      for (let i = 0; i < demoItems.length; i += 1) if (lt >= (demoItems[i]?.at ?? 0)) index = i;
      let scroll = 0;
      if (index >= 0) {
        const prev = index > 0 ? metrics[index - 1] ?? 0 : 0;
        const next = metrics[index] ?? 0;
        scroll = lerp(prev, next, easeInOut(progress(lt, demoItems[index]?.at ?? 0, 0.6)));
      }
      demoScroll.style.transform = `translateY(${-scroll}px)`;
      const done = lt >= 8.9;
      status.style.color = done ? 'var(--pine)' : '';
      status.lastChild.textContent = done ? '已完成 · 00:38' : '运行中';
    },
    gallery(lt) {
      drifts.forEach((drift, index) => {
        const depth = Number(drift.dataset.depth ?? 1);
        const x = Math.sin(lt * 0.35 + index) * 10 * depth - lt * 3 * (index % 2 ? -depth : depth);
        const y = Math.cos(lt * 0.3 + index * 2) * 8 * depth;
        const rotY = index === 0 ? Math.sin(lt * 0.25) * 4 : (index < 3 ? 12 : -12);
        const rotX = index === 0 ? 6 - lt * 0.3 : 4;
        const zoom = index === 0 ? 1 + lt * 0.006 : 1;
        drift.style.transform = `translate(${x}px, ${y}px) rotateX(${rotX}deg) rotateY(${rotY}deg) scale(${zoom})`;
      });
    },
  };
}

export function blackoutAlpha(t) {
  return Math.max(1 - progress(t, 0, 0.5), progress(t, DURATION - 2.8, 2.4));
}

export const sceneFade = (t, scene) => {
  const fadeIn = scene.id === 'intro' ? 1 : progress(t, scene.start, 0.45);
  const fadeOut = scene.id === 'finale' ? 1 : 1 - progress(t, scene.end - 0.4, 0.4);
  return clamp(Math.min(fadeIn, fadeOut));
};
