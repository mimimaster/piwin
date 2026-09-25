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
    id: '01-extensions',
    num: '01',
    title: 'Pi 扩展热安装',
    subtitle: '市场 / Git / 本地一键装 · 下一轮即生效',
    lede: '正在跑的任务不会被打断：当前 Run 结束后，下一轮对话自动挂载新扩展；会话树和聊天记录原样保留，无需重启客户端。',
    src: '/images/readme/extensions.jpg',
    thumb: '/images/readme/extensions.thumb.jpg',
  },
  {
    id: '02-orchestration',
    num: '02',
    title: '子代理编排',
    subtitle: 'Ultra Code · Fusion · Reviewed Delivery',
    lede: '输入框一键切换：Ultra Code 派只读 Scout 探路防上下文腐烂；Fusion 用 Lead 规划 + Sidekick 机械执行；Reviewed 独立 Worktree 产出审查。',
    src: '/images/readme/orchestration.jpg',
    thumb: '/images/readme/orchestration.thumb.jpg',
  },
  {
    id: '03-voice',
    num: '03',
    title: '全双工实时语音',
    subtitle: '边聊边写 · 说话面与工作面解耦',
    lede: '说话面负责实时交流与方案探讨，随时插话打断；需要改代码跑测试时自动交接给后台 Agent 执行，做完用简短一句话汇报。',
    src: '/images/readme/voice.jpg',
    thumb: '/images/readme/voice.thumb.jpg',
  },
  {
    id: '04-models',
    num: '04',
    title: '按能力类型配模型',
    subtitle: '推理 / 视觉 / 生图 / 视频 / 语音 / Reranker 分开配',
    lede: '按“这个模型用来干什么”细粒度配置。接入方式支持任意 OpenAI 兼容端点（BYOK）或 OAuth 官方订阅，改完下一轮自动生效。',
    src: '/images/readme/models.jpg',
    thumb: '/images/readme/models.thumb.jpg',
  },
  {
    id: '05-web-search',
    num: '05',
    title: 'Web Search 一键配置',
    subtitle: '免 Key 起步 · 搜索源与网页抓取随时切',
    lede: '支持 DuckDuckGo（免 Key 开箱即用）、Brave、Tavily、Devin 或本机 CLI；配合 supermarkdown、Jina、Firecrawl 抓取清洗。',
    src: '/images/readme/web-search.jpg',
    thumb: '/images/readme/web-search.thumb.jpg',
  },
  {
    id: '06-vision',
    num: '06',
    title: '视觉委托',
    subtitle: '纯文本模型也能看图 · 省 70~90% 上下文 Token',
    lede: '给纯文本或昂贵推理模型挂轻量多模态模型：粘贴截图自动 OCR + 特征提炼，主模型只收精简文字结论，省时省钱。',
    src: '/images/readme/vision.jpg',
    thumb: '/images/readme/vision.thumb.jpg',
  },
  {
    id: '07-code-search',
    num: '07',
    title: 'code_search',
    subtitle: 'Host 内置检索工具 · 0-Token 上下文污染',
    lede: '与 read/grep 同级的内置工具，参考 Devin Fast-Context 实现：检索在独立只读过程中完成，只把命中路径和定义回传主会话。',
    src: '/images/readme/code-search.jpg',
    thumb: '/images/readme/code-search.thumb.jpg',
  },
  {
    id: '08-knowledge',
    num: '08',
    title: '知识库与重排',
    subtitle: 'Embedding 与 Reranker 独立配置',
    lede: '支持 LanceDB 本地向量库、文本分片、语义重排序（Rerank）与 FSRS 记忆检索，支撑专业级领域知识管理。',
    src: '/images/readme/knowledge.jpg',
    thumb: '/images/readme/knowledge.thumb.jpg',
  },
  {
    id: '09-marketplace',
    num: '09',
    title: '扩展市场',
    subtitle: '内置 / Pi 原生 / 社区扩展 · 标注兼容程度',
    lede: '浏览与搜索海量扩展，清晰标注 Agent 工具、事件 Hook 与桌面 UI 兼容状态，支持一键安装与平滑启用。',
    src: '/images/readme/marketplace.jpg',
    thumb: '/images/readme/marketplace.thumb.jpg',
  },
  {
    id: '10-wiki',
    num: '10',
    title: '知识中心 LLM Wiki',
    subtitle: '网状关联与衍生闪卡 · 知识资产沉淀',
    lede: '依据 Karpathy LLM-Wiki 模式，自动萃取概念词条、构建双向网状关联，并在对话中随时划词提炼记忆闪卡。',
    src: '/images/readme/knowledge-wiki.jpg',
    thumb: '/images/readme/knowledge-wiki.thumb.jpg',
  },
  {
    id: '11-library',
    num: '11',
    title: '多媒体资料库',
    subtitle: '生成的图片 / 视频集中管理',
    lede: '所有通过 image_gen 与 video_gen 工具生成的本地资产统一沉淀在 ~/.piwin/media/，完整保留提示词与来源会话。',
    src: '/images/readme/library.jpg',
    thumb: '/images/readme/library.thumb.jpg',
  },
  {
    id: '12-usage',
    num: '12',
    title: '用量统计看板',
    subtitle: '缓存命中率、活跃度热力图与逐次调用明细',
    lede: '全通道模型 Token 消耗、前缀缓存（Prompt Cache）命中率与费用透明可视化，每一分钱花在哪里一清二楚。',
    src: '/images/readme/usage.jpg',
    thumb: '/images/readme/usage.thumb.jpg',
  },
  {
    id: '13-components',
    num: '13',
    title: '出厂组件一览',
    subtitle: '东方文人美学组件与工坊全景',
    lede: '精心设计的双面主题组件墙：墨面深邃沉静、纸面温润舒目，兼具实用交互质感与典雅美学。',
    src: '/images/readme/components.jpg',
    thumb: '/images/readme/components.thumb.jpg',
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
      <img class="promo-cover-img" src="/images/promo/cover.jpg" alt="Piwin 砚 · 私有化智能编程工作台" />
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
      >
        <img
          class="promo-main-img"
          :key="`${activeScene.id}-${effectiveFace}`"
          :src="sceneSrc(activeScene.id, effectiveFace)"
          :alt="`${activeScene.num} ${activeScene.title} · ${effectiveFace === 'ink' ? '墨面' : '纸面'}`"
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
          :title="scene.title"
          @click="selectScene(scene.id)"
        >
          <img
            class="promo-chip-img"
            :src="sceneThumb(scene.id, effectiveFace)"
            :alt="scene.title"
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
          class="promo-main-img"
          :key="activeFeature.id"
          :src="activeFeature.src"
          :alt="`${activeFeature.num} ${activeFeature.title}`"
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
          <img class="promo-chip-img" :src="feat.thumb" :alt="feat.title" />
          <span class="promo-chip-num">{{ feat.num }}</span>
          <span class="promo-chip-title">{{ feat.title }}</span>
        </button>
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

.promo-cover-img {
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

.promo-main-img {
  display: block;
  width: 100%;
  height: auto;
}

.promo-shot.capped .promo-main-img {
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

.promo-chip-img {
  display: block;
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
  .promo-shot.capped .promo-main-img {
    max-height: 380px;
  }
}
</style>
