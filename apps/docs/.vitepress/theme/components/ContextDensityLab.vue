<script setup lang="ts">
import { computed, ref } from 'vue';

/**
 * 「有效信息密度」示意实验。
 *
 * 这是一个帮助理解的计数模型，不是实测数据：以「文件」为单位，
 * 比较探索产物留在主上下文、与被 scout 隔离后只回一份报告，两种情况下
 * 真正与决策相关的内容在主上下文里占多大比例。
 */
type Mode = 'single' | 'isolated';

const RELEVANT_FILES = 4;
const MIN_READ = RELEVANT_FILES;
const MAX_READ = 60;

const mode = ref<Mode>('single');
const filesRead = ref(30);

const noiseFiles = computed(() => filesRead.value - RELEVANT_FILES);

/** 主上下文里的条目数：隔离模式下是 4 个相关文件 + 1 份 scout 报告。 */
const mainContextUnits = computed(() =>
  mode.value === 'single' ? filesRead.value : RELEVANT_FILES + 1,
);

const density = computed(() => Math.round((RELEVANT_FILES / mainContextUnits.value) * 100));

const verdict = computed(() => {
  if (mode.value === 'isolated') {
    return `无论 scout 读了多少文件，主上下文始终只有 ${RELEVANT_FILES} 个相关文件加 1 份报告；探索量增长不再稀释决策依据。`;
  }
  if (noiseFiles.value === 0) return '只读了需要改的文件，密度 100%——这正是「最少读取」规则追求的状态。';
  return `${RELEVANT_FILES} 个相关文件要与 ${noiseFiles.value} 个无关文件竞争注意力，并且这些无关内容会随每一次后续请求被重复携带。`;
});
</script>

<template>
  <div class="lab">
    <div class="lab-controls">
      <div class="lab-modes" role="radiogroup" aria-label="探索产物的去向">
        <button
          type="button"
          role="radio"
          class="lab-mode"
          :class="{ on: mode === 'single' }"
          :aria-checked="mode === 'single'"
          @click="mode = 'single'"
        >
          单一上下文
        </button>
        <button
          type="button"
          role="radio"
          class="lab-mode"
          :class="{ on: mode === 'isolated' }"
          :aria-checked="mode === 'isolated'"
          @click="mode = 'isolated'"
        >
          Scout 隔离
        </button>
      </div>

      <label class="lab-slider">
        <span class="lab-slider-label">
          探索时读取的文件数
          <b>{{ filesRead }}</b>
        </span>
        <input v-model.number="filesRead" type="range" :min="MIN_READ" :max="MAX_READ" step="1" />
      </label>
    </div>

    <div class="lab-stage">
      <div class="lab-pane lab-main">
        <div class="lab-pane-head">
          <span>主上下文（Lead 做决策的地方）</span>
          <span class="lab-pane-count">{{ mainContextUnits }} 项</span>
        </div>
        <TransitionGroup name="cell" tag="div" class="lab-cells">
          <span v-for="index in RELEVANT_FILES" :key="`relevant-${index}`" class="cell relevant" />
          <span v-if="mode === 'isolated'" key="report" class="cell report" />
          <template v-if="mode === 'single'">
            <span v-for="index in noiseFiles" :key="`noise-${index}`" class="cell noise" />
          </template>
        </TransitionGroup>
      </div>

      <div class="lab-pane lab-side" :class="{ idle: mode === 'single' }">
        <div class="lab-pane-head">
          <span>Scout 上下文（任务结束即丢弃）</span>
          <span class="lab-pane-count">{{ mode === 'isolated' ? `${filesRead} 项` : '未使用' }}</span>
        </div>
        <TransitionGroup name="cell" tag="div" class="lab-cells">
          <template v-if="mode === 'isolated'">
            <span v-for="index in RELEVANT_FILES" :key="`s-relevant-${index}`" class="cell relevant faded" />
            <span v-for="index in noiseFiles" :key="`s-noise-${index}`" class="cell noise" />
          </template>
        </TransitionGroup>
        <p v-if="mode === 'single'" class="lab-side-empty">
          所有搜索、试读与中间假设都直接落在左侧。
        </p>
      </div>
    </div>

    <div class="lab-result">
      <div class="lab-meter">
        <div class="lab-meter-head">
          <span>主上下文有效信息密度</span>
          <b :class="{ good: density >= 60, bad: density < 30 }">{{ density }}%</b>
        </div>
        <div class="lab-meter-track">
          <div
            class="lab-meter-fill"
            :class="{ good: density >= 60, bad: density < 30 }"
            :style="{ width: `${density}%` }"
          />
        </div>
      </div>
      <p class="lab-verdict">{{ verdict }}</p>
      <div class="lab-legend">
        <span><i class="cell relevant" />与修改相关的文件</span>
        <span><i class="cell noise" />探索中读到的无关内容</span>
        <span><i class="cell report" />Scout 压缩报告</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.lab {
  border-radius: 14px;
  border: 1px solid var(--l2);
  background: var(--s3);
  box-shadow: var(--sh2);
  overflow: hidden;
}

.lab-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 24px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--l1);
  background: var(--s2);
}

.lab-modes {
  display: inline-flex;
  gap: 4px;
  padding: 3px;
  border-radius: 9px;
  border: 1px solid var(--l2);
  background: var(--s1);
}

.lab-mode {
  padding: 5px 14px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--t3);
  font-size: 0.82rem;
  font-weight: 500;
  cursor: pointer;
  transition: color 0.15s ease, background-color 0.15s ease;
}

.lab-mode:hover {
  color: var(--t1);
}

.lab-mode.on {
  background: var(--s3);
  color: var(--zhu);
  box-shadow: var(--sh1);
}

.lab-slider {
  flex: 1;
  min-width: 220px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.lab-slider-label {
  display: flex;
  justify-content: space-between;
  font-size: 0.78rem;
  color: var(--t3);
}

.lab-slider-label b {
  font-family: var(--vp-font-family-mono);
  color: var(--t1);
  font-variant-numeric: tabular-nums;
}

.lab-slider input {
  width: 100%;
  accent-color: var(--zhu);
  cursor: pointer;
}

.lab-stage {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  padding: 14px 16px;
}

.lab-pane {
  min-height: 150px;
  padding: 10px 12px 12px;
  border-radius: 10px;
  border: 1px solid var(--l2);
  background: var(--s2);
  transition: opacity 0.25s ease;
}

.lab-main {
  border-color: color-mix(in srgb, var(--zhu) 35%, var(--l2));
}

.lab-side {
  border-style: dashed;
}

.lab-side.idle {
  opacity: 0.55;
}

.lab-pane-head {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
  font-size: 0.76rem;
  color: var(--t3);
}

.lab-pane-count {
  font-family: var(--vp-font-family-mono);
  color: var(--t4);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.lab-cells {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.cell {
  display: inline-block;
  width: 18px;
  height: 22px;
  border-radius: 3px;
  flex-shrink: 0;
}

.cell.relevant {
  background: var(--zhu);
}

.cell.relevant.faded {
  opacity: 0.4;
}

.cell.noise {
  background: var(--l3);
}

.cell.report {
  width: 41px;
  background: var(--pine);
}

.cell-enter-active,
.cell-leave-active {
  transition: opacity 0.22s ease, transform 0.22s ease;
}

.cell-enter-from,
.cell-leave-to {
  opacity: 0;
  transform: scale(0.5);
}

.cell-leave-active {
  position: absolute;
}

.lab-side-empty {
  margin: 0 !important;
  font-size: 0.78rem;
  line-height: 1.5 !important;
  color: var(--t4) !important;
}

.lab-result {
  padding: 12px 16px 16px;
  border-top: 1px solid var(--l1);
  background: var(--s2);
}

.lab-meter-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: 0.82rem;
  color: var(--t2);
  margin-bottom: 6px;
}

.lab-meter-head b {
  font: 600 1.25rem var(--font-serif);
  color: var(--ochre);
  font-variant-numeric: tabular-nums;
  transition: color 0.25s ease;
}

.lab-meter-head b.good {
  color: var(--pine);
}

.lab-meter-head b.bad {
  color: var(--crimson);
}

.lab-meter-track {
  height: 8px;
  border-radius: 999px;
  background: var(--l1);
  overflow: hidden;
}

.lab-meter-fill {
  height: 100%;
  border-radius: 999px;
  background: var(--ochre);
  transition: width 0.35s cubic-bezier(0.16, 1, 0.3, 1), background-color 0.25s ease;
}

.lab-meter-fill.good {
  background: var(--pine);
}

.lab-meter-fill.bad {
  background: var(--crimson);
}

.lab-verdict {
  margin: 10px 0 10px !important;
  min-height: 2.9em;
  font-size: 0.85rem;
  line-height: 1.6 !important;
  color: var(--t2) !important;
}

.lab-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 18px;
  font-size: 0.74rem;
  color: var(--t3);
}

.lab-legend span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.lab-legend .cell {
  width: 10px;
  height: 12px;
}

.lab-legend .cell.report {
  width: 20px;
}

@media (max-width: 640px) {
  .lab-stage {
    grid-template-columns: 1fr;
  }
}

@media (prefers-reduced-motion: reduce) {
  .cell-enter-active,
  .cell-leave-active,
  .lab-meter-fill {
    transition: none;
  }
}
</style>
