<script setup lang="ts">
import { useData, useRoute } from 'vitepress';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

/**
 * 顶部朱砂阅读进度线 + 右下角「回到顶部」。
 * 只在文档页出现；首页是展示型长页，进度线没有阅读意义。
 */
const { frontmatter } = useData();
const route = useRoute();

const isDocPage = computed(() => frontmatter.value.layout !== 'home');
const progress = ref(0);
const showBackToTop = ref(false);

let frameId = 0;

function measure(): void {
  frameId = 0;
  const scrollable = document.documentElement.scrollHeight - window.innerHeight;
  progress.value = scrollable > 0 ? Math.min(1, window.scrollY / scrollable) : 0;
  showBackToTop.value = window.scrollY > 640;
}

function scheduleMeasure(): void {
  if (frameId === 0) frameId = window.requestAnimationFrame(measure);
}

function scrollToTop(): void {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
}

onMounted(() => {
  window.addEventListener('scroll', scheduleMeasure, { passive: true });
  window.addEventListener('resize', scheduleMeasure, { passive: true });
  measure();
});

onBeforeUnmount(() => {
  window.removeEventListener('scroll', scheduleMeasure);
  window.removeEventListener('resize', scheduleMeasure);
  if (frameId !== 0) window.cancelAnimationFrame(frameId);
});

// 路由切换后页面高度变了，等新内容挂上再量一次。
watch(
  () => route.path,
  () => scheduleMeasure(),
  { flush: 'post' },
);
</script>

<template>
  <div v-if="isDocPage" class="reading-progress" aria-hidden="true">
    <div class="reading-progress-bar" :style="{ transform: `scaleX(${progress})` }" />
  </div>
  <Transition name="back-to-top">
    <button
      v-if="isDocPage && showBackToTop"
      type="button"
      class="back-to-top"
      aria-label="回到顶部"
      title="回到顶部"
      @click="scrollToTop"
    >
      <span aria-hidden="true">↑</span>
      <span class="back-to-top-pct">{{ Math.round(progress * 100) }}%</span>
    </button>
  </Transition>
</template>

<style scoped>
.reading-progress {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  z-index: 60;
  pointer-events: none;
}

.reading-progress-bar {
  height: 100%;
  background: linear-gradient(90deg, var(--zhu-press), var(--zhu) 60%, var(--lamp));
  transform-origin: 0 50%;
  will-change: transform;
}

.back-to-top {
  position: fixed;
  right: 24px;
  bottom: 28px;
  z-index: 40;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  border: 1px solid var(--l2);
  background: var(--s3);
  color: var(--t2);
  box-shadow: var(--sh2);
  cursor: pointer;
  font-size: 0.95rem;
  line-height: 1;
  transition: color 0.15s ease, border-color 0.15s ease, transform 0.15s ease;
}

.back-to-top:hover {
  color: var(--zhu);
  border-color: var(--zhu);
  transform: translateY(-2px);
}

.back-to-top-pct {
  font-family: var(--vp-font-family-mono);
  font-size: 0.58rem;
  color: var(--t4);
  font-variant-numeric: tabular-nums;
}

.back-to-top-enter-active,
.back-to-top-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.back-to-top-enter-from,
.back-to-top-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

@media (max-width: 768px) {
  .back-to-top {
    right: 14px;
    bottom: 18px;
  }
}
</style>
