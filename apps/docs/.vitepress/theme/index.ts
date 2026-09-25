import DefaultTheme from 'vitepress/theme';
import { h } from 'vue';
import type { Theme } from 'vitepress';
import './custom.css';
import PromoShowcase from './components/PromoShowcase.vue';
import HomeQuickNav from './components/HomeQuickNav.vue';

export default {
  extends: DefaultTheme,
  Layout: () => {
    return h(DefaultTheme.Layout, null, {
      'home-hero-info-before': () =>
        h('div', { class: 'hero-badge' }, [
          h('span', { class: 'hero-badge-dot' }),
          '桌面端编码智能体',
        ]),
    });
  },
  enhanceApp({ app }) {
    app.component('PromoShowcase', PromoShowcase);
    app.component('HomeQuickNav', HomeQuickNav);
  },
} satisfies Theme;
