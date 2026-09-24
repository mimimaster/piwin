<script setup lang="ts">
import { computed, ref } from 'vue';
import { useData } from 'vitepress';

/**
 * 宣传展台组件 (PromoShowcase)
 *
 * 素材来自 `~/Downloads/piwin-promo`：
 * 1. 场景实拍 (Scenes): 5 个实机走查场景 × 墨面/纸面双色
 * 2. 特性长图 (Features): 8 张精选架构图解与组件全景墙
 */

type ShowcaseTab = 'scenes' | 'features';
type Face = 'ink' | 'light';

interface Scene {
  id: string;
  num: string;
  title: string;
  lede: string;
}

interface FeatureCard {
  id: string;
  num: string;
  title: string;
  subtitle: string;
  lede: string;
  src: string;
  thumb: string;
}

const scenes: readonly Scene[] = [
  {
    id: 'scene-03-fanout',
    num: '03',
    title: '子代理并行',
    lede: '三块活拆给三个子代理，各自在独立 Git Worktree 里干；进度实时汇报到计划托盘，合不合并由你拍板。',
  },
  {
    id: 'scene-01-endpoint',
    num: '01',
    title: '端上闭环',
    lede: '一句话让 Agent 起 Metro、编 iOS 包、在模拟器里做无障碍断言并截图，全程不抢你的前台窗口。',
  },
  {
    id: 'scene-02-research',
    num: '02',
    title: '理解并沉淀',
    lede: '探索、查资料、跑测试；结论带着验收证据沉淀进项目 Wiki 与记忆，不只停在聊天记录里。',
  },
  {
    id: 'scene-04-tooled',
    num: '04',
    title: '工具家族',
    lede: '浏览器、网页抓取、知识库、进程日志、记忆卡片、图片/视频生成，每类工具都有自己的专有卡片。',
  },
  {
    id: 'scene-05-approval',
    num: '05',
    title: '审批关口',
    lede: '要写项目文档先停下：目标受阻卡讲清原因，计划执行门给出选项，权限条一键放行或拒绝。',
  },
];

const features: readonly FeatureCard[] = [
  {
    id: '01-orchestration',
    num: '01',
    title: '子代理编排',
    subtitle: 'Ultra Code · Fusion · Reviewed Delivery',
    lede: '解决长上下文腐烂与 Token 浪费：只读 Scout 负责侦察，SOTA Lead 把握顶层架构，便宜 Sidekick 机械实现，独立 Worktree 审查合入。',
    src: '/images/promo/features/01-orchestration.jpg',
    thumb: '/images/promo/features/01-orchestration.thumb.jpg',
  },
  {
    id: '02-code-search',
    num: '02',
    title: 'Code Search',
    subtitle: 'Fast-Context 拓扑检索 · 0-Token 污染',
    lede: '逆向 Devin 核心机制，与 grep/read 同级的一等公民工具；只读子代理深入代码库勘探调用关系，仅回传高信噪比提炼摘要。',
    src: '/images/promo/features/02-code-search.jpg',
    thumb: '/images/promo/features/02-code-search.thumb.jpg',
  },
  {
    id: '03-voice',
    num: '03',
    title: '全双工实时语音',
    subtitle: '边聊边写 · 说话面与工作面契约解耦',
    lede: '打破传统“说了就不能点、执行就不能说”的阻塞模式；像真人同事一样结对编程，声音下达需求，终端与编辑器实时同步。',
    src: '/images/promo/features/03-voice.jpg',
    thumb: '/images/promo/features/03-voice.thumb.jpg',
  },
  {
    id: '04-extensions',
    num: '04',
    title: 'Pi 扩展热安装',
    subtitle: 'Agent Runtime 级别热插拔 · 内置扩展市场',
    lede: '内置 pi-deepseek-cache 缓存提速、llm-wiki 知识沉淀与 goal 目标管理；无需重启宿主或重连会话，一键热加载与启用。',
    src: '/images/promo/features/04-extensions.jpg',
    thumb: '/images/promo/features/04-extensions.thumb.jpg',
  },
  {
    id: '05-models',
    num: '05',
    title: '按能力配模型',
    subtitle: '视觉委托 · 思考档位 · 通道与账户分离',
    lede: '主思考用最顶尖 SOTA，读图委托给免费轻量多模态（Gemini/Qwen-VL），通道 Base URL 与官方订阅 OAuth 各司其职。',
    src: '/images/promo/features/05-models.jpg',
    thumb: '/images/promo/features/05-models.thumb.jpg',
  },
  {
    id: '06-onboarding',
    num: '06',
    title: '一键极简配置',
    subtitle: '开箱即用 · 浏览器 OAuth 授权 · 本地密钥保险箱',
    lede: '官方订阅（Kimi、Codex、Claude、Copilot、Devin）一键浏览器扫码/授权登录，凭证仅存放于 Host 本地安全目录，零配置困扰。',
    src: '/images/promo/features/06-onboarding.jpg',
    thumb: '/images/promo/features/06-onboarding.thumb.jpg',
  },
  {
    id: '07-components-dark',
    num: '07',
    title: '墨面组件墙',
    subtitle: '深邃沉静 · 东方文人书斋视觉体系',
    lede: '黑墨深灰底衬、朱砂点缀、金石线条、终端与工具状态一目了然，长时间暗光编码专注不疲劳。',
    src: '/images/promo/features/07-components-dark.jpg',
    thumb: '/images/promo/features/07-components-dark.thumb.jpg',
  },
  {
    id: '08-components-light',
    num: '08',
    title: '纸面组件墙',
    subtitle: '温润舒目 · 宣纸宋体文人雅趣',
    lede: '米白宣纸底色、深褐松烟墨字、红印封泥；双面审美一键切换，白昼伏案更护眼。',
    src: '/images/promo/features/08-components-light.jpg',
    thumb: '/images/promo/features/08-components-light.thumb.jpg',
  },
];

const { isDark } = useData();

// 当前模式：场景实拍 vs 特性图解
const currentTab = ref<ShowcaseTab>('scenes');

// 双面色彩（墨面 / 纸面）
const override = ref<Face | null>(null);
const effectiveFace = computed<Face>(() => override.value ?? (isDark.value ? 'ink' : 'light'));

function setFace(next: Face): void {
  override.value = next;
}

// 选中的场景
const activeSceneId = ref<string>('scene-03-fanout');
const expandedScene = ref(false);

function sceneSrc(id: string, which: Face): string {
  return `/images/promo/${id}${which === 'light' ? '-light' : ''}.jpg`;
}

function sceneThumb(id: string, which: Face): string {
  return `/images/promo/${id}${which === 'light' ? '-light' : ''}.thumb.jpg`;
}

function selectScene(id: string): void {
  activeSceneId.value = id;
  expandedScene.value = false;
}

const activeScene = computed<Scene>(
  () => scenes.find((s) => s.id === activeSceneId.value) ?? scenes[0]!,
);

// 选中的特性长图
const activeFeatureId = ref<string>('01-orchestration');
const expandedFeature = ref(false);

function selectFeature(id: string): void {
  activeFeatureId.value = id;
  expandedFeature.value = false;
}

const activeFeature = computed<FeatureCard>(
  () => features.find((f) => f.id === activeFeatureId.value) ?? features[0]!,
);

// 全屏弹窗看大图
const modalImage = ref<{ src: string; title: string } | null>(null);

function openModal(src: string, title: string): void {
  modalImage.value = { src, title };
}

function closeModal(): void {
  modalImage.value = null;
}
</script>

<template>
  <section class="promo">
    <!-- 顶部封面主视觉 -->
    <a
      class="promo-cover"
      href="/images/promo/cover.jpg"
      target="_blank"
      rel="noreferrer"
      title="点击查看高清封面"
    >
      <img src="/images/promo/cover.jpg" alt="Piwin 砚 · 私有化智能编程工作台" />
      <span class="promo-cover-badge">桌面工作台最新实录</span>
    </a>

    <!-- 模式切换与选项条 -->
    <div class="promo-header-tabs">
      <div class="promo-tab-group" role="tablist">
        <button
          type="button"
          role="tab"
          :aria-selected="currentTab === 'scenes'"
          class="tab-btn"
          :class="{ active: currentTab === 'scenes' }"
          @click="currentTab = 'scenes'"
        >
          <span class="tab-icon">🖥️</span>
          <span>实景走查</span>
          <span class="tab-badge">5 场景</span>
        </button>
        <button
          type="button"
          role="tab"
          :aria-selected="currentTab === 'features'"
          class="tab-btn"
          :class="{ active: currentTab === 'features' }"
          @click="currentTab = 'features'"
        >
          <span class="tab-icon">✨</span>
          <span>特性图解</span>
          <span class="tab-badge">8 张长图</span>
        </button>
      </div>

      <!-- 实景模式下的墨面/纸面切换 -->
      <div v-if="currentTab === 'scenes'" class="promo-controls">
        <span class="promo-controls-label">双面切换：</span>
        <div class="promo-face" role="group" aria-label="界面双面切换">
          <button
            type="button"
            :class="{ on: effectiveFace === 'ink' }"
            @click="setFace('ink')"
          >
            墨面
          </button>
          <button
            type="button"
            :class="{ on: effectiveFace === 'light' }"
            @click="setFace('light')"
          >
            纸面
          </button>
        </div>
        <a
          class="promo-open"
          :href="sceneSrc(activeScene.id, effectiveFace)"
          target="_blank"
          rel="noreferrer"
        >
          查看原图 ↗
        </a>
      </div>

      <!-- 特性图解模式下的原图直达 -->
      <div v-else class="promo-controls">
        <a
          class="promo-open"
          :href="activeFeature.src"
          target="_blank"
          rel="noreferrer"
        >
          查看全高清海报 ↗
        </a>
      </div>
    </div>

    <!-- ================= 模式 1: 场景实拍 ================= -->
    <div v-if="currentTab === 'scenes'" class="promo-content">
      <figure
        class="promo-shot"
        :class="{ capped: !expandedScene }"
        :data-face="override"
      >
        <img
          class="face-ink"
          :src="sceneSrc(activeScene.id, 'ink')"
          :alt="`${activeScene.num} ${activeScene.title} · 墨面`"
          loading="lazy"
        />
        <img
          class="face-light"
          :src="sceneSrc(activeScene.id, 'light')"
          :alt="`${activeScene.num} ${activeScene.title} · 纸面`"
          loading="lazy"
        />
        <button
          v-if="!expandedScene"
          type="button"
          class="promo-expand"
          @click="expandedScene = true"
        >
          展开整张长图 ↓
        </button>
      </figure>

      <div class="promo-lede">
        <div class="promo-lede-title">
          <span class="num-tag">{{ activeScene.num }}</span>
          <b>{{ activeScene.title }}</b>
        </div>
        <p class="promo-lede-text">{{ activeScene.lede }}</p>
      </div>

      <!-- 场景缩略图导航轨 -->
      <div class="promo-rail promo-rail-scenes">
        <button
          v-for="scene in scenes"
          :key="scene.id"
          type="button"
          class="promo-chip"
          :class="{ on: scene.id === activeSceneId }"
          :data-face="override"
          :title="scene.title"
          @click="selectScene(scene.id)"
        >
          <img
            class="face-ink"
            :src="sceneThumb(scene.id, 'ink')"
            :alt="scene.title"
            loading="lazy"
          />
          <img
            class="face-light"
            :src="sceneThumb(scene.id, 'light')"
            :alt="scene.title"
            loading="lazy"
          />
          <span class="promo-chip-num">{{ scene.num }}</span>
          <span class="promo-chip-title">{{ scene.title }}</span>
        </button>
      </div>
    </div>

    <!-- ================= 模式 2: 特性图解 ================= -->
    <div v-else class="promo-content">
      <figure
        class="promo-shot feature-shot"
        :class="{ capped: !expandedFeature }"
      >
        <img
          :src="activeFeature.src"
          :alt="`${activeFeature.num} ${activeFeature.title}`"
          loading="lazy"
        />
        <button
          v-if="!expandedFeature"
          type="button"
          class="promo-expand"
          @click="expandedFeature = true"
        >
          展开整张长图 ↓
        </button>
      </figure>

      <div class="promo-lede">
        <div class="promo-lede-title">
          <span class="num-tag">{{ activeFeature.num }}</span>
          <b>{{ activeFeature.title }}</b>
          <span class="promo-lede-sub">{{ activeFeature.subtitle }}</span>
        </div>
        <p class="promo-lede-text">{{ activeFeature.lede }}</p>
      </div>

      <!-- 特性缩略图导航轨 (8 张卡片) -->
      <div class="promo-rail promo-rail-features">
        <button
          v-for="feat in features"
          :key="feat.id"
          type="button"
          class="promo-chip"
          :class="{ on: feat.id === activeFeatureId }"
          :title="feat.title"
          @click="selectFeature(feat.id)"
        >
          <img :src="feat.thumb" :alt="feat.title" loading="lazy" />
          <span class="promo-chip-num">{{ feat.num }}</span>
          <span class="promo-chip-title">{{ feat.title }}</span>
        </button>
      </div>
    </div>

    <!-- 全屏弹窗查看 -->
    <div
      v-if="modalImage"
      class="promo-modal"
      @click="closeModal"
    >
      <div class="promo-modal-body" @click.stop>
        <div class="promo-modal-bar">
          <span>{{ modalImage.title }}</span>
          <button type="button" @click="closeModal">✕ 关闭</button>
        </div>
        <img :src="modalImage.src" :alt="modalImage.title" />
      </div>
    </div>
  </section>
</template>

<style scoped>
.promo {
  max-width: 1152px;
  margin: 1.5rem auto 3rem;
  padding: 0 24px;
}

/* 顶部封面 */
.promo-cover {
  position: relative;
  display: block;
  border-radius: 14px;
  overflow: hidden;
  border: 1px solid var(--l2);
  box-shadow: var(--sh3);
  transition: border-color 0.2s ease, transform 0.2s ease;
  background: var(--void);
}

.promo-cover:hover {
  border-color: var(--l3);
  transform: translateY(-2px);
}

.promo-cover img {
  display: block;
  width: 100%;
  height: auto;
}

.promo-cover-badge {
  position: absolute;
  top: 14px;
  right: 14px;
  font-family: var(--vp-font-family-mono);
  font-size: 0.72rem;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(29, 27, 23, 0.75);
  color: #fff;
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.15);
}

:global(html:not(.dark)) .promo-cover-badge {
  background: rgba(255, 255, 255, 0.85);
  color: var(--t1);
  border: 1px solid var(--l2);
}

/* 顶部控制栏 */
.promo-header-tabs {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  margin: 28px 0 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--l1);
}

.promo-tab-group {
  display: inline-flex;
  gap: 6px;
  background: var(--s1);
  padding: 4px;
  border-radius: 10px;
  border: 1px solid var(--l2);
}

.tab-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 7px;
  font-size: 0.82rem;
  font-weight: 500;
  color: var(--t3);
  cursor: pointer;
  border: none;
  background: transparent;
  transition: all 0.15s ease;
}

.tab-btn:hover {
  color: var(--t1);
}

.tab-btn.active {
  background: var(--s3);
  color: var(--zhu);
  box-shadow: var(--sh1);
}

.tab-icon {
  font-size: 0.9rem;
}

.tab-badge {
  font-size: 0.65rem;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--l2);
  color: var(--t3);
}

.tab-btn.active .tab-badge {
  background: var(--zhu-wash);
  color: var(--zhu);
}

.promo-controls {
  display: flex;
  align-items: center;
  gap: 10px;
}

.promo-controls-label {
  font-family: var(--vp-font-family-mono);
  font-size: 0.72rem;
  color: var(--t4);
}

.promo-face {
  display: inline-flex;
  padding: 2px;
  gap: 2px;
  border: 1px solid var(--l2);
  border-radius: 6px;
  background: var(--s1);
}

.promo-face button {
  font-family: var(--vp-font-family-mono);
  font-size: 0.72rem;
  padding: 3px 10px;
  border-radius: 4px;
  color: var(--t3);
  cursor: pointer;
  border: none;
  background: transparent;
  transition: all 0.15s ease;
}

.promo-face button.on {
  background: var(--s3);
  color: var(--zhu);
  box-shadow: var(--sh1);
}

.promo-open {
  font-family: var(--vp-font-family-mono);
  font-size: 0.75rem;
  color: var(--t3);
  text-decoration: none;
  transition: color 0.15s ease;
}

.promo-open:hover {
  color: var(--zhu);
}

/* 主展示视口 */
.promo-shot {
  position: relative;
  margin: 0;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid var(--l2);
  box-shadow: var(--sh2);
  background: var(--void);
}

/* 双面图逻辑 */
.promo-shot img,
.promo-chip img {
  display: none;
}

:global(html.dark) .promo-shot .face-ink,
:global(html.dark) .promo-chip .face-ink {
  display: block;
}

:global(html:not(.dark)) .promo-shot .face-light,
:global(html:not(.dark)) .promo-chip .face-light {
  display: block;
}

.promo-shot[data-face='ink'] .face-ink,
.promo-chip[data-face='ink'] .face-ink {
  display: block !important;
}

.promo-shot[data-face='ink'] .face-light,
.promo-chip[data-face='ink'] .face-light {
  display: none !important;
}

.promo-shot[data-face='light'] .face-light,
.promo-chip[data-face='light'] .face-light {
  display: block !important;
}

.promo-shot[data-face='light'] .face-ink,
.promo-chip[data-face='light'] .face-ink {
  display: none !important;
}

/* 特性图解直接显示 */
.feature-shot img {
  display: block !important;
}

.promo-rail-features .promo-chip img {
  display: block !important;
}

.promo-shot img {
  width: 100%;
  height: auto;
  display: block;
}

.promo-shot.capped img {
  max-height: 640px;
  object-fit: cover;
  object-position: top center;
}

.promo-shot.capped::after {
  content: "";
  position: absolute;
  inset: auto 0 0 0;
  height: 140px;
  background: linear-gradient(to bottom, transparent, var(--void));
  opacity: 0.92;
  pointer-events: none;
}

.promo-expand {
  position: absolute;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  z-index: 2;
  font-family: var(--vp-font-family-mono);
  font-size: 0.75rem;
  padding: 6px 18px;
  border-radius: 999px;
  border: 1px solid var(--l2);
  background: var(--s1);
  color: var(--t2);
  cursor: pointer;
  box-shadow: var(--sh2);
  transition: all 0.15s ease;
}

.promo-expand:hover {
  color: var(--zhu);
  border-color: var(--zhu);
  transform: translateX(-50%) translateY(-1px);
}

/* 说明文字 */
.promo-lede {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 16px 0 0;
}

.promo-lede-title {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.num-tag {
  font-family: var(--vp-font-family-mono);
  font-size: 0.72rem;
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--zhu-wash);
  color: var(--zhu);
  font-weight: 600;
}

.promo-lede-title b {
  font-family: var(--font-serif);
  font-size: 1.15rem;
  color: var(--t1);
}

.promo-lede-sub {
  font-size: 0.82rem;
  color: var(--t3);
  font-family: var(--vp-font-family-mono);
}

.promo-lede-text {
  font-size: 0.88rem;
  line-height: 1.65;
  color: var(--t2);
  margin: 0;
}

/* 缩略图横轨 */
.promo-rail {
  display: grid;
  gap: 8px;
  margin-top: 16px;
}

.promo-rail-scenes {
  grid-template-columns: repeat(5, minmax(0, 1fr));
}

.promo-rail-features {
  grid-template-columns: repeat(8, minmax(0, 1fr));
}

.promo-chip {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px;
  border-radius: 8px;
  border: 1px solid var(--l2);
  background: var(--s1);
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease, transform 0.15s ease;
}

.promo-chip:hover {
  border-color: var(--l3);
  background: var(--s3);
  transform: translateY(-1px);
}

.promo-chip.on {
  border-color: var(--zhu);
  background: var(--zhu-wash);
}

.promo-chip img {
  width: 100%;
  height: 60px;
  object-fit: cover;
  object-position: top center;
  border-radius: 5px;
  border: 1px solid var(--l1);
}

.promo-chip-num {
  font-family: var(--vp-font-family-mono);
  font-size: 0.62rem;
  color: var(--t4);
}

.promo-chip-title {
  font-size: 0.72rem;
  line-height: 1.25;
  color: var(--t3);
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.promo-chip.on .promo-chip-title {
  color: var(--zhu);
  font-weight: 500;
}

/* 弹窗预览 */
.promo-modal {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(10px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.promo-modal-body {
  max-width: 90vw;
  max-height: 90vh;
  background: var(--s2);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: var(--sh3);
  border: 1px solid var(--l3);
  display: flex;
  flex-direction: column;
}

.promo-modal-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 16px;
  border-bottom: 1px solid var(--l2);
  font-size: 0.85rem;
  color: var(--t2);
}

.promo-modal-bar button {
  background: none;
  border: none;
  color: var(--t3);
  cursor: pointer;
  font-size: 0.85rem;
}

.promo-modal-bar button:hover {
  color: var(--zhu);
}

.promo-modal-body img {
  max-width: 100%;
  max-height: calc(90vh - 50px);
  object-fit: contain;
}

@media (max-width: 960px) {
  .promo-rail-features {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .promo-header-tabs {
    flex-direction: column;
    align-items: flex-start;
  }
  .promo-rail-scenes {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .promo-rail-features {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .promo-shot.capped img {
    max-height: 380px;
  }
}
</style>
