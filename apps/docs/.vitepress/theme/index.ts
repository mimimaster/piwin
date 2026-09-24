import DefaultTheme from 'vitepress/theme';
import type { Theme } from 'vitepress';
import './custom.css';
import PromoShowcase from './components/PromoShowcase.vue';

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('PromoShowcase', PromoShowcase);
  },
} satisfies Theme;
