import DefaultTheme from 'vitepress/theme';
import type { Theme } from 'vitepress';
import './custom.css';
import PromoShowcase from './components/PromoShowcase.vue';
import HomeQuickNav from './components/HomeQuickNav.vue';

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('PromoShowcase', PromoShowcase);
    app.component('HomeQuickNav', HomeQuickNav);
  },
} satisfies Theme;
