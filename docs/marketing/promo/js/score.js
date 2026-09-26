// Fully synthesized soundtrack: guqin-like Karplus–Strong plucks over a pentatonic
// pad, taiko/woodblock groove, and Foley (ink drop, brush, seal stamp, page turns).
// The same event list drives real-time playback and OfflineAudioContext export.
import { BAR, BEAT, DURATION, seededRandom } from './timeline.js';

const midiHz = (midi) => 440 * 2 ** ((midi - 69) / 12);
// A minor pentatonic (羽调式): A C D E G.
const SCALE = [45, 48, 50, 52, 55, 57, 60, 62, 64, 67, 69, 72, 74, 76, 79, 81];

const MOTIFS = {
  rise: [[0, 5, 1], [1, 4, 0.5], [1.5, 3, 0.5], [2, 2, 1.5], [4, 3, 1], [5, 5, 0.5], [5.5, 6, 0.5], [6, 5, 2]],
  fall: [[0, 7, 1.5], [1.5, 6, 0.5], [2, 5, 1], [3, 3, 1], [4, 4, 0.75], [4.75, 3, 0.25], [5, 2, 1], [6, 0, 2]],
  dance: [[0, 3, 0.5], [0.5, 5, 0.5], [1, 6, 1], [2, 7, 0.5], [2.5, 8, 0.5], [3, 7, 1], [4, 6, 1], [5, 5, 0.5], [5.5, 4, 0.5], [6, 5, 2]],
  calm: [[0, 5, 2], [3, 4, 1], [4, 3, 3], [7, 2, 1]],
  answer: [[0, 8, 0.5], [0.5, 7, 0.5], [1, 5, 1], [2.5, 6, 0.5], [3, 5, 1], [4, 3, 0.5], [4.5, 4, 0.5], [5, 5, 3]],
};

// Chord per 2 bars: Am7, Fmaj7, C, G6sus — voiced around the pad register.
const CHORDS = [
  { root: 45, pad: [57, 60, 64, 67] },
  { root: 41, pad: [57, 60, 64, 65] },
  { root: 48, pad: [55, 60, 64, 67] },
  { root: 43, pad: [55, 60, 62, 64] },
];

export function buildEvents() {
  const events = [];
  const add = (t, type, params = {}) => events.push({ t, type, ...params });
  const rand = seededRandom(1234);

  // ── Foley ──
  add(0, 'wind', { dur: 5.5, vel: 0.9 });
  add(1.6, 'drop', { vel: 1 });
  add(1.78, 'drop', { vel: 0.35, pitch: 0.72 });
  add(1.62, 'swell', { dur: 2.6, vel: 0.55 });
  add(3.6, 'brush', { dur: 2.5, vel: 1 });
  add(6.2, 'stamp', { vel: 1 });
  add(6.2, 'gong', { vel: 0.9 });
  add(7.5, 'shimmer', { vel: 0.5 });

  [22.4, 28.8, 35.2, 41.6, 48, 54.4, 60.8, 86.4].forEach((at) => {
    add(at - 0.35, 'whoosh', { dur: 1.1, vel: 0.8 });
    add(at - 0.3, 'brush', { dur: 0.75, vel: 0.5 });
  });
  for (let i = 0; i < 7; i += 1) add(22.4 + i * 6.4 + 0.3, 'stamp', { vel: 0.55 });

  // host scene: cards land, links connect
  [13.9, 14.1, 14.3, 14.5].forEach((at) => add(at, 'tick', { vel: 0.4 }));
  add(14.0, 'pop', { vel: 0.6 });
  add(16.0, 'chime', { midi: 81, vel: 0.35 });
  // f1 extension install
  add(22.4 + 1.55, 'click', { vel: 0.9 });
  add(22.4 + 2.9, 'chime', { midi: 84, vel: 0.5 });
  add(22.4 + 4.3, 'chime', { midi: 88, vel: 0.35 });
  // f2 orchestration
  [1.3, 1.4, 1.5].forEach((d, i) => add(28.8 + d, 'wood', { vel: 0.45, pitch: 1 + i * 0.12 }));
  add(28.8 + 2.1, 'chime', { midi: 81, vel: 0.35 });
  add(28.8 + 2.7, 'click', { vel: 0.6 });
  add(28.8 + 3.1, 'blip', { vel: 0.5, midi: 76 });
  add(28.8 + 3.6, 'blip', { vel: 0.5, midi: 72 });
  add(28.8 + 4.3, 'click', { vel: 0.6 });
  add(28.8 + 5.3, 'stamp', { vel: 0.8 });
  // f3 voice
  add(35.2 + 2.8, 'chime', { midi: 79, vel: 0.4 });
  add(35.2 + 5.2, 'chime', { midi: 84, vel: 0.5 });
  // f4 model rows
  for (let i = 0; i < 8; i += 1) add(41.6 + 0.6 + i * 0.32 + 0.85, 'tick', { vel: 0.5, pitch: 1 + i * 0.04 });
  // f5 web search typing
  for (let k = 0; k < 18; k += 1) add(48 + 0.6 + k * 0.072 + rand() * 0.02, 'key', { vel: 0.5 + rand() * 0.3 });
  [2.1, 2.35, 2.6].forEach((d) => add(48 + d, 'tick', { vel: 0.35 }));
  add(48 + 3.8, 'click', { vel: 0.7 });
  add(48 + 4.3, 'whoosh', { dur: 0.5, vel: 0.3 });
  // f6 vision scan
  add(54.4 + 0.9, 'scan', { dur: 1.4, vel: 0.6 });
  add(54.4 + 4.6, 'chime', { midi: 84, vel: 0.45 });
  // f7 code search rush
  add(60.8 + 0.4, 'rush', { dur: 2.2, vel: 0.5 });
  [2.6, 2.9, 3.2].forEach((d, i) => add(60.8 + d, 'blip', { vel: 0.5, midi: 76 + i * 3 }));

  // steps (paper)
  add(66.9, 'swell', { dur: 1.4, vel: 0.5 });
  add(67.2 + 2.5, 'pop', { vel: 0.7 });
  for (let i = 0; i < 6; i += 1) add(67.2 + 3.9 + i * 0.2, 'blip', { vel: 0.35, midi: SCALE[8 + i] ?? 76 });
  for (let k = 0; k < 16; k += 1) add(67.2 + 6.5 + k * 0.075 + rand() * 0.02, 'key', { vel: 0.45 + rand() * 0.3 });
  add(67.2 + 8.0, 'click', { vel: 0.9 });
  add(76.4, 'drop', { vel: 0.7, pitch: 0.8 });
  add(76.45, 'swell', { dur: 1.6, vel: 0.5 });

  // demo transcript
  [1.9, 2.25, 2.55, 2.85, 3.35].forEach((d) => add(76.8 + d, 'tick', { vel: 0.35 }));
  add(76.8 + 4.5, 'blip', { vel: 0.45, midi: 69 });
  add(76.8 + 5.6, 'stamp', { vel: 1 });
  add(76.8 + 7.0, 'chime', { midi: 84, vel: 0.45 });

  // gallery + finale
  [0.6, 1.3, 1.6, 1.9, 2.2].forEach((d) => add(86.4 + d, 'whoosh', { dur: 0.6, vel: 0.25 }));
  add(94.4, 'riser', { dur: 1.6, vel: 0.6 });
  add(96.6, 'brush', { dur: 2.3, vel: 0.9 });
  add(99.2, 'stamp', { vel: 1 });
  add(99.2, 'gong', { vel: 1 });

  // ── Music ──
  add(3.6, 'pad', { dur: 9.4, notes: [45, 52, 57], vel: 0.8 });
  add(3.6, 'bass', { midi: 33, vel: 0.5, dur: 6 });
  phrase(add, 6.8, 'calm', 0, 0.55);
  phrase(add, 6.8 + BAR * 2, 'answer', 0, 0.45, 0.6);

  for (let t = 12.8, i = 0; t < 96; t += BAR * 2, i += 1) {
    const chord = CHORDS[i % CHORDS.length] ?? CHORDS[0];
    const inSteps = t >= 67.2 && t < 76.8;
    add(t, 'pad', { dur: BAR * 2 + 0.4, notes: inSteps ? chord.pad.map((n) => n + 12) : chord.pad, vel: inSteps ? 0.55 : 0.75 });
    const groove = (t >= 22.4 && t < 67.2) || (t >= 76.8 && t < 96);
    for (let b = 0; b < 2; b += 1) {
      const bar = t + b * BAR;
      if (bar >= 96) break;
      add(bar, 'bass', { midi: chord.root - 12 + (groove ? 12 : 0), vel: groove ? 0.8 : 0.45, dur: 1.6 });
      if (groove) {
        add(bar + BEAT * 2.5, 'bass', { midi: chord.root + 7, vel: 0.45, dur: 0.6 });
        drumBar(add, bar, rand);
      } else if (inSteps) {
        lightBar(add, bar, rand);
      } else if (t >= 12.8) {
        for (let s = 0; s < 4; s += 1) add(bar + s * BEAT + BEAT / 2, 'shaker', { vel: 0.18 });
      }
    }
  }

  const melodyPlan = [
    [12.8, 'rise', 0, 0.5], [19.2, 'calm', 0, 0.45],
    [22.4, 'rise', 0, 0.6], [28.8, 'dance', 0, 0.55], [35.2, 'fall', 0, 0.6], [41.6, 'dance', 0, 0.55],
    [48, 'answer', 0, 0.6], [54.4, 'rise', 12, 0.45], [60.8, 'fall', 0, 0.6],
    [67.2, 'calm', 12, 0.45], [70.4, 'answer', 12, 0.4], [73.6, 'rise', 12, 0.4],
    [76.8, 'dance', 0, 0.55], [83.2, 'fall', 0, 0.55],
    [86.4, 'rise', 0, 0.6], [92.8, 'answer', 0, 0.6],
  ];
  for (const [at, name, shift, vel] of melodyPlan) phrase(add, at, name, shift, vel);
  // bell counter-line in the gallery build-up
  for (let k = 0; k < 24; k += 1) {
    const chord = CHORDS[Math.floor((86.4 + k * BEAT / 2 - 12.8) / (BAR * 2)) % CHORDS.length] ?? CHORDS[0];
    const note = (chord.pad[k % 4] ?? 60) + 24;
    add(86.4 + k * (BEAT / 2) + BAR, 'bell', { midi: note, vel: 0.12 + (k / 24) * 0.12, dur: 1.4 });
  }
  // drum fill into the finale
  for (let k = 0; k < 8; k += 1) add(94.4 + k * 0.2, 'taiko', { vel: 0.35 + k * 0.08, pitch: 1.1 + k * 0.05 });

  // Finale: resolve on A.
  add(99.2, 'pad', { dur: 9.5, notes: [45, 52, 57, 60, 64], vel: 0.9 });
  add(99.2, 'bass', { midi: 33, vel: 0.8, dur: 6 });
  add(99.2, 'taiko', { vel: 1, pitch: 0.8 });
  [[99.25, 57], [99.45, 64], [99.65, 69], [99.9, 72], [100.3, 76], [101.1, 81]].forEach(([at, midi]) => add(at, 'pluck', { midi, vel: 0.55, slide: midi === 81 }));
  add(101.1, 'bell', { midi: 93, vel: 0.25, dur: 5 });
  phrase(add, 102.4, 'calm', 0, 0.4, 0.5);

  return events.filter((event) => event.t < DURATION).sort((a, b) => a.t - b.t);
}

function phrase(add, at, name, shift, vel, stretch = 1) {
  for (const [beat, degree, len] of MOTIFS[name] ?? []) {
    const midi = (SCALE[degree] ?? 57) + shift;
    add(at + beat * BEAT * stretch, 'pluck', { midi, vel, len: len * BEAT, slide: len >= 1.5, vib: len >= 2 });
  }
}

function drumBar(add, bar, rand) {
  add(bar, 'taiko', { vel: 0.85, pitch: 1 });
  add(bar + BEAT * 2, 'taiko', { vel: 0.45, pitch: 0.9 });
  add(bar + BEAT * 3.5, 'taiko', { vel: 0.3, pitch: 1.15 });
  add(bar + BEAT * 1.5, 'wood', { vel: 0.35, pitch: 1 });
  add(bar + BEAT * 3, 'wood', { vel: 0.3, pitch: 1.25 });
  for (let e = 0; e < 8; e += 1) add(bar + e * (BEAT / 2), 'shaker', { vel: e % 2 ? 0.16 : 0.26 + rand() * 0.05 });
}

function lightBar(add, bar, rand) {
  add(bar + BEAT, 'wood', { vel: 0.25, pitch: 1.1 });
  add(bar + BEAT * 3, 'wood', { vel: 0.2, pitch: 1.3 });
  for (let e = 0; e < 4; e += 1) add(bar + e * BEAT + BEAT / 2, 'shaker', { vel: 0.12 + rand() * 0.04 });
}

// ── synthesis engine ───────────────────────────────────────

const bufferCache = new Map();

function cached(key, make) {
  let value = bufferCache.get(key);
  if (!value) {
    value = make();
    bufferCache.set(key, value);
  }
  return value;
}

function noiseBuffer(sampleRate) {
  return cached(`noise:${sampleRate}`, () => {
    const rand = seededRandom(77);
    const buffer = new AudioBuffer({ length: sampleRate * 3, sampleRate, numberOfChannels: 1 });
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = rand() * 2 - 1;
    return buffer;
  });
}

function impulseResponse(sampleRate) {
  return cached(`ir:${sampleRate}`, () => {
    const seconds = 3.4;
    const length = Math.floor(sampleRate * seconds);
    const buffer = new AudioBuffer({ length, sampleRate, numberOfChannels: 2 });
    for (let ch = 0; ch < 2; ch += 1) {
      const rand = seededRandom(900 + ch);
      const data = buffer.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < length; i += 1) {
        const decay = Math.pow(1 - i / length, 2.6);
        lp += 0.35 * ((rand() * 2 - 1) - lp); // darker tail
        data[i] = lp * decay * (i < sampleRate * 0.012 ? i / (sampleRate * 0.012) : 1);
      }
    }
    return buffer;
  });
}

/** Karplus–Strong string, excited by soft low-passed noise for a guqin-ish body. */
function pluckBuffer(sampleRate, midi) {
  return cached(`ks:${sampleRate}:${midi}`, () => {
    const freq = midiHz(midi);
    const period = Math.max(2, Math.round(sampleRate / freq));
    const length = Math.floor(sampleRate * 3.4);
    const buffer = new AudioBuffer({ length, sampleRate, numberOfChannels: 1 });
    const data = buffer.getChannelData(0);
    const rand = seededRandom(midi * 131);
    let lp = 0;
    for (let i = 0; i < period; i += 1) {
      lp += 0.42 * ((rand() * 2 - 1) - lp);
      data[i] = lp;
    }
    const decay = 0.9972 - Math.max(0, midi - 50) * 0.00009;
    for (let i = period; i < length; i += 1) {
      data[i] = decay * 0.5 * ((data[i - period] ?? 0) + (data[i - period - 1] ?? 0));
    }
    let peak = 0;
    for (let i = 0; i < length; i += 1) peak = Math.max(peak, Math.abs(data[i] ?? 0));
    const norm = peak > 0 ? 0.85 / peak : 1;
    for (let i = 0; i < length; i += 1) data[i] = (data[i] ?? 0) * norm;
    return { buffer, ratio: ((period + 0.5) * freq) / sampleRate };
  });
}

export function createEngine(ctx, destination) {
  const sr = ctx.sampleRate;
  const master = ctx.createGain();
  master.gain.value = 0.9;
  // Brick-wall-ish limiter after the glue compressor keeps stamp + gong hits off 0 dBFS.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -4;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.12;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value = 10;
  comp.ratio.value = 3;
  comp.attack.value = 0.008;
  comp.release.value = 0.3;
  comp.connect(master);
  master.connect(limiter);
  limiter.connect(destination);
  const dry = ctx.createGain();
  dry.connect(comp);
  const send = ctx.createGain();
  const verb = ctx.createConvolver();
  verb.buffer = impulseResponse(sr);
  const verbOut = ctx.createGain();
  verbOut.gain.value = 0.55;
  send.connect(verb);
  verb.connect(verbOut);
  verbOut.connect(comp);

  const gain = (value) => {
    const g = ctx.createGain();
    g.gain.value = value;
    return g;
  };
  const route = (node, dryLevel, wetLevel, pan = 0) => {
    let tail = node;
    if (pan !== 0) {
      const panner = ctx.createStereoPanner();
      panner.pan.value = pan;
      node.connect(panner);
      tail = panner;
    }
    const d = gain(dryLevel);
    const w = gain(wetLevel);
    tail.connect(d);
    tail.connect(w);
    d.connect(dry);
    w.connect(send);
  };
  const env = (param, when, peak, attack, decay, curve = 'exp') => {
    param.setValueAtTime(0.0001, when);
    param.linearRampToValueAtTime(peak, when + attack);
    if (curve === 'exp') param.exponentialRampToValueAtTime(0.0001, when + attack + decay);
    else param.linearRampToValueAtTime(0, when + attack + decay);
  };
  const noise = (when, dur, offset = 0) => {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(sr);
    src.loop = true;
    src.start(when, offset % 2.5);
    src.stop(when + dur + 0.05);
    return src;
  };
  const osc = (type, freq, when, dur) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, when);
    o.start(when);
    o.stop(when + dur + 0.05);
    return o;
  };

  const voices = {
    pluck(e, when) {
      const { buffer, ratio } = pluckBuffer(sr, e.midi);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.value = ratio;
      if (e.slide) {
        src.detune.setValueAtTime(-120, when);
        src.detune.linearRampToValueAtTime(0, when + 0.11);
      }
      if (e.vib) {
        const lfo = osc('sine', 5.2, when + 0.3, 2.6);
        const depth = ctx.createGain();
        depth.gain.setValueAtTime(0, when + 0.3);
        depth.gain.linearRampToValueAtTime(14, when + 0.9);
        lfo.connect(depth);
        depth.connect(src.detune);
      }
      const body = ctx.createBiquadFilter();
      body.type = 'peaking';
      body.frequency.value = 220;
      body.gain.value = 5;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 4200;
      const g = gain(e.vel * 0.6);
      src.connect(body);
      body.connect(lp);
      lp.connect(g);
      src.start(when);
      src.stop(when + 3.3);
      route(g, 0.85, 0.4, clampPan((e.midi - 64) / 30));
    },
    pad(e, when) {
      const out = ctx.createGain();
      const total = e.dur;
      out.gain.setValueAtTime(0.0001, when);
      out.gain.linearRampToValueAtTime(e.vel * 0.045, when + Math.min(1.6, total * 0.3));
      out.gain.setValueAtTime(e.vel * 0.045, when + total - 1.4);
      out.gain.linearRampToValueAtTime(0.0001, when + total);
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(500, when);
      filter.frequency.linearRampToValueAtTime(1100, when + total * 0.5);
      filter.frequency.linearRampToValueAtTime(600, when + total);
      filter.Q.value = 0.7;
      filter.connect(out);
      for (const midi of e.notes) {
        for (const detune of [-8, 7]) {
          const o = osc('sawtooth', midiHz(midi), when, total);
          o.detune.value = detune;
          const g = gain(0.5);
          o.connect(g);
          g.connect(filter);
        }
      }
      route(out, 0.6, 0.55);
    },
    bass(e, when) {
      const o = osc('triangle', midiHz(e.midi), when, e.dur + 0.4);
      const s = osc('sine', midiHz(e.midi), when, e.dur + 0.4);
      const g = ctx.createGain();
      env(g.gain, when, e.vel * 0.24, 0.012, e.dur);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 420;
      o.connect(lp);
      s.connect(lp);
      lp.connect(g);
      route(g, 1, 0.08);
    },
    taiko(e, when) {
      const pitch = e.pitch ?? 1;
      const o = osc('sine', 118 * pitch, when, 0.9);
      o.frequency.exponentialRampToValueAtTime(44 * pitch, when + 0.32);
      const g = ctx.createGain();
      env(g.gain, when, e.vel * 0.68, 0.004, 0.75);
      o.connect(g);
      const n = noise(when, 0.12, when * 3.1);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 700;
      const ng = ctx.createGain();
      env(ng.gain, when, e.vel * 0.35, 0.002, 0.09);
      n.connect(lp);
      lp.connect(ng);
      route(g, 1, 0.22);
      route(ng, 1, 0.2);
    },
    wood(e, when) {
      const pitch = e.pitch ?? 1;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1100 * pitch;
      bp.Q.value = 6;
      const g = ctx.createGain();
      env(g.gain, when, e.vel * 0.7, 0.002, 0.08);
      for (const ratio of [1, 1.72]) {
        const o = osc('sine', 1050 * pitch * ratio, when, 0.12);
        o.connect(bp);
      }
      bp.connect(g);
      route(g, 0.8, 0.3, pitch > 1.1 ? 0.3 : -0.25);
    },
    shaker(e, when) {
      const n = noise(when, 0.09, when * 7.3);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 7000;
      const g = ctx.createGain();
      env(g.gain, when, e.vel * 0.28, 0.006, 0.06);
      n.connect(hp);
      hp.connect(g);
      route(g, 0.7, 0.15, Math.sin(when * 5) * 0.4);
    },
    bell(e, when) {
      const f = midiHz(e.midi);
      const dur = e.dur ?? 2.5;
      const carrier = osc('sine', f, when, dur);
      const mod = osc('sine', f * 3.5, when, dur);
      const index = ctx.createGain();
      index.gain.setValueAtTime(f * 2.2, when);
      index.gain.exponentialRampToValueAtTime(f * 0.05, when + dur);
      mod.connect(index);
      index.connect(carrier.frequency);
      const g = ctx.createGain();
      env(g.gain, when, e.vel * 0.3, 0.003, dur);
      carrier.connect(g);
      route(g, 0.6, 0.6, clampPan((e.midi - 80) / 20));
    },
    chime(e, when) {
      voices.bell({ midi: e.midi, vel: e.vel, dur: 2.2 }, when);
      voices.bell({ midi: e.midi + 7, vel: e.vel * 0.6, dur: 1.8 }, when + 0.07);
    },
    blip(e, when) {
      voices.bell({ midi: e.midi, vel: e.vel * 0.8, dur: 0.6 }, when);
    },
    gong(e, when) {
      const partials = [[1, 6.5], [1.47, 5], [2.09, 4.2], [2.56, 3.4], [3.14, 2.6], [4.1, 1.8]];
      const g = gain(e.vel * 0.16);
      partials.forEach(([ratio, decay], index) => {
        const o = osc('sine', 68 * ratio, when, decay);
        o.frequency.linearRampToValueAtTime(68 * ratio * 0.985, when + decay);
        const pg = ctx.createGain();
        env(pg.gain, when + index * 0.01, 1 / (index + 1.3), 0.02, decay);
        o.connect(pg);
        pg.connect(g);
      });
      const n = noise(when, 3, 1.1);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 900;
      const ng = ctx.createGain();
      env(ng.gain, when, e.vel * 0.05, 0.25, 2.6);
      n.connect(lp);
      lp.connect(ng);
      route(g, 0.8, 0.7);
      route(ng, 0.5, 0.8);
    },
    drop(e, when) {
      const pitch = e.pitch ?? 1;
      const o = osc('sine', 650 * pitch, when, 0.2);
      o.frequency.exponentialRampToValueAtTime(1900 * pitch, when + 0.055);
      const g = ctx.createGain();
      env(g.gain, when, e.vel * 0.55, 0.003, 0.13);
      o.connect(g);
      const thud = osc('sine', 160 * pitch, when, 0.25);
      thud.frequency.exponentialRampToValueAtTime(70, when + 0.2);
      const tg = ctx.createGain();
      env(tg.gain, when, e.vel * 0.4, 0.002, 0.2);
      thud.connect(tg);
      route(g, 0.7, 0.8);
      route(tg, 0.9, 0.4);
    },
    stamp(e, when) {
      const o = osc('sine', 96, when, 0.4);
      o.frequency.exponentialRampToValueAtTime(48, when + 0.16);
      const g = ctx.createGain();
      env(g.gain, when, e.vel * 0.7, 0.002, 0.3);
      o.connect(g);
      const n = noise(when, 0.08, 0.7);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1500;
      const ng = ctx.createGain();
      env(ng.gain, when, e.vel * 0.5, 0.001, 0.06);
      n.connect(lp);
      lp.connect(ng);
      voices.wood({ vel: e.vel * 0.5, pitch: 0.48 }, when + 0.004);
      route(g, 1, 0.25);
      route(ng, 1, 0.2);
    },
    brush(e, when) {
      const n = noise(when, e.dur, when * 1.7);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 0.9;
      bp.frequency.setValueAtTime(700, when);
      bp.frequency.linearRampToValueAtTime(2600, when + e.dur * 0.45);
      bp.frequency.linearRampToValueAtTime(1300, when + e.dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, when);
      g.gain.linearRampToValueAtTime(e.vel * 0.13, when + 0.12);
      g.gain.setValueAtTime(e.vel * 0.12, when + e.dur * 0.7);
      g.gain.linearRampToValueAtTime(0.0001, when + e.dur);
      const trem = osc('sine', 13, when, e.dur);
      const tremDepth = gain(e.vel * 0.04);
      trem.connect(tremDepth);
      tremDepth.connect(g.gain);
      n.connect(bp);
      bp.connect(g);
      route(g, 0.8, 0.3);
    },
    whoosh(e, when) {
      const n = noise(when, e.dur, when * 2.3);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 1.4;
      bp.frequency.setValueAtTime(300, when);
      bp.frequency.exponentialRampToValueAtTime(3200, when + e.dur * 0.55);
      bp.frequency.exponentialRampToValueAtTime(600, when + e.dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, when);
      g.gain.linearRampToValueAtTime(e.vel * 0.3, when + e.dur * 0.5);
      g.gain.linearRampToValueAtTime(0.0001, when + e.dur);
      n.connect(bp);
      bp.connect(g);
      route(g, 0.7, 0.45, 0);
    },
    swell(e, when) {
      const n = noise(when, e.dur, when * 4.1);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(200, when);
      lp.frequency.linearRampToValueAtTime(900, when + e.dur * 0.5);
      lp.frequency.linearRampToValueAtTime(250, when + e.dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, when);
      g.gain.linearRampToValueAtTime(e.vel * 0.35, when + e.dur * 0.4);
      g.gain.linearRampToValueAtTime(0.0001, when + e.dur);
      n.connect(lp);
      lp.connect(g);
      route(g, 0.7, 0.6);
    },
    wind(e, when) {
      const n = noise(when, e.dur, 0.2);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 0.6;
      bp.frequency.setValueAtTime(400, when);
      bp.frequency.linearRampToValueAtTime(700, when + e.dur * 0.5);
      bp.frequency.linearRampToValueAtTime(350, when + e.dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, when);
      g.gain.linearRampToValueAtTime(e.vel * 0.05, when + 1.2);
      g.gain.linearRampToValueAtTime(0.0001, when + e.dur);
      n.connect(bp);
      bp.connect(g);
      route(g, 0.6, 0.5);
    },
    shimmer(e, when) {
      [81, 84, 88, 91, 93].forEach((midi, index) => voices.bell({ midi, vel: e.vel * 0.45, dur: 2.4 }, when + index * 0.09));
    },
    click(e, when) {
      const n = noise(when, 0.03, 0.4);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 2500;
      const g = ctx.createGain();
      env(g.gain, when, e.vel * 0.45, 0.001, 0.025);
      n.connect(hp);
      hp.connect(g);
      const o = osc('sine', 1800, when, 0.05);
      const og = ctx.createGain();
      env(og.gain, when, e.vel * 0.2, 0.001, 0.035);
      o.connect(og);
      route(g, 1, 0.1);
      route(og, 1, 0.1);
    },
    key(e, when) {
      const n = noise(when, 0.03, when * 9.7);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 3200 + (when * 997) % 900;
      bp.Q.value = 2.5;
      const g = ctx.createGain();
      env(g.gain, when, e.vel * 0.35, 0.001, 0.025);
      n.connect(bp);
      bp.connect(g);
      route(g, 1, 0.08, ((when * 13) % 1) - 0.5);
    },
    tick(e, when) {
      voices.wood({ vel: e.vel * 0.6, pitch: 1.9 * (e.pitch ?? 1) }, when);
    },
    pop(e, when) {
      const o = osc('sine', 300, when, 0.15);
      o.frequency.exponentialRampToValueAtTime(900, when + 0.08);
      const g = ctx.createGain();
      env(g.gain, when, e.vel * 0.4, 0.004, 0.1);
      o.connect(g);
      route(g, 0.9, 0.3);
    },
    scan(e, when) {
      const n = noise(when, e.dur, 1.9);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 8;
      bp.frequency.setValueAtTime(1500, when);
      bp.frequency.exponentialRampToValueAtTime(5200, when + e.dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, when);
      g.gain.linearRampToValueAtTime(e.vel * 0.3, when + 0.1);
      g.gain.linearRampToValueAtTime(0.0001, when + e.dur);
      n.connect(bp);
      bp.connect(g);
      route(g, 0.7, 0.4);
    },
    rush(e, when) {
      const n = noise(when, e.dur, 2.2);
      const hp = ctx.createBiquadFilter();
      hp.type = 'bandpass';
      hp.Q.value = 0.8;
      hp.frequency.value = 2400;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, when);
      g.gain.linearRampToValueAtTime(e.vel * 0.12, when + 0.3);
      g.gain.linearRampToValueAtTime(0.0001, when + e.dur);
      const trem = osc('square', 18, when, e.dur);
      const depth = gain(e.vel * 0.05);
      trem.connect(depth);
      depth.connect(g.gain);
      n.connect(hp);
      hp.connect(g);
      route(g, 0.8, 0.2);
    },
    riser(e, when) {
      const n = noise(when, e.dur, 0.9);
      const hp = ctx.createBiquadFilter();
      hp.type = 'bandpass';
      hp.Q.value = 2;
      hp.frequency.setValueAtTime(400, when);
      hp.frequency.exponentialRampToValueAtTime(6000, when + e.dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(e.vel * 0.3, when + e.dur);
      g.gain.linearRampToValueAtTime(0.0001, when + e.dur + 0.05);
      n.connect(hp);
      hp.connect(g);
      route(g, 0.7, 0.4);
    },
  };

  return {
    master,
    play(event, when) {
      const voice = voices[event.type];
      if (voice) voice(event, when);
    },
    dispose() {
      master.disconnect();
    },
  };
}

function clampPan(value) {
  return Math.max(-0.6, Math.min(0.6, value));
}

/** Longest sustaining event — used to resume pads that started before a seek point. */
export const eventLength = (event) => event.dur ?? (event.type === 'gong' ? 6 : event.type === 'pluck' ? 3 : 1);
