import DefaultTheme from 'vitepress/theme';
import type { Theme } from 'vitepress';
import './custom.css';
import './styles/motion.css';
import './styles/hero-intro.css';
import './styles/article.css';
import Layout from './Layout.vue';
import PromoShowcase from './components/PromoShowcase.vue';
import HomeQuickNav from './components/HomeQuickNav.vue';
import HomeOrchestration from './components/HomeOrchestration.vue';
import DownloadView from './components/DownloadView.vue';
import PrototypeViewer from './components/PrototypeViewer.vue';
import DocFigure from './components/DocFigure.vue';
import OrchestrationFlow from './components/OrchestrationFlow.vue';
import ContextDensityLab from './components/ContextDensityLab.vue';
import DelegationTradeoff from './components/DelegationTradeoff.vue';
import { revealDirective } from './reveal-directive';

export default {
  extends: DefaultTheme,
  Layout,
  enhanceApp({ app }) {
    app.directive('reveal', revealDirective);
    app.component('PromoShowcase', PromoShowcase);
    app.component('HomeQuickNav', HomeQuickNav);
    app.component('HomeOrchestration', HomeOrchestration);
    app.component('DownloadView', DownloadView);
    app.component('PrototypeViewer', PrototypeViewer);
    app.component('DocFigure', DocFigure);
    app.component('OrchestrationFlow', OrchestrationFlow);
    app.component('ContextDensityLab', ContextDensityLab);
    app.component('DelegationTradeoff', DelegationTradeoff);
  },
} satisfies Theme;
