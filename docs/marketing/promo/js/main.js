// Player: one clock (AudioContext time when available), scene activation,
// transport controls, and a deterministic export API for frame capture.
import { buildEvents, createEngine, eventLength } from './score.js';
import { blackoutAlpha, buildDynamicDom, createCustomUpdaters, renderBackground, renderFx, sceneFade } from './scenes.js';
import { DURATION, SCENES, applyAnimated, clamp, collectAnimated } from './timeline.js';

const exportMode = new URLSearchParams(location.search).has('export');
if (exportMode) document.body.classList.add('export');

const stage = document.getElementById('stage');
const bg = document.getElementById('bg').getContext('2d');
const fx = document.getElementById('fx').getContext('2d');
const blackout = document.getElementById('blackout');

buildDynamicDom(document);
const custom = createCustomUpdaters(document);
const scenes = SCENES.map((scene) => {
  const root = document.getElementById(`s-${scene.id}`);
  return { ...scene, root, items: root ? collectAnimated(root) : [] };
});

function renderFrame(t) {
  renderBackground(bg, t);
  renderFx(fx, t);
  custom.global(t);
  for (const scene of scenes) {
    if (!scene.root) continue;
    const active = t >= scene.start - 0.05 && t <= scene.end + 0.05;
    scene.root.style.visibility = active ? 'visible' : 'hidden';
    if (!active) continue;
    const lt = t - scene.start;
    scene.root.style.opacity = String(sceneFade(t, scene));
    applyAnimated(scene.items, lt);
    const update = custom[scene.id];
    if (update) update(lt, scene.root);
  }
  blackout.style.opacity = String(blackoutAlpha(t));
}

// ── layout ─────────────────────────────────────────────────
function fit() {
  const scale = Math.min(innerWidth / 1920, innerHeight / 1080);
  const x = (innerWidth - 1920 * scale) / 2;
  const y = (innerHeight - 1080 * scale) / 2;
  stage.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
}
addEventListener('resize', fit);
fit();

// ── transport ──────────────────────────────────────────────
const events = buildEvents();
let audio = null;
let engine = null;
let playing = false;
let muted = false;
let originCtx = 0; // ctx time corresponding to origin
let originT = 0;
let cursor = 0; // index of next event to schedule
let current = 0;
let fallbackStart = 0;

function now() {
  if (!playing) return current;
  if (audio) return originT + (audio.currentTime - originCtx);
  return originT + (performance.now() - fallbackStart) / 1000;
}

function ensureAudio() {
  if (audio) return;
  const Ctor = window.AudioContext ?? window.webkitAudioContext;
  if (!Ctor) return;
  audio = new Ctor({ latencyHint: 'playback' });
}

function startEngine(from) {
  engine?.dispose();
  engine = null;
  if (!audio) return;
  engine = createEngine(audio, audio.destination);
  engine.master.gain.value = muted ? 0 : 0.9;
  originCtx = audio.currentTime + 0.06;
  originT = from;
  cursor = events.findIndex((event) => event.t >= from);
  if (cursor < 0) cursor = events.length;
  // Resume sustained sounds (pads, bass, gong tails) that began before the seek point.
  for (const event of events) {
    if (event.t >= from) break;
    const remaining = event.t + eventLength(event) - from;
    if (remaining > 0.6 && (event.type === 'pad' || event.type === 'bass')) {
      engine.play({ ...event, dur: remaining }, originCtx);
    }
  }
}

function pump() {
  if (!engine || !audio) return;
  const horizon = now() + 0.6;
  while (cursor < events.length && (events[cursor]?.t ?? Infinity) < horizon) {
    const event = events[cursor];
    cursor += 1;
    if (!event) continue;
    engine.play(event, Math.max(audio.currentTime, originCtx + (event.t - originT)));
  }
}

function play(from = current) {
  ensureAudio();
  if (from >= DURATION - 0.05) from = 0;
  playing = true;
  current = from;
  fallbackStart = performance.now();
  originT = from;
  if (audio) {
    void audio.resume().then(() => startEngine(from));
    originCtx = audio.currentTime + 0.06;
  }
  updateButtons();
}

function pause() {
  current = now();
  playing = false;
  engine?.dispose();
  engine = null;
  updateButtons();
}

function seek(t) {
  const target = clamp(t, 0, DURATION);
  if (playing) {
    current = target;
    play(target);
  } else {
    current = target;
    renderFrame(current);
  }
}

function loop() {
  if (playing) {
    pump();
    current = now();
    if (current >= DURATION) {
      current = DURATION;
      pause();
    }
    renderFrame(current);
  }
  updateScrub();
  requestAnimationFrame(loop);
}

// ── controls UI ────────────────────────────────────────────
const controls = document.getElementById('controls');
const scrub = document.getElementById('scrub');
const fill = scrub.querySelector('.fill');
const tip = scrub.querySelector('.tip');
const timeLabel = document.getElementById('time');
const btnPlay = document.getElementById('btn-play');
const btnMute = document.getElementById('btn-mute');

for (const scene of SCENES) {
  const tick = document.createElement('i');
  tick.className = 'tick';
  tick.style.left = `${(scene.start / DURATION) * 100}%`;
  scrub.appendChild(tick);
}

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function updateScrub() {
  fill.style.width = `${(current / DURATION) * 100}%`;
  timeLabel.textContent = `${fmt(current)} / ${fmt(DURATION)}`;
}

function updateButtons() {
  btnPlay.querySelector('use').setAttribute('href', playing ? '#i-pause' : '#i-play');
  btnMute.querySelector('use').setAttribute('href', muted ? '#i-mute' : '#i-sound');
}

const scrubTime = (event) => {
  const rect = scrub.getBoundingClientRect();
  return clamp((event.clientX - rect.left) / rect.width) * DURATION;
};
scrub.addEventListener('pointermove', (event) => {
  const t = scrubTime(event);
  const scene = [...SCENES].reverse().find((s) => t >= s.start);
  tip.textContent = `${fmt(t)} · ${scene?.label ?? ''}`;
  tip.style.left = `${(t / DURATION) * 100}%`;
});
scrub.addEventListener('click', (event) => seek(scrubTime(event)));
btnPlay.addEventListener('click', () => (playing ? pause() : play()));
document.getElementById('btn-replay').addEventListener('click', () => play(0));
btnMute.addEventListener('click', toggleMute);
document.getElementById('btn-full').addEventListener('click', toggleFull);

function toggleMute() {
  muted = !muted;
  if (engine) engine.master.gain.value = muted ? 0 : 0.9;
  updateButtons();
}

function toggleFull() {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen();
}

addEventListener('keydown', (event) => {
  if (event.code === 'Space') {
    event.preventDefault();
    if (playing) pause();
    else play();
  } else if (event.code === 'ArrowRight') seek(now() + 5);
  else if (event.code === 'ArrowLeft') seek(now() - 5);
  else if (event.code === 'KeyM') toggleMute();
  else if (event.code === 'KeyF') toggleFull();
  else if (/^Digit[1-9]$/.test(event.code)) {
    const scene = SCENES[Number(event.code.slice(5)) - 1];
    if (scene) seek(scene.start);
  }
});

let idleTimer = 0;
addEventListener('pointermove', () => {
  controls.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = window.setTimeout(() => {
    if (playing) controls.classList.add('idle');
  }, 2200);
});

const gatekeeper = document.getElementById('gatekeeper');
gatekeeper.addEventListener('click', () => {
  gatekeeper.remove();
  controls.classList.remove('idle');
  play(Number(new URLSearchParams(location.search).get('t') ?? 0));
});

// ── export API (used by export.mjs) ────────────────────────
window.__promo = {
  duration: DURATION,
  async ready() {
    await document.fonts.ready;
    await Promise.all([...document.images].map((img) => img.decode().catch(() => undefined)));
  },
  frame(t) {
    current = t;
    renderFrame(t);
  },
  async renderAudio(sampleRate = 48000) {
    const length = Math.ceil((DURATION + 0.5) * sampleRate);
    const offline = new OfflineAudioContext({ numberOfChannels: 2, length, sampleRate });
    const offlineEngine = createEngine(offline, offline.destination);
    for (const event of events) offlineEngine.play(event, event.t);
    const buffer = await offline.startRendering();
    return encodeWavBase64(buffer);
  },
};

function encodeWavBase64(buffer) {
  const channels = buffer.numberOfChannels;
  const frames = buffer.length;
  const bytes = new DataView(new ArrayBuffer(44 + frames * channels * 2));
  const writeString = (offset, text) => [...text].forEach((ch, i) => bytes.setUint8(offset + i, ch.charCodeAt(0)));
  writeString(0, 'RIFF');
  bytes.setUint32(4, 36 + frames * channels * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  bytes.setUint32(16, 16, true);
  bytes.setUint16(20, 1, true);
  bytes.setUint16(22, channels, true);
  bytes.setUint32(24, buffer.sampleRate, true);
  bytes.setUint32(28, buffer.sampleRate * channels * 2, true);
  bytes.setUint16(32, channels * 2, true);
  bytes.setUint16(34, 16, true);
  writeString(36, 'data');
  bytes.setUint32(40, frames * channels * 2, true);
  const data = [...Array(channels)].map((_, ch) => buffer.getChannelData(ch));
  let offset = 44;
  for (let i = 0; i < frames; i += 1) {
    for (let ch = 0; ch < channels; ch += 1) {
      const sample = Math.max(-1, Math.min(1, data[ch]?.[i] ?? 0));
      bytes.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  const u8 = new Uint8Array(bytes.buffer);
  let binary = '';
  for (let i = 0; i < u8.length; i += 0x8000) binary += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(binary);
}

// First paint: lay out every scene once so web fonts load before playback.
for (const scene of scenes) if (scene.root) scene.root.style.visibility = 'visible';
requestAnimationFrame(() => {
  renderFrame(Number(new URLSearchParams(location.search).get('t') ?? 0));
  updateButtons();
  loop();
});
