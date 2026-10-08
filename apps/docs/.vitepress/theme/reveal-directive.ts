import type { Directive } from 'vue';

/**
 * v-reveal：元素首次进入视口时淡入上浮一次。
 *
 * 隐藏态只在 mounted 之后才加上，所以 SSR 产物与禁用 JS 的访问者看到的是完整内容，
 * 不会出现「等脚本才显示」的空白。
 */
const REVEAL_SETTLE_MS = 700;
const observers = new WeakMap<Element, IntersectionObserver>();

export const revealDirective: Directive<HTMLElement, number | undefined> = {
  mounted(element, binding) {
    if (
      typeof IntersectionObserver === 'undefined' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return;
    }

    // 已经在首屏内的元素不做入场，避免刷新时闪一下。
    if (element.getBoundingClientRect().top < window.innerHeight * 0.9) return;

    element.classList.add('reveal-pending');
    if (binding.value) element.style.transitionDelay = `${binding.value}ms`;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          element.classList.add('reveal-in');
          observer.disconnect();
          observers.delete(element);
          // 入场结束后撤掉类名与延迟，否则元素自身的 hover 过渡会继承这段延迟。
          window.setTimeout(() => {
            element.classList.remove('reveal-pending', 'reveal-in');
            element.style.transitionDelay = '';
          }, REVEAL_SETTLE_MS + (binding.value ?? 0));
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
    );
    observer.observe(element);
    observers.set(element, observer);
  },
  unmounted(element) {
    observers.get(element)?.disconnect();
    observers.delete(element);
  },
};
