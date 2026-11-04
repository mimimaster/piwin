<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

type MascotPose = 'idle' | 'coding' | 'thinking' | 'done' | 'alert' | 'sleep';

interface PoseMeta {
  id: MascotPose;
  label: string;
  tag: string;
  quote: string;
  frames: readonly string[];
  frameDurations: readonly number[];
}

const POSES: readonly PoseMeta[] = [
  {
    id: 'idle',
    label: '待命',
    tag: 'READY · >_',
    quote: '喵喵喵',
    frames: [
      '/mascot/pip-idle.webp',
      '/mascot/pip-idle-2.webp',
      '/mascot/pip-idle-3.webp',
      '/mascot/pip-idle-2.webp',
    ],
    frameDurations: [2200, 260, 900, 220],
  },
  {
    id: 'coding',
    label: '狂敲',
    tag: 'TOOL · EXEC',
    quote: '喵喵喵',
    frames: [
      '/mascot/pip-coding.webp',
      '/mascot/pip-coding-2.webp',
      '/mascot/pip-coding-3.webp',
      '/mascot/pip-coding-2.webp',
    ],
    frameDurations: [180, 160, 190, 150],
  },
  {
    id: 'thinking',
    label: '推演',
    tag: 'THINKING · …?',
    quote: '喵喵喵',
    frames: [
      '/mascot/pip-thinking.webp',
      '/mascot/pip-thinking-2.webp',
      '/mascot/pip-thinking-3.webp',
    ],
    frameDurations: [1300, 1100, 1400],
  },
  {
    id: 'done',
    label: '搞定',
    tag: 'VERIFIED · ✓',
    quote: '喵喵喵',
    frames: [
      '/mascot/pip-done.webp',
      '/mascot/pip-done-2.webp',
      '/mascot/pip-done-3.webp',
      '/mascot/pip-done.webp',
    ],
    frameDurations: [950, 420, 1100, 750],
  },
  {
    id: 'alert',
    label: '拦截',
    tag: 'GATE · !',
    quote: '喵喵喵',
    frames: [
      '/mascot/pip-alert.webp',
      '/mascot/pip-alert-2.webp',
      '/mascot/pip-alert-3.webp',
      '/mascot/pip-alert-2.webp',
    ],
    frameDurations: [420, 380, 480, 360],
  },
  {
    id: 'sleep',
    label: '打盹',
    tag: 'STANDBY · zZZ',
    quote: '喵喵喵',
    frames: [
      '/mascot/pip-sleep.webp',
      '/mascot/pip-sleep-2.webp',
      '/mascot/pip-sleep-3.webp',
      '/mascot/pip-sleep-2.webp',
    ],
    frameDurations: [1600, 1200, 1500, 1100],
  },
];

const ALL_SPRITE_SRCS: readonly string[] = Array.from(
  new Set(POSES.flatMap((pose) => pose.frames)),
);

const currentPose = ref<MascotPose>('idle');
const frameIndex = ref<number>(0);
const manualOverrideUntil = ref<number>(0);
const panelOpen = ref<boolean>(false);
const minimized = ref<boolean>(false);
const hop = ref<boolean>(false);
const pettedCount = ref<number>(0);

const activeMeta = computed<PoseMeta>(
  () => POSES.find((item) => item.id === currentPose.value) ?? POSES[0]!,
);

const activeFrameSrc = computed<string>(() => {
  const frames = activeMeta.value.frames;
  return frames[frameIndex.value % frames.length] ?? frames[0]!;
});

let idleTimer: ReturnType<typeof setTimeout> | undefined;
let hopTimer: ReturnType<typeof setTimeout> | undefined;
let frameTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleNextFrame(): void {
  if (frameTimer) clearTimeout(frameTimer);
  if (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    return;
  }
  const durations = activeMeta.value.frameDurations;
  const delay = durations[frameIndex.value % durations.length] ?? 600;
  frameTimer = setTimeout(() => {
    const total = activeMeta.value.frames.length;
    frameIndex.value = (frameIndex.value + 1) % total;
    scheduleNextFrame();
  }, delay);
}

function triggerHop(): void {
  hop.value = false;
  if (hopTimer) clearTimeout(hopTimer);
  requestAnimationFrame(() => {
    hop.value = true;
    hopTimer = setTimeout(() => {
      hop.value = false;
    }, 360);
  });
}

function setPose(pose: MascotPose, manual = false): void {
  const changed = currentPose.value !== pose;
  currentPose.value = pose;
  if (manual) {
    manualOverrideUntil.value = Date.now() + 14_000;
  }
  if (changed) {
    frameIndex.value = 0;
    scheduleNextFrame();
    triggerHop();
  }
}

function selectPoseFromChip(pose: MascotPose): void {
  setPose(pose, true);
}

function cycleNextPose(): void {
  if (minimized.value) {
    minimized.value = false;
    return;
  }
  pettedCount.value += 1;
  const idx = POSES.findIndex((item) => item.id === currentPose.value);
  const next = POSES[(idx + 1) % POSES.length] ?? POSES[0]!;
  setPose(next.id, true);
}

function resetIdleSleepTimer(): void {
  if (idleTimer) clearTimeout(idleTimer);
  if (currentPose.value === 'sleep' && Date.now() > manualOverrideUntil.value) {
    setPose(resolvePoseByScroll(), false);
  }
  idleTimer = setTimeout(() => {
    if (Date.now() > manualOverrideUntil.value && !panelOpen.value) {
      setPose('sleep', false);
    }
  }, 18_000);
}

function resolvePoseByScroll(): MascotPose {
  if (typeof window === 'undefined') return 'idle';
  const doc = document.documentElement;
  const maxScroll = Math.max(1, doc.scrollHeight - window.innerHeight);
  const ratio = window.scrollY / maxScroll;

  if (ratio < 0.14) return 'idle';
  if (ratio < 0.55) return 'coding';
  if (ratio < 0.82) return 'thinking';
  return 'done';
}

function onScroll(): void {
  resetIdleSleepTimer();
  if (Date.now() < manualOverrideUntil.value) return;
  const nextPose = resolvePoseByScroll();
  if (nextPose !== currentPose.value) {
    setPose(nextPose, false);
  }
}

function onUserActivity(): void {
  resetIdleSleepTimer();
}

onMounted(() => {
  resetIdleSleepTimer();
  scheduleNextFrame();
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('mousemove', onUserActivity, { passive: true });
  window.addEventListener('keydown', onUserActivity, { passive: true });
});

onBeforeUnmount(() => {
  if (idleTimer) clearTimeout(idleTimer);
  if (hopTimer) clearTimeout(hopTimer);
  if (frameTimer) clearTimeout(frameTimer);
  window.removeEventListener('scroll', onScroll);
  window.removeEventListener('mousemove', onUserActivity);
  window.removeEventListener('keydown', onUserActivity);
});
</script>

<template>
  <aside
    class="piwin-mascot"
    :class="[`pose-${currentPose}`, { 'is-open': panelOpen, 'is-min': minimized }]"
    aria-label="Piwin 看板猫 Pip"
  >
    <!-- 气泡与动作切换抽屉 -->
    <div v-if="!minimized" class="mascot-card">
      <div class="mascot-card-top">
        <span class="mascot-tag">{{ activeMeta.tag }}</span>
        <div class="mascot-actions">
          <button
            type="button"
            class="mascot-icon-btn"
            :title="panelOpen ? '收起动作列表' : '切换看板猫动作'"
            @click.stop="panelOpen = !panelOpen"
          >
            {{ panelOpen ? '收起' : '动作' }}
          </button>
          <button
            type="button"
            class="mascot-icon-btn"
            title="最小化看板猫"
            @click.stop="
              minimized = true;
              panelOpen = false;
            "
          >
            –
          </button>
        </div>
      </div>

      <p class="mascot-quote" @click="cycleNextPose">{{ activeMeta.quote }}</p>

      <div v-if="panelOpen" class="mascot-chips" role="group" aria-label="切换看板猫状态">
        <button
          v-for="item in POSES"
          :key="item.id"
          type="button"
          class="mascot-chip"
          :class="{ active: item.id === currentPose }"
          @click.stop="selectPoseFromChip(item.id)"
        >
          {{ item.label }}
        </button>
      </div>
    </div>

    <!-- 像素猫主体舞台 -->
    <button
      type="button"
      class="mascot-stage"
      :class="{ 'is-hop': hop }"
      :title="minimized ? '唤醒看板猫 Pip' : '点击切换动作（或点气泡展开 6 种状态）'"
      @click="cycleNextPose"
    >
      <span class="mascot-pedestal" aria-hidden="true" />
      <img
        v-for="src in ALL_SPRITE_SRCS"
        :key="src"
        :src="src"
        :alt="`看板猫 Pip - ${activeMeta.label}`"
        class="mascot-sprite"
        :class="{ active: src === activeFrameSrc }"
        width="88"
        height="88"
        decoding="async"
      />
      <span class="mascot-name-pill">Pip · {{ activeMeta.label }}</span>
    </button>
  </aside>
</template>

<style scoped>
.piwin-mascot {
  position: fixed;
  right: 22px;
  bottom: 20px;
  z-index: 45;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  pointer-events: none;
  user-select: none;
}

.mascot-card,
.mascot-stage {
  pointer-events: auto;
}

/* 气泡卡片 */
.mascot-card {
  width: 224px;
  padding: 10px 12px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--s2) 92%, transparent);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border: 1px solid var(--l2);
  box-shadow: var(--sh2);
  transition: transform 0.22s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.2s ease;
}

.mascot-card:hover {
  border-color: var(--zhu);
}

.mascot-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  margin-bottom: 4px;
}

.mascot-tag {
  font-family: var(--vp-font-family-mono);
  font-size: 0.68rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--zhu);
}

.mascot-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.mascot-icon-btn {
  padding: 1px 6px;
  border-radius: 5px;
  border: 1px solid var(--l2);
  background: var(--s1);
  color: var(--t3);
  font-size: 0.68rem;
  line-height: 1.4;
  cursor: pointer;
  transition: all 0.15s ease;
}

.mascot-icon-btn:hover {
  color: var(--zhu);
  border-color: var(--zhu);
}

.mascot-quote {
  margin: 0;
  font-size: 0.78rem;
  line-height: 1.48;
  color: var(--t1);
  cursor: pointer;
}

.mascot-chips {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 5px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--l1);
}

.mascot-chip {
  padding: 3px 4px;
  border-radius: 6px;
  border: 1px solid var(--l2);
  background: var(--s1);
  color: var(--t2);
  font-size: 0.7rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
}

.mascot-chip:hover {
  border-color: var(--zhu);
  color: var(--zhu);
}

.mascot-chip.active {
  background: var(--zhu);
  border-color: var(--zhu);
  color: var(--on-zhu);
}

/* 像素猫舞台 */
.mascot-stage {
  position: relative;
  width: 96px;
  height: 112px;
  padding: 0 0 18px;
  border: none;
  background: transparent;
  cursor: pointer;
  display: grid;
  place-items: center;
  transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.mascot-stage:hover {
  transform: translateY(-3px) scale(1.04);
}

.mascot-pedestal {
  position: absolute;
  bottom: 20px;
  width: 72px;
  height: 16px;
  border-radius: 50%;
  background: radial-gradient(
    ellipse at center,
    rgba(226, 90, 61, 0.32) 0%,
    rgba(29, 27, 23, 0.22) 58%,
    transparent 76%
  );
  transition: transform 0.25s ease, opacity 0.25s ease;
}

.mascot-sprite {
  width: 88px;
  height: 88px;
  object-fit: contain;
  image-rendering: pixelated;
  image-rendering: crisp-edges;
  filter: drop-shadow(0 0 1px rgba(245, 230, 200, 0.38)) drop-shadow(0 6px 12px rgba(0, 0, 0, 0.36));
  display: none;
  transform-origin: bottom center;
}

.mascot-sprite.active {
  display: block;
}

/* 逐帧像素动画为主，CSS 仅做极轻微的呼吸衬托 */
.pose-idle .mascot-sprite.active,
.pose-thinking .mascot-sprite.active {
  animation: pip-breathe 2.8s steps(2, end) infinite;
}

.pose-coding .mascot-sprite.active {
  animation: pip-type 0.34s steps(2, end) infinite;
}

.pose-done .mascot-sprite.active {
  animation: pip-cheer 1.2s steps(2, end) infinite;
}

.pose-alert .mascot-sprite.active {
  animation: pip-alert 0.5s steps(2, end) infinite;
}

.pose-sleep .mascot-sprite.active {
  animation: pip-sleep 3.6s ease-in-out infinite;
}

.mascot-stage.is-hop .mascot-sprite.active {
  animation: pip-hop 0.34s cubic-bezier(0.2, 0.8, 0.3, 1);
}

.mascot-name-pill {
  position: absolute;
  bottom: 0;
  padding: 1px 9px;
  border-radius: 99px;
  background: var(--s3);
  border: 1px solid var(--l2);
  box-shadow: var(--sh1);
  color: var(--t2);
  font-family: var(--vp-font-family-mono);
  font-size: 0.66rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  white-space: nowrap;
  transition: border-color 0.15s ease, color 0.15s ease;
}

.mascot-stage:hover .mascot-name-pill {
  border-color: var(--zhu);
  color: var(--zhu);
}

/* 最小化时只留右下一只小猫头露出来 */
.piwin-mascot.is-min {
  right: 12px;
  bottom: 10px;
}

.piwin-mascot.is-min .mascot-stage {
  width: 64px;
  height: 64px;
  opacity: 0.85;
}

.piwin-mascot.is-min .mascot-sprite {
  width: 60px;
  height: 60px;
}

@keyframes pip-breathe {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-1px);
  }
}

@keyframes pip-type {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(1px);
  }
}

@keyframes pip-cheer {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-2px);
  }
}

@keyframes pip-alert {
  0%,
  100% {
    transform: translateX(0);
  }
  50% {
    transform: translateX(-1px);
  }
}

@keyframes pip-sleep {
  0%,
  100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.03, 0.97);
  }
}

@keyframes pip-hop {
  0% {
    transform: translateY(0) scale(1);
  }
  45% {
    transform: translateY(-10px) scale(1.06, 0.95);
  }
  100% {
    transform: translateY(0) scale(1);
  }
}

@media (max-width: 640px) {
  .piwin-mascot {
    right: 12px;
    bottom: 12px;
  }
  .mascot-card {
    width: 196px;
    padding: 8px 10px;
  }
  .mascot-stage {
    width: 76px;
    height: 76px;
  }
  .mascot-sprite {
    width: 72px;
    height: 72px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .mascot-sprite.active {
    animation: none !important;
  }
}
</style>
