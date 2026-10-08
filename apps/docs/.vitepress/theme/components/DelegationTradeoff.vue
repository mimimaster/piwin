<script setup lang="ts">
/**
 * 「把判断下放给便宜模型」实验的对照条形图。
 * 数值转引自原帖引用的 Devin 实验：成本降 28%，得分 54 → 27。
 */
interface Metric {
  label: string;
  unit: string;
  baseline: number;
  delegated: number;
  /** 条形满宽对应的数值。 */
  scale: number;
  delta: string;
  tone: 'gain' | 'loss';
}

const metrics: readonly Metric[] = [
  { label: '任务成本', unit: '相对值', baseline: 100, delegated: 72, scale: 100, delta: '−28%', tone: 'gain' },
  { label: '任务得分', unit: '分', baseline: 54, delegated: 27, scale: 100, delta: '−50%', tone: 'loss' },
];
</script>

<template>
  <div v-reveal class="tradeoff">
    <div v-for="metric in metrics" :key="metric.label" class="tradeoff-metric">
      <div class="tradeoff-head">
        <b>{{ metric.label }}</b>
        <span class="tradeoff-delta" :class="metric.tone">{{ metric.delta }}</span>
      </div>
      <div class="tradeoff-row">
        <span class="tradeoff-name">Lead 保留判断</span>
        <div class="tradeoff-track">
          <div class="tradeoff-bar baseline" :style="{ '--w': `${(metric.baseline / metric.scale) * 100}%` }" />
        </div>
        <span class="tradeoff-value">{{ metric.baseline }}</span>
      </div>
      <div class="tradeoff-row">
        <span class="tradeoff-name">判断下放给便宜模型</span>
        <div class="tradeoff-track">
          <div
            class="tradeoff-bar delegated"
            :class="metric.tone"
            :style="{ '--w': `${(metric.delegated / metric.scale) * 100}%` }"
          />
        </div>
        <span class="tradeoff-value">{{ metric.delegated }}</span>
      </div>
      <span class="tradeoff-unit">单位：{{ metric.unit }}</span>
    </div>
  </div>
</template>

<style scoped>
.tradeoff {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  padding: 16px;
  border-radius: 14px;
  border: 1px solid var(--l2);
  background: var(--s3);
  box-shadow: var(--sh2);
}

.tradeoff-metric {
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid var(--l1);
  background: var(--s2);
}

.tradeoff-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 10px;
}

.tradeoff-head b {
  font-family: var(--font-serif);
  font-size: 0.98rem;
  color: var(--t1);
}

.tradeoff-delta {
  font: 600 1.1rem var(--font-serif);
  font-variant-numeric: tabular-nums;
}

.tradeoff-delta.gain {
  color: var(--pine);
}

.tradeoff-delta.loss {
  color: var(--crimson);
}

.tradeoff-row {
  display: grid;
  grid-template-columns: 9.5em minmax(0, 1fr) 2.2em;
  align-items: center;
  gap: 8px;
  margin-bottom: 7px;
  font-size: 0.78rem;
  color: var(--t3);
}

.tradeoff-track {
  height: 14px;
  border-radius: 4px;
  background: var(--l1);
  overflow: hidden;
}

.tradeoff-bar {
  height: 100%;
  width: var(--w);
  border-radius: 4px;
  transition: width 0.9s cubic-bezier(0.16, 1, 0.3, 1) 0.15s;
}

/* 入场前条形宽度为 0，进入视口后长到目标值 */
.tradeoff.reveal-pending:not(.reveal-in) .tradeoff-bar {
  width: 0;
}

.tradeoff-bar.baseline {
  background: var(--t3);
}

.tradeoff-bar.delegated.gain {
  background: var(--pine);
}

.tradeoff-bar.delegated.loss {
  background: var(--crimson);
}

.tradeoff-value {
  font-family: var(--vp-font-family-mono);
  color: var(--t1);
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.tradeoff-unit {
  font-size: 0.7rem;
  color: var(--t4);
}

@media (max-width: 640px) {
  .tradeoff {
    grid-template-columns: 1fr;
  }
}
</style>
