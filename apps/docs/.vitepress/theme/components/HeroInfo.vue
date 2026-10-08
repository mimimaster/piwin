<script setup lang="ts">
import { useData } from 'vitepress';
import { computed } from 'vue';

/**
 * 首页 Hero 文案。
 *
 * 替换 VitePress 默认的标题 / 标语渲染：每个字是独立的 span，开幕动画才能让字
 * 一个一个落下。逐字的延迟写在 `--d` 上，时间轴本身在 styles/hero-intro.css。
 */
interface HeroChar {
  char: string;
  delayMs: number;
  accent: boolean;
}

const TITLE_START_MS = 2250;
const TITLE_STEP_MS = 85;
const TAGLINE_GAP_MS = 120;
const TAGLINE_STEP_MS = 30;

const { frontmatter } = useData();

const heroName = computed<string>(() => frontmatter.value.hero?.name ?? '');
const heroTagline = computed<string>(() => frontmatter.value.hero?.tagline ?? '');

/** 名称最后一个空格之后的部分（「砚」）用朱砂色，与封面主视觉一致。 */
const titleChars = computed<HeroChar[]>(() => {
  const name = heroName.value;
  const accentFrom = name.lastIndexOf(' ') + 1;
  return Array.from(name).map((char, index) => ({
    char,
    delayMs: TITLE_START_MS + index * TITLE_STEP_MS,
    accent: accentFrom > 0 && index >= accentFrom,
  }));
});

/** 标语按句号分行，逐字延迟跨行连续累加。 */
const taglineLines = computed<HeroChar[][]>(() => {
  const sentences = heroTagline.value.match(/[^。]+。?/g) ?? [];
  let delayMs = TITLE_START_MS + titleChars.value.length * TITLE_STEP_MS + TAGLINE_GAP_MS;
  return sentences.map((sentence) =>
    Array.from(sentence.trim()).map((char) => {
      const entry: HeroChar = { char, delayMs, accent: false };
      delayMs += TAGLINE_STEP_MS;
      return entry;
    }),
  );
});
</script>

<template>
  <div class="hero-badge">
    <span class="hero-badge-dot" />
    桌面端编码智能体
  </div>

  <h1 class="hero-title" :aria-label="heroName">
    <span
      v-for="(entry, index) in titleChars"
      :key="index"
      class="hero-char"
      :class="{ accent: entry.accent, space: entry.char === ' ' }"
      :style="{ '--d': `${entry.delayMs}ms` }"
      aria-hidden="true"
      >{{ entry.char }}</span
    >
  </h1>

  <p class="hero-tagline" :aria-label="heroTagline">
    <span v-for="(line, lineIndex) in taglineLines" :key="lineIndex" class="hero-tagline-line" aria-hidden="true">
      <span
        v-for="(entry, index) in line"
        :key="index"
        class="hero-char"
        :style="{ '--d': `${entry.delayMs}ms` }"
        >{{ entry.char }}</span
      >
    </span>
  </p>
</template>

<style scoped>
.hero-title {
  margin: 0;
  font-family: var(--font-serif);
  font-weight: 600;
  font-size: clamp(3rem, 6.2vw, 4.75rem);
  line-height: 1.12;
  letter-spacing: -0.02em;
  color: var(--t1);
}

.hero-char {
  display: inline-block;
  white-space: pre;
}

/* 大字号下衬线体的空格偏宽，收窄让「Piwin 砚」读成一个词 */
.hero-char.space {
  width: 0.2em;
}

.hero-char.accent {
  color: var(--zhu);
}

.hero-tagline {
  margin: 22px 0 0;
  font-family: var(--font-serif);
  font-weight: 500;
  font-size: clamp(1.02rem, 1.5vw, 1.24rem);
  line-height: 2;
  letter-spacing: 0.1em;
  color: var(--t2);
}

.hero-tagline-line {
  display: block;
}

@media (max-width: 640px) {
  .hero-tagline {
    letter-spacing: 0.06em;
  }
}
</style>
