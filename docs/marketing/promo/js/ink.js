// Canvas ink renderers: paper/ink washes, the ensō brush circle, the falling
// drop, lamp motes and the vermilion page-turn stroke. Pure functions of time.
import { clamp, easeIn, easeInOut, easeOut, lerp, progress, seededRandom, springOut } from './timeline.js';

export const W = 1920;
export const H = 1080;

const INK = '#0b0a09';
const PAPER = '#e6e1d7';
const PAPER_BRUSH = '#efe9df';
const ZHU = '#e25a3d';
const LAMP = '231,179,82';

/** Organic blob — radius wobbles with a few seeded sine octaves so washes never look like circles. */
export function drawWash(ctx, color, cx, cy, radius, seed, t, alpha = 1) {
  if (radius <= 0 || alpha <= 0) return;
  const rand = seededRandom(seed);
  const waves = Array.from({ length: 5 }, (_, i) => ({
    freq: 3 + i * 2 + Math.floor(rand() * 3),
    phase: rand() * Math.PI * 2,
    amp: (0.05 / (i + 1)) * (0.6 + rand()),
    drift: (rand() - 0.5) * 0.6,
  }));
  const rough = clamp(1.4 - radius / 900, 0.35, 1.4);
  ctx.save();
  ctx.fillStyle = color;
  // Feathered halo passes first, solid body last.
  for (const [scale, a] of [[1.1, 0.12], [1.05, 0.22], [1, 1]]) {
    ctx.globalAlpha = alpha * a;
    ctx.beginPath();
    for (let i = 0; i <= 180; i += 1) {
      const angle = (i / 180) * Math.PI * 2;
      let offset = 0;
      for (const wave of waves) offset += Math.sin(angle * wave.freq + wave.phase + t * wave.drift) * wave.amp;
      const r = radius * scale * (1 + offset * rough);
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Ensō in the style of the app icon: pressed-in thick start near the top, sweeping
 * counter-clockwise, drying into separate bristles before the vermilion dot.
 */
export function drawEnso(ctx, cx, cy, radius, p, alpha = 1, seed = 7) {
  if (p <= 0 || alpha <= 0) return;
  const rand = seededRandom(seed);
  const start = (-68 * Math.PI) / 180;
  const span = (312 * Math.PI) / 180;
  const width = radius * 0.34;
  const widthAt = (f) => width * (f < 0.035 ? 0.55 + (f / 0.035) * 0.45 : 1 - 0.5 * f) ;
  const point = (f, off, wobble = 0) => {
    const angle = start - f * span;
    const r = radius + off * widthAt(f) + wobble;
    return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r];
  };
  ctx.save();
  ctx.lineCap = 'round';
  // Solid core — ends before the dry tail.
  const coreEnd = Math.min(p, 0.8);
  ctx.globalAlpha = alpha * 0.96;
  ctx.fillStyle = PAPER_BRUSH;
  ctx.beginPath();
  const steps = 160;
  for (let i = 0; i <= steps; i += 1) {
    const f = (i / steps) * coreEnd;
    const taper = f > 0.62 ? 1 - (f - 0.62) / 0.4 : 1;
    const [x, y] = point(f, 0.36 * taper);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  for (let i = steps; i >= 0; i -= 1) {
    const f = (i / steps) * coreEnd;
    const taper = f > 0.62 ? 1 - (f - 0.62) / 0.4 : 1;
    const [x, y] = point(f, -0.34 * taper);
    ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  // Bristles give the dry-brush texture and the frayed tail.
  ctx.strokeStyle = PAPER_BRUSH;
  const bristles = 52;
  for (let k = 0; k < bristles; k += 1) {
    const off = k / (bristles - 1) - 0.5;
    const reach = clamp(0.66 + rand() * 0.34 * (1 - Math.abs(off) * 0.9) + (Math.abs(off) < 0.2 ? 0.1 : 0), 0, 1);
    const end = Math.min(reach, p);
    const begin = rand() * 0.025;
    if (end <= begin) continue;
    const lineWidth = 1 + rand() * 2.6;
    const base = 0.45 + rand() * 0.5;
    const phase = rand() * 20;
    const freq = 24 + rand() * 40;
    ctx.lineWidth = lineWidth;
    const segment = 0.012;
    for (let f = begin; f < end; f += segment) {
      const f2 = Math.min(end, f + segment);
      const dry = Math.sin(f * freq + phase) > (f > 0.55 ? -0.1 : -0.75) ? 1 : 0.18;
      const fade = f > reach - 0.08 ? clamp((reach - f) / 0.08) : 1;
      ctx.globalAlpha = alpha * base * dry * fade;
      const [x1, y1] = point(f, off * 0.95, Math.sin(f * 9 + phase) * 1.2);
      const [x2, y2] = point(f2, off * 0.95, Math.sin(f2 * 9 + phase) * 1.2);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
  }
  ctx.restore();
}

export function drawSealDot(ctx, cx, cy, radius, stampP, alpha = 1) {
  if (stampP <= 0 || alpha <= 0) return;
  const angle = (-34 * Math.PI) / 180;
  const x = cx + Math.cos(angle) * radius * 1.02;
  const y = cy + Math.sin(angle) * radius * 1.02;
  const scale = lerp(2.4, 1, springOut(stampP));
  const dot = radius * 0.085 * scale;
  ctx.save();
  ctx.globalAlpha = alpha * clamp(stampP * 5);
  const glow = ctx.createRadialGradient(x, y, 0, x, y, dot * 7);
  glow.addColorStop(0, 'rgba(226,90,61,0.35)');
  glow.addColorStop(1, 'rgba(226,90,61,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(x - dot * 7, y - dot * 7, dot * 14, dot * 14);
  ctx.fillStyle = ZHU;
  ctx.beginPath();
  ctx.arc(x, y, dot, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** A drop falling onto paper, then concentric ripples. */
export function drawDrop(ctx, cx, cy, t, fallStart, impact) {
  const fall = progress(t, fallStart, impact - fallStart);
  if (fall > 0 && fall < 1) {
    const y = lerp(-60, cy, easeIn(fall));
    const stretch = 1 + fall * 1.2;
    ctx.save();
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.ellipse(cx, y, 9, 9 * stretch, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  for (let ring = 0; ring < 4; ring += 1) {
    const rp = progress(t, impact + ring * 0.16, 1.9);
    if (rp <= 0 || rp >= 1) continue;
    ctx.save();
    ctx.strokeStyle = INK;
    ctx.globalAlpha = (1 - rp) * 0.5;
    ctx.lineWidth = 2.2 * (1 - rp) + 0.4;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 30 + easeOut(rp) * 520, (30 + easeOut(rp) * 520) * 0.96, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

const MOTES = (() => {
  const rand = seededRandom(42);
  return Array.from({ length: 80 }, () => ({
    x: rand() * W,
    y: rand() * H,
    speed: 6 + rand() * 18,
    size: 0.6 + rand() * 1.8,
    phase: rand() * Math.PI * 2,
    sway: 10 + rand() * 30,
  }));
})();

export function drawAmbient(ctx, t, alpha) {
  if (alpha <= 0) return;
  ctx.save();
  // Lamp glow drifting slowly across the desk.
  const gx = W * (0.5 + 0.28 * Math.sin(t * 0.05));
  const gy = H * (0.42 + 0.12 * Math.cos(t * 0.07));
  const glow = ctx.createRadialGradient(gx, gy, 0, gx, gy, 900);
  glow.addColorStop(0, `rgba(${LAMP},${0.075 * alpha})`);
  glow.addColorStop(1, `rgba(${LAMP},0)`);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  for (const mote of MOTES) {
    const y = (((mote.y - t * mote.speed) % H) + H) % H;
    const x = mote.x + Math.sin(t * 0.3 + mote.phase) * mote.sway;
    const twinkle = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(t * 1.3 + mote.phase * 3));
    ctx.globalAlpha = alpha * twinkle * 0.5;
    ctx.fillStyle = `rgb(${LAMP})`;
    ctx.beginPath();
    ctx.arc(x, y, mote.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Vermilion dry-brush stroke that sweeps across the frame as a page turn. */
export function drawPageStroke(ctx, t, at, seed) {
  const local = t - at;
  if (local < -0.35 || local > 0.9) return;
  const head = easeInOut(clamp((local + 0.35) / 0.7));
  const tail = easeInOut(clamp((local - 0.05) / 0.8));
  const rand = seededRandom(seed);
  const baseY = 540 + (rand() - 0.5) * 160;
  const tilt = (rand() - 0.5) * 0.12;
  const x0 = lerp(-120, W + 120, tail);
  const x1 = lerp(-120, W + 120, head);
  if (x1 <= x0) return;
  ctx.save();
  ctx.strokeStyle = ZHU;
  ctx.lineCap = 'round';
  for (let k = 0; k < 26; k += 1) {
    const off = (k / 25 - 0.5) * 30;
    const phase = rand() * 10;
    ctx.lineWidth = 0.8 + rand() * 2.4;
    ctx.globalAlpha = 0.25 + rand() * 0.55;
    ctx.beginPath();
    for (let x = x0; x <= x1; x += 24) {
      const y = baseY + off * (1 - 0.3 * Math.abs((x - W / 2) / W)) + (x - W / 2) * tilt + Math.sin(x * 0.004 + phase) * 6;
      if (x === x0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

export const COLORS = { INK, PAPER };
