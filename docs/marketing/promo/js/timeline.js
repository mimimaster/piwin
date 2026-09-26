// Shared clock, scene table and the declarative animator.
// Every visual is a pure function of global time `t` so the same page can
// play in real time and be stepped frame-by-frame for video export.

export const BEAT = 0.8; // 75 BPM
export const BAR = BEAT * 4;
export const DURATION = 110;

const FEATURE_LABELS = ['扩展热安装', '子代理编排', '全双工语音', '按能力配模型', 'Web Search', '视觉委托', 'code_search'];

export const SCENES = [
  { id: 'intro', start: 0, end: 12.8, label: '开场' },
  { id: 'host', start: 12.8, end: 22.4, label: '一处权威' },
  ...FEATURE_LABELS.map((label, index) => ({
    id: `f${index + 1}`,
    start: 22.4 + index * 6.4,
    end: 28.8 + index * 6.4,
    label,
  })),
  { id: 'steps', start: 67.2, end: 76.8, label: '三步上手' },
  { id: 'demo', start: 76.8, end: 86.4, label: '一次对话' },
  { id: 'gallery', start: 86.4, end: 96, label: '更多能力' },
  { id: 'finale', start: 96, end: DURATION, label: '尾声' },
];

export const FEATURE_START = 22.4;
export const FEATURE_END = 67.2;
export const FEATURE_SPAN = 6.4;

export const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
export const progress = (t, start, duration) => (duration <= 0 ? (t >= start ? 1 : 0) : clamp((t - start) / duration));
export const easeOut = (p) => 1 - Math.pow(1 - p, 3);
export const easeIn = (p) => p * p * p;
export const easeInOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
export const springOut = (p) => (p >= 1 ? 1 : 1 - Math.exp(-5.5 * p) * Math.cos(9 * p));
export const lerp = (a, b, p) => a + (b - a) * p;

/** Deterministic PRNG (mulberry32) — frames must be identical on every render. */
export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let x = state;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Collects `[data-in]` elements of a scene. Attributes (all times are local to the scene):
 *   data-in / data-dur   entrance start + duration
 *   data-fx              rise | fade | blur | stamp | pop | left | right | type | draw | grow | count
 *   data-out             local time the element fades away
 *   data-steps           "1.2:run,2.0:done" → sets data-s to the latest reached state
 */
export function collectAnimated(root) {
  const items = [];
  root.querySelectorAll('[data-in],[data-steps]').forEach((el) => {
    const fx = el.dataset.fx ?? 'rise';
    const item = {
      el,
      fx,
      at: Number(el.dataset.in ?? NaN),
      dur: Number(el.dataset.dur ?? defaultDuration(fx)),
      out: el.dataset.out === undefined ? null : Number(el.dataset.out),
      steps: parseSteps(el.dataset.steps),
      text: fx === 'type' ? el.textContent : null,
      lastText: null,
      lastState: null,
    };
    if (fx === 'type') el.textContent = '';
    items.push(item);
  });
  return items;
}

function defaultDuration(fx) {
  if (fx === 'stamp') return 0.45;
  if (fx === 'draw') return 0.9;
  if (fx === 'type') return 1.2;
  return 0.6;
}

function parseSteps(raw) {
  if (!raw) return null;
  return raw.split(',').map((pair) => {
    const [time, state] = pair.split(':');
    return { time: Number(time), state };
  });
}

export function applyAnimated(items, lt) {
  for (const item of items) {
    if (item.steps) applySteps(item, lt);
    if (Number.isNaN(item.at)) continue;
    const raw = progress(lt, item.at, item.dur);
    const outFade = item.out === null ? 1 : 1 - progress(lt, item.out, 0.45);
    applyEffect(item, raw, outFade);
  }
}

function applySteps(item, lt) {
  let state = '';
  for (const step of item.steps) if (lt >= step.time) state = step.state;
  if (state !== item.lastState) {
    item.lastState = state;
    item.el.dataset.s = state;
  }
}

function applyEffect(item, raw, outFade) {
  const { el, fx } = item;
  const style = el.style;
  const p = easeOut(raw);
  switch (fx) {
    case 'fade':
      style.opacity = String(p * outFade);
      break;
    case 'blur':
      style.opacity = String(p * outFade);
      style.filter = raw >= 1 ? '' : `blur(${(1 - p) * 18}px)`;
      style.transform = `scale(${lerp(1.06, 1, p)})`;
      break;
    case 'stamp': {
      const s = springOut(raw);
      style.opacity = String(clamp(raw * 4) * outFade);
      style.transform = `scale(${lerp(2.1, 1, s)}) rotate(${lerp(-9, -2, s)}deg)`;
      break;
    }
    case 'pop':
      style.opacity = String(clamp(raw * 3) * outFade);
      style.transform = `scale(${lerp(0.82, 1, springOut(raw))})`;
      break;
    case 'left':
    case 'right': {
      const dir = fx === 'left' ? -1 : 1;
      style.opacity = String(p * outFade);
      style.transform = `translateX(${dir * (1 - p) * 60}px)`;
      break;
    }
    case 'type': {
      const text = item.text ?? '';
      const count = Math.round(text.length * raw);
      style.opacity = String(raw > 0 ? outFade : 0);
      if (count !== item.lastText) {
        item.lastText = count;
        el.textContent = text.slice(0, count);
        el.classList.toggle('typing', raw > 0 && raw < 1);
      }
      break;
    }
    case 'draw':
      style.strokeDashoffset = String(1 - easeInOut(raw));
      style.opacity = String(raw > 0 ? outFade : 0);
      break;
    case 'grow':
      style.opacity = String(raw > 0 ? outFade : 0);
      style.transform = `scaleX(${easeInOut(raw)})`;
      break;
    case 'count': {
      const from = Number(el.dataset.from ?? 0);
      const to = Number(el.dataset.to ?? 0);
      const value = Math.round(lerp(from, to, easeInOut(raw)));
      const text = `${el.dataset.prefix ?? ''}${value.toLocaleString('en-US')}${el.dataset.suffix ?? ''}`;
      if (text !== item.lastText) {
        item.lastText = text;
        el.textContent = text;
      }
      style.opacity = String(outFade);
      break;
    }
    default: // rise
      style.opacity = String(p * outFade);
      style.transform = `translateY(${(1 - p) * 26}px)`;
      style.filter = raw >= 1 || raw <= 0 ? '' : `blur(${(1 - p) * 6}px)`;
  }
}
