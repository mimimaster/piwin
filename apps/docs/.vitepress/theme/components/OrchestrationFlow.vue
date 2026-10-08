<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

/**
 * Auto 编排流转动态图。
 *
 * 画的是真实的 Host 协议（packages/contracts orchestration-scheme-auto.ts）：
 * Lead 路由 → scout 取证 → sidekick 单写者产出 candidate → 规模闸决定谁审 →
 * apply → tester 在快照里后台验证。步骤自动轮播，悬停 / 点选后停在该步。
 */
type NodeId = 'user' | 'lead' | 'scout' | 'sidekick' | 'review' | 'workspace' | 'tester';
type EdgeId =
  | 'ask'
  | 'reply'
  | 'dispatch-scout'
  | 'scout-report'
  | 'brief'
  | 'candidate'
  | 'changes'
  | 'apply'
  | 'snapshot'
  | 'tester-report';

interface FlowStep {
  id: string;
  label: string;
  title: string;
  detail: string;
  nodes: readonly NodeId[];
  edges: readonly EdgeId[];
}

interface FlowEdge {
  id: EdgeId;
  path: string;
  label: string;
  labelX: number;
  labelY: number;
  /** 回流 / 异步的边用虚线，和主干的实线区分。 */
  returning?: boolean;
}

const STEP_INTERVAL_MS = 3600;

const steps: readonly FlowStep[] = [
  {
    id: 'goal',
    label: 'Goal',
    title: '先陈述目标',
    detail:
      'Lead 动手前先输出一行 [Goal] 与最小读取集。意图识别错了，用户在这一步就能打断并补充信息。',
    nodes: ['user', 'lead'],
    edges: ['ask'],
  },
  {
    id: 'scout',
    label: 'Scout',
    title: '只读取证',
    detail:
      '位置未知或证据不足时，Lead 并行派出只读 scout。高噪声的搜索留在子上下文里，回到主上下文的只有带 file:line 引用的压缩报告。',
    nodes: ['lead', 'scout'],
    edges: ['dispatch-scout', 'scout-report'],
  },
  {
    id: 'sidekick',
    label: 'Sidekick',
    title: '单写者实现',
    detail:
      '方案已定、实现机械的部分写成自包含 brief 交给 sidekick。它看不到主会话历史，在独立 worktree 里以唯一 writer 的身份产出 candidate。',
    nodes: ['lead', 'sidekick'],
    edges: ['brief'],
  },
  {
    id: 'review',
    label: 'Review',
    title: '规模闸与审查',
    detail:
      'candidate 不超过 5 个文件且 300 行改动时由 Lead 自审；超过任一上限，Host 强制要求独立的只读 reviewer。需要修改就带着意见回到同一条 sidekick lane。',
    nodes: ['sidekick', 'review'],
    edges: ['candidate', 'changes'],
  },
  {
    id: 'apply',
    label: 'Apply',
    title: '合入并立即答复',
    detail:
      '审查通过后，candidate 被应用到用户工作区。Lead 不等测试，当下就告诉用户改了什么、可以手动试什么。',
    nodes: ['review', 'workspace', 'lead', 'user'],
    edges: ['apply', 'reply'],
  },
  {
    id: 'tester',
    label: 'Tester',
    title: '后台验证',
    detail:
      'tester 在当前工作区的快照里跑真实行为（命令、预览、截图），它的改动永不合入。报告以 pass / fail / blocked 加证据的形式稍后回流。',
    nodes: ['workspace', 'tester', 'lead'],
    edges: ['snapshot', 'tester-report'],
  },
];

const edges: readonly FlowEdge[] = [
  { id: 'ask', path: 'M92 172 H140', label: '需求', labelX: 116, labelY: 162 },
  { id: 'reply', path: 'M140 204 H92', label: '答复', labelX: 116, labelY: 222, returning: true },
  {
    id: 'dispatch-scout',
    path: 'M188 136 C188 76 240 50 310 50',
    label: '有界问题',
    labelX: 218,
    labelY: 62,
  },
  {
    id: 'scout-report',
    path: 'M310 80 C262 80 226 98 220 136',
    label: 'file:line 报告',
    labelX: 282,
    labelY: 112,
    returning: true,
  },
  { id: 'brief', path: 'M260 187 H310', label: 'brief', labelX: 285, labelY: 177 },
  { id: 'candidate', path: 'M450 187 H496', label: '候选', labelX: 473, labelY: 177 },
  {
    id: 'changes',
    path: 'M550 224 C550 262 380 262 380 224',
    label: '修改意见',
    labelX: 465,
    labelY: 244,
    returning: true,
  },
  { id: 'apply', path: 'M604 187 H652', label: 'apply', labelX: 628, labelY: 177 },
  { id: 'snapshot', path: 'M708 224 V288', label: '快照', labelX: 730, labelY: 260 },
  {
    id: 'tester-report',
    path: 'M652 326 C460 366 205 346 205 236',
    label: 'pass | fail | blocked · 稍后回流',
    labelX: 420,
    labelY: 372,
    returning: true,
  },
];

const activeIndex = ref(0);
const isPinned = ref(false);
const activeStep = computed<FlowStep>(() => steps[activeIndex.value] ?? steps[0]!);

let timerId: ReturnType<typeof setInterval> | undefined;

function stopAutoplay(): void {
  if (timerId !== undefined) clearInterval(timerId);
  timerId = undefined;
}

function startAutoplay(): void {
  stopAutoplay();
  if (isPinned.value) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  timerId = setInterval(() => {
    activeIndex.value = (activeIndex.value + 1) % steps.length;
  }, STEP_INTERVAL_MS);
}

function pinStep(index: number): void {
  activeIndex.value = index;
  isPinned.value = true;
  stopAutoplay();
}

function togglePlayback(): void {
  isPinned.value = !isPinned.value;
  if (isPinned.value) stopAutoplay();
  else startAutoplay();
}

function handleStepKeydown(event: KeyboardEvent): void {
  if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
  event.preventDefault();
  const delta = event.key === 'ArrowRight' ? 1 : -1;
  pinStep((activeIndex.value + delta + steps.length) % steps.length);
}

function isNodeActive(id: NodeId): boolean {
  return activeStep.value.nodes.includes(id);
}

function isEdgeActive(id: EdgeId): boolean {
  return activeStep.value.edges.includes(id);
}

onMounted(startAutoplay);
onBeforeUnmount(stopAutoplay);
</script>

<template>
  <div class="flow" @mouseenter="stopAutoplay" @mouseleave="startAutoplay">
    <div class="flow-steps" role="tablist" aria-label="Auto 编排的六个阶段" @keydown="handleStepKeydown">
      <button
        v-for="(step, index) in steps"
        :key="step.id"
        type="button"
        role="tab"
        class="flow-step"
        :class="{ on: index === activeIndex, done: index < activeIndex }"
        :aria-selected="index === activeIndex"
        :tabindex="index === activeIndex ? 0 : -1"
        @click="pinStep(index)"
      >
        <span class="flow-step-num">{{ index + 1 }}</span>
        <span class="flow-step-label">{{ step.label }}</span>
      </button>
      <button
        type="button"
        class="flow-play"
        :aria-label="isPinned ? '继续自动播放' : '暂停自动播放'"
        @click="togglePlayback"
      >
        {{ isPinned ? '播放' : '暂停' }}
      </button>
    </div>

    <div class="flow-canvas">
      <svg
        class="flow-svg"
        viewBox="0 0 780 384"
        role="img"
        aria-label="Auto 编排流转图：用户、Lead、Scout、Sidekick、审查闸、工作区与 Tester 之间的消息流"
      >
        <defs>
          <!-- context-stroke 在 WebKit 上不可靠，所以空闲 / 激活各备一个箭头 -->
          <marker
            v-for="variant in ['idle', 'on']"
            :id="`flow-arrow-${variant}`"
            :key="variant"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto"
          >
            <path class="arrow-head" :class="variant" d="M1 1 L9 5 L1 9" />
          </marker>
        </defs>

        <!-- 隔离边界：子上下文与 worktree 是 Auto 的两条隔离线 -->
        <rect class="zone" x="296" y="14" width="172" height="90" rx="14" />
        <text class="zone-label" x="382" y="119">独立上下文 · 只读</text>
        <rect class="zone" x="296" y="138" width="322" height="130" rx="14" />
        <text class="zone-label" x="457" y="283">独立 worktree · 写入隔离</text>

        <g v-for="edge in edges" :key="edge.id" class="edge" :class="{ on: isEdgeActive(edge.id), returning: edge.returning }">
          <path
            class="edge-line"
            :d="edge.path"
            :marker-end="`url(#flow-arrow-${isEdgeActive(edge.id) ? 'on' : 'idle'})`"
          />
          <path v-if="isEdgeActive(edge.id)" class="edge-pulse" :d="edge.path" />
          <text class="edge-label" :x="edge.labelX" :y="edge.labelY">{{ edge.label }}</text>
        </g>

        <g class="node" :class="{ on: isNodeActive('user') }">
          <rect x="16" y="150" width="76" height="72" rx="12" />
          <text class="node-title" x="54" y="184">你</text>
          <text class="node-sub" x="54" y="203">一句话</text>
        </g>

        <g class="node node-lead" :class="{ on: isNodeActive('lead') }">
          <rect x="140" y="136" width="120" height="100" rx="14" />
          <text class="node-title" x="200" y="175">Lead</text>
          <text class="node-sub" x="200" y="195">判断 · 路由 · 终审</text>
          <text class="node-meta" x="200" y="214">主会话模型</text>
        </g>

        <g class="node" :class="{ on: isNodeActive('scout') }">
          <rect x="310" y="28" width="144" height="62" rx="12" />
          <text class="node-title" x="382" y="55">Scout × N</text>
          <text class="node-sub" x="382" y="74">并行取证</text>
        </g>

        <g class="node" :class="{ on: isNodeActive('sidekick') }">
          <rect x="310" y="152" width="140" height="72" rx="12" />
          <text class="node-title" x="380" y="184">Sidekick</text>
          <text class="node-sub" x="380" y="203">唯一 writer</text>
        </g>

        <g class="node" :class="{ on: isNodeActive('review') }">
          <rect x="496" y="152" width="108" height="72" rx="12" />
          <text class="node-title" x="550" y="184">Review</text>
          <text class="node-sub" x="550" y="203">5 文件 / 300 行闸</text>
        </g>

        <g class="node" :class="{ on: isNodeActive('workspace') }">
          <rect x="652" y="152" width="112" height="72" rx="12" />
          <text class="node-title" x="708" y="184">工作区</text>
          <text class="node-sub" x="708" y="203">你的代码</text>
        </g>

        <g class="node" :class="{ on: isNodeActive('tester') }">
          <rect x="652" y="288" width="112" height="72" rx="12" />
          <text class="node-title" x="708" y="320">Tester</text>
          <text class="node-sub" x="708" y="339">快照 · 后台 · 不合入</text>
        </g>
      </svg>
    </div>
    <p class="flow-swipe-hint" aria-hidden="true">← 左右滑动查看全图 →</p>

    <div class="flow-detail" aria-live="polite">
      <!-- 按步骤 key 重新挂载，用入场动画过渡；不依赖 transitionend，后台标签页里也不会卡在半透明 -->
      <div :key="activeStep.id" class="flow-detail-inner">
        <span class="flow-detail-num">{{ String(activeIndex + 1).padStart(2, '0') }}</span>
        <div>
          <b class="flow-detail-title">{{ activeStep.title }}</b>
          <p class="flow-detail-text">{{ activeStep.detail }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.flow {
  border-radius: 14px;
  border: 1px solid var(--l2);
  background: var(--s3);
  box-shadow: var(--sh2);
  overflow: hidden;
}

/* 步骤条 */
.flow-steps {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--l1);
  background: var(--s2);
  overflow-x: auto;
  scrollbar-width: none;
}

.flow-step {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 5px 12px 5px 6px;
  border-radius: 999px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--t3);
  font-size: 0.8rem;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  transition: color 0.2s ease, background-color 0.2s ease, border-color 0.2s ease;
}

.flow-step:hover {
  color: var(--t1);
}

.flow-step.on {
  color: var(--zhu);
  background: var(--zhu-wash);
  border-color: color-mix(in srgb, var(--zhu) 30%, transparent);
}

.flow-step-num {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  font: 600 0.68rem var(--vp-font-family-mono);
  background: var(--l2);
  color: var(--t2);
  transition: background-color 0.2s ease, color 0.2s ease;
}

.flow-step.done .flow-step-num {
  background: var(--pine-wash);
  color: var(--pine);
}

.flow-step.on .flow-step-num {
  background: var(--zhu);
  color: var(--on-zhu);
}

.flow-play {
  margin-left: auto;
  flex-shrink: 0;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid var(--l2);
  background: var(--s3);
  color: var(--t3);
  font: 500 0.7rem var(--vp-font-family-mono);
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease;
}

.flow-play:hover {
  color: var(--zhu);
  border-color: var(--zhu);
}

/* 画布：窄屏横向滚动，保证字号不被压到看不清 */
.flow-canvas {
  overflow-x: auto;
  padding: 10px 8px 0;
}

.flow-svg {
  display: block;
  width: 100%;
  min-width: 620px;
  max-width: 880px;
  margin: 0 auto;
  height: auto;
}

.flow-swipe-hint {
  display: none;
  margin: 4px 0 8px !important;
  text-align: center;
  font: 400 0.68rem var(--vp-font-family-mono) !important;
  color: var(--t4) !important;
}

@media (max-width: 680px) {
  .flow-swipe-hint {
    display: block;
  }
}

.zone {
  fill: color-mix(in srgb, var(--s1) 70%, transparent);
  stroke: var(--l2);
  stroke-dasharray: 3 5;
}

.zone-label {
  fill: var(--t4);
  font: 500 10.5px var(--vp-font-family-mono);
  text-anchor: middle;
  letter-spacing: 0.04em;
}

/* 节点 */
.node rect {
  fill: var(--s2);
  stroke: var(--l3);
  stroke-width: 1;
  transition: fill 0.35s ease, stroke 0.35s ease, stroke-width 0.35s ease;
}

.node text {
  text-anchor: middle;
  transition: fill 0.35s ease;
}

.node-title {
  fill: var(--t1);
  font: 600 15px var(--font-serif);
}

.node-sub {
  fill: var(--t3);
  font: 400 11px var(--vp-font-family-base);
}

.node-meta {
  fill: var(--t4);
  font: 400 10px var(--vp-font-family-mono);
}

.node-lead rect {
  stroke: color-mix(in srgb, var(--zhu) 45%, var(--l3));
}

.node.on rect {
  fill: var(--zhu-wash);
  stroke: var(--zhu);
  stroke-width: 1.6;
}

.node.on .node-title {
  fill: var(--zhu);
}

.node.on .node-sub {
  fill: var(--t2);
}

/* 连线 */
.edge {
  color: var(--l3);
}

.arrow-head {
  fill: none;
  stroke: var(--l3);
  stroke-width: 1.6;
}

.arrow-head.on {
  stroke: var(--zhu);
}

.edge-line {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.3;
  transition: stroke 0.35s ease;
}

.edge.returning .edge-line {
  stroke-dasharray: 4 4;
}

.edge-label {
  fill: var(--t4);
  font: 400 10.5px var(--vp-font-family-mono);
  text-anchor: middle;
  transition: fill 0.35s ease;
}

.edge.on {
  color: var(--zhu);
}

.edge.on .edge-label {
  fill: var(--zhu);
}

/* 激活的边上有一段流光沿箭头方向移动，表示消息正在这条线上走 */
.edge-pulse {
  fill: none;
  stroke: var(--zhu);
  stroke-width: 3;
  stroke-linecap: round;
  stroke-dasharray: 14 400;
  animation: flow-pulse 1.5s linear infinite;
  opacity: 0.85;
}

@keyframes flow-pulse {
  from {
    stroke-dashoffset: 14;
  }
  to {
    stroke-dashoffset: -400;
  }
}

/* 步骤说明 */
.flow-detail {
  min-height: 104px;
  padding: 14px 18px 16px;
  border-top: 1px solid var(--l1);
  background: var(--s2);
}

.flow-detail-inner {
  animation: flow-detail-in 0.26s ease both;
  display: flex;
  gap: 14px;
  align-items: flex-start;
}

.flow-detail-num {
  font: 600 1.4rem var(--font-serif);
  color: var(--zhu);
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
}

.flow-detail-title {
  display: block;
  font-family: var(--font-serif);
  font-size: 1rem;
  color: var(--t1);
  margin-bottom: 2px;
}

.flow-detail-text {
  margin: 0 !important;
  font-size: 0.87rem;
  line-height: 1.65 !important;
  color: var(--t2) !important;
}

@keyframes flow-detail-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
}

@media (max-width: 640px) {
  .flow-detail {
    min-height: 150px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .edge-pulse {
    animation: none;
    stroke-dasharray: none;
    stroke-width: 1.6;
  }

  .flow-detail-inner {
    animation: none;
  }
}
</style>
