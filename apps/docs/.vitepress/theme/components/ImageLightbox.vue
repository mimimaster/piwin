<script setup lang="ts">
import { useRoute } from 'vitepress';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

/**
 * 全站图片灯箱。
 *
 * 用文档级事件委托接管正文图片的点击，Markdown 作者不需要写任何额外标记：
 * - `.vp-doc img` 默认可放大；包在链接 / 按钮里的图保持原行为；
 * - `data-zoom-src` 可指定比缩略图更高清的原图；
 * - 同一页的可放大图片组成一组，←/→ 翻看，Esc 关闭。
 */
interface LightboxItem {
  src: string;
  caption: string;
}

const ZOOMABLE_SELECTOR = '.vp-doc img, img.zoomable';
const OPT_OUT_SELECTOR = 'a, button, .no-zoom, .lightbox';

const route = useRoute();
const items = ref<LightboxItem[]>([]);
const activeIndex = ref(-1);
const isOpen = computed(() => activeIndex.value >= 0);
const activeItem = computed(() => items.value[activeIndex.value]);
const closeButton = ref<HTMLButtonElement | null>(null);

let returnFocusTo: HTMLElement | null = null;

function isZoomable(image: HTMLImageElement): boolean {
  if (!image.matches(ZOOMABLE_SELECTOR)) return false;
  if (image.closest(OPT_OUT_SELECTOR)) return false;
  // 行内小图标、徽章不值得放大。
  return image.naturalWidth === 0 || image.naturalWidth >= 240;
}

function describe(image: HTMLImageElement): LightboxItem {
  const figureCaption = image.closest('figure')?.querySelector('figcaption')?.textContent?.trim();
  return {
    src: image.dataset.zoomSrc ?? image.currentSrc ?? image.src,
    caption: figureCaption || image.alt,
  };
}

function handleDocumentClick(event: MouseEvent): void {
  if (event.defaultPrevented || event.button !== 0) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const target = event.target;
  if (!(target instanceof HTMLImageElement) || !isZoomable(target)) return;

  const gallery = Array.from(document.querySelectorAll<HTMLImageElement>(ZOOMABLE_SELECTOR)).filter(
    (image) => isZoomable(image) && image.offsetParent !== null,
  );
  const index = gallery.indexOf(target);
  if (index < 0) return;

  event.preventDefault();
  returnFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  items.value = gallery.map(describe);
  activeIndex.value = index;
}

function close(): void {
  activeIndex.value = -1;
  returnFocusTo?.focus({ preventScroll: true });
  returnFocusTo = null;
}

function step(delta: number): void {
  const count = items.value.length;
  if (count < 2) return;
  activeIndex.value = (activeIndex.value + delta + count) % count;
}

function handleKeydown(event: KeyboardEvent): void {
  if (!isOpen.value) return;
  if (event.key === 'Escape') close();
  else if (event.key === 'ArrowRight') step(1);
  else if (event.key === 'ArrowLeft') step(-1);
  else return;
  event.preventDefault();
}

watch(isOpen, (open) => {
  document.documentElement.classList.toggle('lightbox-open', open);
  if (open) requestAnimationFrame(() => closeButton.value?.focus());
});

watch(
  () => route.path,
  () => {
    if (isOpen.value) close();
  },
);

onMounted(() => {
  document.addEventListener('click', handleDocumentClick);
  document.addEventListener('keydown', handleKeydown);
});

onBeforeUnmount(() => {
  document.removeEventListener('click', handleDocumentClick);
  document.removeEventListener('keydown', handleKeydown);
  document.documentElement.classList.remove('lightbox-open');
});
</script>

<template>
  <Teleport to="body">
    <Transition name="lightbox">
      <div
        v-if="isOpen && activeItem"
        class="lightbox"
        role="dialog"
        aria-modal="true"
        :aria-label="activeItem.caption || '图片预览'"
        @click.self="close"
      >
        <div class="lightbox-bar">
          <span v-if="items.length > 1" class="lightbox-count">
            {{ activeIndex + 1 }} / {{ items.length }}
          </span>
          <a class="lightbox-action" :href="activeItem.src" target="_blank" rel="noreferrer">
            原图 ↗
          </a>
          <button
            ref="closeButton"
            type="button"
            class="lightbox-action"
            aria-label="关闭预览"
            @click="close"
          >
            关闭 Esc
          </button>
        </div>

        <button
          v-if="items.length > 1"
          type="button"
          class="lightbox-nav lightbox-prev"
          aria-label="上一张"
          @click="step(-1)"
        >
          ←
        </button>

        <div class="lightbox-stage" @click.self="close">
          <img
            :key="activeItem.src"
            class="lightbox-img"
            :src="activeItem.src"
            :alt="activeItem.caption"
          />
        </div>

        <button
          v-if="items.length > 1"
          type="button"
          class="lightbox-nav lightbox-next"
          aria-label="下一张"
          @click="step(1)"
        >
          →
        </button>

        <p v-if="activeItem.caption" class="lightbox-caption">{{ activeItem.caption }}</p>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.lightbox {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  grid-template-rows: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 14px 16px 18px;
  background: rgba(11, 10, 9, 0.9);
  backdrop-filter: blur(10px);
}

.lightbox-bar {
  grid-column: 1 / -1;
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
}

.lightbox-count {
  margin-right: auto;
  font: 500 0.78rem var(--vp-font-family-mono);
  color: rgba(235, 229, 218, 0.65);
  font-variant-numeric: tabular-nums;
}

.lightbox-action {
  font: 500 0.76rem var(--vp-font-family-mono);
  color: rgba(235, 229, 218, 0.85);
  padding: 6px 12px;
  border-radius: 999px;
  border: 1px solid rgba(235, 229, 218, 0.18);
  background: rgba(235, 229, 218, 0.06);
  cursor: pointer;
  text-decoration: none;
  transition: border-color 0.15s ease, color 0.15s ease;
}

.lightbox-action:hover {
  color: #fff;
  border-color: #e25a3d;
}

.lightbox-stage {
  grid-column: 2;
  grid-row: 2;
  align-self: stretch;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 0;
  overflow: auto;
}

.lightbox-img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: 8px;
  box-shadow: 0 24px 60px -18px rgba(0, 0, 0, 0.8);
  animation: lightbox-img-in 0.22s cubic-bezier(0.16, 1, 0.3, 1);
}

.lightbox-nav {
  grid-row: 2;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 1px solid rgba(235, 229, 218, 0.18);
  background: rgba(235, 229, 218, 0.06);
  color: rgba(235, 229, 218, 0.85);
  font-size: 1rem;
  cursor: pointer;
  transition: border-color 0.15s ease, background-color 0.15s ease;
}

.lightbox-nav:hover {
  border-color: #e25a3d;
  background: rgba(226, 90, 61, 0.18);
}

.lightbox-prev {
  grid-column: 1;
}

.lightbox-next {
  grid-column: 3;
}

.lightbox-caption {
  grid-column: 1 / -1;
  margin: 0;
  text-align: center;
  font-size: 0.84rem;
  line-height: 1.5;
  color: rgba(235, 229, 218, 0.72);
}

.lightbox-enter-active,
.lightbox-leave-active {
  transition: opacity 0.18s ease;
}

.lightbox-enter-from,
.lightbox-leave-to {
  opacity: 0;
}

@keyframes lightbox-img-in {
  from {
    opacity: 0;
    transform: scale(0.97);
  }
}

@media (max-width: 640px) {
  .lightbox {
    grid-template-columns: minmax(0, 1fr);
    padding: 10px 10px 14px;
  }

  .lightbox-stage {
    grid-column: 1;
  }

  .lightbox-nav {
    position: absolute;
    bottom: 64px;
  }

  .lightbox-prev {
    left: 14px;
  }

  .lightbox-next {
    right: 14px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .lightbox-img {
    animation: none;
  }
}
</style>
