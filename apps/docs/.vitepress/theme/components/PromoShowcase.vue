<script setup lang="ts">
import { computed, ref } from 'vue';

/**
 * 宣传展台组件 (PromoShowcase)
 *
 * 采用“同行两张图片并排对照 (Side-by-side)”设计：
 * 1. 场景实景走查：左侧「墨面」+ 右侧「纸面」同排双面走查，一览东方文人书斋审美；
 * 2. 核心特色双屏：对齐 README 核心 7 组配对，每组展示 2 张高清实机界面（50% 宽度，Retina 超清遮瑕）；
 * 3. 资产均使用 2400px / 3408px 本地高分原图，消除大屏模糊。
 */

type ShowcaseTab = 'scenes' | 'features';

interface Scene {
  id: string;
  num: string;
  title: string;
  lede: string;
}

interface FeatureGroup {
  id: string;
  num: string;
  title: string;
  subtitle: string;
  lede: string;
  leftTitle: string;
  leftSrc: string;
  rightTitle: string;
  rightSrc: string;
  thumb: string;
}

const scenes: readonly Scene[] = [
  {
    id: 'scene-03-fanout',
    num: '01',
    title: '子代理并行 (Fanout)',
    lede: '三块活拆给三个子代理，各自在独立 Git Worktree 里干；进度实时汇报到计划托盘，合不合并由你拍板。',
  },
  {
    id: 'scene-01-endpoint',
    num: '02',
    title: '端上闭环 (Endpoint)',
    lede: '一句话让 Agent 起 Metro、编 iOS 包、在模拟器里做无障碍断言并截图，全程不抢你的前台窗口。',
  },
  {
    id: 'scene-02-research',
    num: '03',
    title: '理解并沉淀 (Research & Wiki)',
    lede: '探索、查资料、跑测试；结论带着验收证据沉淀进项目 Wiki 与记忆，不只停在聊天记录里。',
  },
  {
    id: 'scene-04-tooled',
    num: '04',
    title: '工具家族 (Tooled Pipeline)',
    lede: '浏览器、网页抓取、知识库、进程日志、记忆卡片、图片/视频生成，每类工具都有专有可视化卡片。',
  },
  {
    id: 'scene-05-approval',
    num: '05',
    title: '审批关口 (Gate & Permission)',
    lede: '要写项目文档先停下：目标受阻卡讲清原因，计划执行门给出选项，权限条一键放行或拒绝。',
  },
];

const featureGroups: readonly FeatureGroup[] = [
  {
    id: 'group-extensions',
    num: '01',
    title: '扩展生态与市场',
    subtitle: '热插拔挂载 · 扩展市场全览',
    lede: '正在跑的任务不会被打断：当前 Run 结束后，下一轮对话自动挂载新扩展；会话树和聊天记录原样保留，扩展市场提供兼容性透明标注。',
    leftTitle: '1 · Pi 扩展热安装设置',
    leftSrc: '/images/readme/extensions.jpg',
    rightTitle: '扩展市场：内置 / Pi 原生 / 社区',
    rightSrc: '/images/readme/marketplace.jpg',
    thumb: '/images/readme/extensions.thumb.jpg',
  },
  {
    id: 'group-orchestration',
    num: '02',
    title: '子代理编排与全双工语音',
    subtitle: 'Ultra Code · Fusion · 实时结对协作',
    lede: '在输入框中一键切换方案：Ultra Code 派只读 Scout 探路防上下文腐烂；Fusion 用 Lead 规划 + Sidekick 机械执行；全双工语音说话面与工作面契约解耦，边聊边写。',
    leftTitle: '2 · 子代理编排：输入框一键切换方案',
    leftSrc: '/images/readme/orchestration.jpg',
    rightTitle: '3 · 全双工语音：通话中 Agent 在后台工作',
    rightSrc: '/images/readme/voice.jpg',
    thumb: '/images/readme/orchestration.thumb.jpg',
  },
  {
    id: 'group-models',
    num: '03',
    title: '按能力配模型与视觉委托',
    subtitle: 'BYOK 接入 · 视觉提炼降本 70%+',
    lede: '按“这个模型用来干什么”细粒度配置。给纯文本或昂贵推理模型挂轻量多模态模型看图，截图自动 OCR + 特征提炼，主模型只收精简文本结论。',
    leftTitle: '4 · 按能力类型配模型',
    leftSrc: '/images/readme/models.jpg',
    rightTitle: '6 · 视觉委托设置',
    rightSrc: '/images/readme/vision.jpg',
    thumb: '/images/readme/models.thumb.jpg',
  },
  {
    id: 'group-search',
    num: '04',
    title: '代码检索与网络搜索',
    subtitle: 'code_search · Web Search 一键配置',
    lede: 'code_search 与 read/grep 同级的 Host 内置工具，检索在独立只读进程完成，0-Token 污染主上下文；Web Search 支持 DuckDuckGo 免 Key 开箱即用与专用清洗服务。',
    leftTitle: '7 · code_search 设置',
    leftSrc: '/images/readme/code-search.jpg',
    rightTitle: '5 · Web Search 一键配置',
    rightSrc: '/images/readme/web-search.jpg',
    thumb: '/images/readme/code-search.thumb.jpg',
  },
  {
    id: 'group-knowledge',
    num: '05',
    title: '知识中心与向量重排',
    subtitle: 'LLM-Wiki 网状关联 · 记忆闪卡沉淀',
    lede: 'LanceDB 本地向量库、Embedding / Reranker 独立配置；依据 Karpathy LLM-Wiki 模式自动萃取概念词条、构建双向网状关联，对话中随时划词提炼闪卡。',
    leftTitle: '知识库：Embedding / Reranker 单独配置',
    leftSrc: '/images/readme/knowledge.jpg',
    rightTitle: '知识中心：LLM Wiki 词条与衍生闪卡',
    rightSrc: '/images/readme/knowledge-wiki.jpg',
    thumb: '/images/readme/knowledge.thumb.jpg',
  },
  {
    id: 'group-ops',
    num: '06',
    title: '资料库与用量统计',
    subtitle: '多媒体本地托管 · 逐次消耗明细',
    lede: '所有通过 image_gen 与 video_gen 生成的资产统一保存在 ~/.piwin/media/，保留提示词与溯源上下文；用量统计看板实时监控全通道消耗与前缀缓存命中率。',
    leftTitle: '资料库：图片 / 视频集中管理',
    leftSrc: '/images/readme/library.jpg',
    rightTitle: '用量统计：缓存命中率与调用明细',
    rightSrc: '/images/readme/usage.jpg',
    thumb: '/images/readme/library.thumb.jpg',
  },
  {
    id: 'group-components',
    num: '07',
    title: '桌面全景与出厂组件',
    subtitle: '东方文人美学 · 双面书斋全貌',
    lede: '沉静深邃的「墨面」与温润舒目的「纸面」，会话树、Composer 统一输入、子代理状态卡、代码差异对比与终端运行监视器开箱即用。',
    leftTitle: '桌面工作台全景实拍',
    leftSrc: '/images/readme/hero.jpg',
    rightTitle: 'Piwin 出厂组件一览',
    rightSrc: '/images/readme/components.jpg',
    thumb: '/images/readme/hero.thumb.jpg',
  },
];

// 当前模式：实景双面走查 vs 核心特色双屏
const currentTab = ref<ShowcaseTab>('scenes');

// 选中的场景
const activeSceneId = ref<string>('scene-03-fanout');
const expandedScene = ref(false);

function sceneSrc(id: string, which: 'ink' | 'light'): string {
  return `/images/promo/${id}${which === 'light' ? '-light' : ''}.jpg`;
}

function sceneThumb(id: string): string {
  return `/images/promo/${id}.thumb.jpg`;
}

function selectScene(id: string): void {
  activeSceneId.value = id;
  expandedScene.value = false;
}

const activeScene = computed<Scene>(
  () => scenes.find((s) => s.id === activeSceneId.value) ?? scenes[0]!,
);

// 选中的特性双图组
const activeGroupId = ref<string>('group-extensions');
const expandedGroup = ref(false);

function selectGroup(id: string): void {
  activeGroupId.value = id;
  expandedGroup.value = false;
}

const activeGroup = computed<FeatureGroup>(
  () => featureGroups.find((g) => g.id === activeGroupId.value) ?? featureGroups[0]!,
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
      <img
        class="promo-cover-img"
        src="/images/promo/cover.jpg"
        alt="Piwin 砚 · 面向个人的本地 Coding Agent 工作台"
      />
      <span class="promo-cover-badge">桌面工作台最新实录 · 东方文人美学</span>
    </a>

    <!-- 模式切换选项条 -->
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
          <span>实景双面走查</span>
          <span class="tab-badge">墨面 + 纸面同排</span>
        </button>
        <button
          type="button"
          role="tab"
          :aria-selected="currentTab === 'features'"
          class="tab-btn"
          :class="{ active: currentTab === 'features' }"
          @click="currentTab = 'features'"
        >
          <span>核心特色实录</span>
          <span class="tab-badge">7 组双图对照</span>
        </button>
      </div>

      <div class="promo-hint">
        <span>同行双图并排展示 · 点击原图可查阅高分原画 ↗</span>
      </div>
    </div>

    <!-- ================= 模式 1: 实景双面走查 (同行展示墨面与纸面) ================= -->
    <div v-if="currentTab === 'scenes'" class="promo-content">
      <div class="promo-dual-wrap" :class="{ capped: !expandedScene }">
        <div class="promo-dual-grid">
          <!-- 左图：墨面 -->
          <div class="dual-card">
            <div class="dual-header">
              <span class="dual-tag tag-ink">墨面 · 沉静专注</span>
              <a
                :href="sceneSrc(activeScene.id, 'ink')"
                target="_blank"
                rel="noreferrer"
                class="dual-zoom"
              >
                高分原图 ↗
              </a>
            </div>
            <div class="dual-img-box">
              <img
                class="dual-img"
                :key="`${activeScene.id}-ink`"
                :src="sceneSrc(activeScene.id, 'ink')"
                :alt="`${activeScene.title} · 墨面`"
              />
            </div>
          </div>

          <!-- 右图：纸面 -->
          <div class="dual-card">
            <div class="dual-header">
              <span class="dual-tag tag-light">纸面 · 温润舒目</span>
              <a
                :href="sceneSrc(activeScene.id, 'light')"
                target="_blank"
                rel="noreferrer"
                class="dual-zoom"
              >
                高分原图 ↗
              </a>
            </div>
            <div class="dual-img-box">
              <img
                class="dual-img"
                :key="`${activeScene.id}-light`"
                :src="sceneSrc(activeScene.id, 'light')"
                :alt="`${activeScene.title} · 纸面`"
              />
            </div>
          </div>
        </div>

        <button
          v-if="!expandedScene"
          type="button"
          class="promo-expand"
          @click="expandedScene = true"
        >
          展开双面完整长图 ↓
        </button>
      </div>

      <div class="promo-lede">
        <div class="promo-lede-title">
          <span class="num-tag">{{ activeScene.num }}</span>
          <b>{{ activeScene.title }}</b>
        </div>
        <p class="promo-lede-text">{{ activeScene.lede }}</p>
      </div>

      <!-- 场景缩略图导航轨 -->
      <div class="promo-rail">
        <button
          v-for="scene in scenes"
          :key="scene.id"
          type="button"
          class="promo-chip"
          :class="{ on: scene.id === activeSceneId }"
          :title="scene.title"
          @click="selectScene(scene.id)"
        >
          <img class="promo-chip-img" :src="sceneThumb(scene.id)" :alt="scene.title" />
          <span class="promo-chip-num">{{ scene.num }}</span>
          <span class="promo-chip-title">{{ scene.title }}</span>
        </button>
      </div>
    </div>

    <!-- ================= 模式 2: 核心特色双屏 (同行展示两张特性截图) ================= -->
    <div v-else class="promo-content">
      <div class="promo-dual-wrap" :class="{ capped: !expandedGroup }">
        <div class="promo-dual-grid">
          <!-- 左图 -->
          <div class="dual-card">
            <div class="dual-header">
              <span class="dual-tag">{{ activeGroup.leftTitle }}</span>
              <a
                :href="activeGroup.leftSrc"
                target="_blank"
                rel="noreferrer"
                class="dual-zoom"
              >
                高分原图 ↗
              </a>
            </div>
            <div class="dual-img-box">
              <img
                class="dual-img"
                :key="activeGroup.leftSrc"
                :src="activeGroup.leftSrc"
                :alt="activeGroup.leftTitle"
              />
            </div>
          </div>

          <!-- 右图 -->
          <div class="dual-card">
            <div class="dual-header">
              <span class="dual-tag">{{ activeGroup.rightTitle }}</span>
              <a
                :href="activeGroup.rightSrc"
                target="_blank"
                rel="noreferrer"
                class="dual-zoom"
              >
                高分原图 ↗
              </a>
            </div>
            <div class="dual-img-box">
              <img
                class="dual-img"
                :key="activeGroup.rightSrc"
                :src="activeGroup.rightSrc"
                :alt="activeGroup.rightTitle"
              />
            </div>
          </div>
        </div>

        <button
          v-if="!expandedGroup"
          type="button"
          class="promo-expand"
          @click="expandedGroup = true"
        >
          展开双屏完整实录 ↓
        </button>
      </div>

      <div class="promo-lede">
        <div class="promo-lede-title">
          <span class="num-tag">{{ activeGroup.num }}</span>
          <b>{{ activeGroup.title }}</b>
          <span class="promo-lede-sub">{{ activeGroup.subtitle }}</span>
        </div>
        <p class="promo-lede-text">{{ activeGroup.lede }}</p>
      </div>

      <!-- 特性双图缩略轨 (7 组卡片) -->
      <div class="promo-rail">
        <button
          v-for="grp in featureGroups"
          :key="grp.id"
          type="button"
          class="promo-chip"
          :class="{ on: grp.id === activeGroupId }"
          :title="grp.title"
          @click="selectGroup(grp.id)"
        >
          <img class="promo-chip-img" :src="grp.thumb" :alt="grp.title" />
          <span class="promo-chip-num">{{ grp.num }}</span>
          <span class="promo-chip-title">{{ grp.title }}</span>
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

.tab-badge {
  font-size: 0.68rem;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--l2);
  color: var(--t3);
}

.tab-btn.active .tab-badge {
  background: var(--zhu-wash);
  color: var(--zhu);
}

.promo-hint {
  font-size: 0.76rem;
  color: var(--t4);
  font-family: var(--vp-font-family-mono);
}

/* 双图同行网格 */
.promo-dual-wrap {
  position: relative;
  margin-bottom: 20px;
}

.promo-dual-wrap.capped {
  max-height: 520px;
  overflow: hidden;
}

.promo-dual-wrap.capped::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 120px;
  background: linear-gradient(to bottom, transparent, var(--void));
  pointer-events: none;
}

.promo-dual-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.dual-card {
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid var(--l2);
  background: var(--s1);
  box-shadow: var(--sh1);
}

.dual-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: var(--s2);
  border-bottom: 1px solid var(--l1);
}

.dual-tag {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--t2);
}

.tag-ink {
  color: #d1cfc7;
}

:global(html:not(.dark)) .tag-ink {
  color: #3f3931;
}

.tag-light {
  color: var(--zhu);
}

.dual-zoom {
  font-family: var(--vp-font-family-mono);
  font-size: 0.72rem;
  color: var(--t4);
  text-decoration: none;
  transition: color 0.15s ease;
}

.dual-zoom:hover {
  color: var(--zhu);
}

.dual-img-box {
  width: 100%;
  overflow: hidden;
  background: var(--void);
}

.dual-img {
  display: block;
  width: 100%;
  height: auto;
  transition: transform 0.2s ease;
}

.dual-card:hover .dual-img {
  transform: scale(1.01);
}

/* 展开按钮 */
.promo-expand {
  position: absolute;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  z-index: 2;
  font-family: var(--vp-font-family-mono);
  font-size: 0.78rem;
  padding: 8px 20px;
  border-radius: 999px;
  border: 1px solid var(--l3);
  background: var(--s2);
  color: var(--t1);
  cursor: pointer;
  box-shadow: var(--sh3);
  transition: all 0.15s ease;
}

.promo-expand:hover {
  background: var(--s3);
  border-color: var(--zhu);
  color: var(--zhu);
  transform: translateX(-50%) translateY(-2px);
}

/* 文本导语 */
.promo-lede {
  margin: 18px 0 16px;
  padding: 14px 18px;
  border-radius: 10px;
  background: var(--s1);
  border: 1px solid var(--l1);
}

.promo-lede-title {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
}

.num-tag {
  font-family: var(--vp-font-family-mono);
  font-size: 0.72rem;
  padding: 2px 7px;
  border-radius: 5px;
  background: var(--zhu-wash);
  color: var(--zhu);
  border: 1px solid rgba(185, 56, 44, 0.25);
}

.promo-lede-title b {
  font-size: 1rem;
  color: var(--t1);
}

.promo-lede-sub {
  font-size: 0.8rem;
  color: var(--t3);
}

.promo-lede-text {
  font-size: 0.86rem;
  color: var(--t3);
  line-height: 1.6;
  margin: 0;
}

/* 缩略图横轨 */
.promo-rail {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 10px;
  margin-top: 14px;
}

.promo-chip {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 6px;
  border-radius: 8px;
  border: 1px solid var(--l2);
  background: var(--s1);
  cursor: pointer;
  text-align: left;
  transition: all 0.15s ease;
}

.promo-chip:hover {
  border-color: var(--l3);
  background: var(--s2);
}

.promo-chip.on {
  border-color: var(--zhu);
  background: var(--s3);
  box-shadow: var(--sh1);
}

.promo-chip-img {
  width: 100%;
  aspect-ratio: 16 / 10;
  object-fit: cover;
  border-radius: 5px;
  margin-bottom: 6px;
  background: var(--void);
}

.promo-chip-num {
  font-family: var(--vp-font-family-mono);
  font-size: 0.68rem;
  color: var(--t4);
  margin-bottom: 2px;
}

.promo-chip.on .promo-chip-num {
  color: var(--zhu);
}

.promo-chip-title {
  font-size: 0.78rem;
  font-weight: 500;
  color: var(--t2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  width: 100%;
}

.promo-chip.on .promo-chip-title {
  color: var(--t1);
  font-weight: 600;
}

@media (max-width: 768px) {
  .promo-dual-grid {
    grid-template-columns: 1fr;
  }
  .promo-rail {
    grid-template-columns: repeat(3, 1fr);
  }
}
</style>
