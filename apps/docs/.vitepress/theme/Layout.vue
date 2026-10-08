<script setup lang="ts">
import DefaultTheme from 'vitepress/theme';
import { useData } from 'vitepress';
import { nextTick, onBeforeUnmount, onMounted, provide } from 'vue';
import HeroInfo from './components/HeroInfo.vue';
import HeroMark from './components/HeroMark.vue';
import ImageLightbox from './components/ImageLightbox.vue';
import ReadingProgress from './components/ReadingProgress.vue';
import { runHeroIntro } from './hero-intro';

const { isDark } = useData();

let stopHeroIntro: (() => void) | undefined;
onMounted(() => {
  stopHeroIntro = runHeroIntro();
});
onBeforeUnmount(() => stopHeroIntro?.());

function canAnimateThemeSwitch(): boolean {
  return (
    'startViewTransition' in document &&
    window.matchMedia('(prefers-reduced-motion: no-preference)').matches
  );
}

// 纸面 / 墨面切换：墨色从点击处晕开，而不是整页硬切。
provide('toggle-appearance', async ({ clientX, clientY }: MouseEvent) => {
  if (!canAnimateThemeSwitch()) {
    isDark.value = !isDark.value;
    return;
  }

  const farthestCorner = Math.hypot(
    Math.max(clientX, window.innerWidth - clientX),
    Math.max(clientY, window.innerHeight - clientY),
  );
  const clipPath = [
    `circle(0px at ${clientX}px ${clientY}px)`,
    `circle(${farthestCorner}px at ${clientX}px ${clientY}px)`,
  ];

  await document.startViewTransition(async () => {
    isDark.value = !isDark.value;
    await nextTick();
  }).ready;

  document.documentElement.animate(
    { clipPath: isDark.value ? [...clipPath].reverse() : clipPath },
    {
      duration: 420,
      easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
      pseudoElement: `::view-transition-${isDark.value ? 'old' : 'new'}(root)`,
    },
  );
});
</script>

<template>
  <DefaultTheme.Layout>
    <template #layout-top>
      <ReadingProgress />
    </template>
    <template #home-hero-info>
      <HeroInfo />
    </template>
    <template #home-hero-image>
      <HeroMark />
    </template>
    <template #layout-bottom>
      <ImageLightbox />
    </template>
  </DefaultTheme.Layout>
</template>
