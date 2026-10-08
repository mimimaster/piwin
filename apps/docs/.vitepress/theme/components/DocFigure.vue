<script setup lang="ts">
/**
 * 带编号图题的插图容器：`<DocFigure n="1" caption="…">…</DocFigure>`。
 * 插槽里可以放截图，也可以放交互图解组件。
 */
defineProps<{
  n?: string | number;
  caption: string;
  /** 图注下方的小字来源说明。 */
  source?: string;
  /** 截图类插图加外框；交互图解自带容器，不需要。 */
  framed?: boolean;
}>();
</script>

<template>
  <figure class="doc-figure" :class="{ framed }">
    <div class="doc-figure-body">
      <slot />
    </div>
    <figcaption class="doc-figure-caption">
      <span v-if="n !== undefined" class="doc-figure-num">图 {{ n }}</span>
      <span class="doc-figure-text">{{ caption }}</span>
      <span v-if="source" class="doc-figure-source">{{ source }}</span>
    </figcaption>
  </figure>
</template>

<style scoped>
.doc-figure {
  margin: 1.75rem 0 2rem;
}

.doc-figure.framed .doc-figure-body {
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid var(--l2);
  box-shadow: var(--sh2);
  background: var(--void);
}

.doc-figure.framed .doc-figure-body :deep(img) {
  display: block;
  width: 100%;
  margin: 0;
  border-radius: 0;
  box-shadow: none;
  border: none;
}

.doc-figure-caption {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: center;
  gap: 4px 10px;
  margin-top: 10px;
  padding: 0 8px;
  font-size: 0.84rem;
  line-height: 1.6;
  color: var(--t3);
  text-align: center;
}

.doc-figure-num {
  font-family: var(--font-serif);
  font-weight: 600;
  color: var(--zhu);
  white-space: nowrap;
}

.doc-figure-source {
  flex-basis: 100%;
  font-size: 0.74rem;
  color: var(--t4);
}
</style>
