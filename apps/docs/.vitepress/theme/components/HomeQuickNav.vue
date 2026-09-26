<script setup lang="ts">
interface NavCard {
  num: string;
  title: string;
  desc: string;
  link: string;
}

const cards: readonly NavCard[] = [
  {
    num: '01',
    title: 'Code Search 代码检索',
    desc: 'Devin Fast-Context 逆向架构，0-Token 上下文污染拓扑梳理',
    link: '/docs/code-search',
  },
  {
    num: '02',
    title: '子代理编排 (Ultra & Fusion)',
    desc: 'Scout 只读探路，Lead 规划 + Sidekick 机械执行，Worktree 隔离合入',
    link: '/docs/subagent-orchestration',
  },
  {
    num: '03',
    title: '全双工实时语音 Live',
    desc: '边聊边写，说话面与工作面契约解耦，像真人结对一样丝滑协作',
    link: '/docs/realtime-voice',
  },
  {
    num: '04',
    title: 'Artifact 渲染与画布',
    desc: 'Inline 行内微预览与 Canvas 大报告分屏画布，所见即所得沙箱',
    link: '/docs/artifact-rendering',
  },
  {
    num: '05',
    title: '扩展生态与 MCP 推荐',
    desc: '内置 pi-deepseek-cache 缓存提速、llm-wiki 与 goal，支持运行时热插拔',
    link: '/docs/extensions',
  },
  {
    num: '06',
    title: '权限策略与安全拦截',
    desc: 'YOLO 极速运行 + Allowlist 规则引擎，底层硬核拦截 rm -rf 高危指令',
    link: '/docs/permissions',
  },
  {
    num: '07',
    title: '知识库与多媒体资料库',
    desc: 'LLM-Wiki 知识切片、划词提炼闪卡，出图与视频资产统一本地沉淀',
    link: '/docs/knowledge-and-media',
  },
  {
    num: '08',
    title: '实机体验与特性画廊',
    desc: '8 大特性图解长图、5 大端上走查场景与组件墙全景高清展示',
    link: '/docs/gallery',
  },
];
</script>

<template>
  <section class="home-quick-nav">
    <div class="quick-nav-header">
      <h3 class="serif">核心能力导航 · 研墨深耕</h3>
      <p>Piwin 构筑于 Pi 内核之上，具备清晰分层、独立 Host 权威、多端解耦契约以及模块化扩展生态。</p>
    </div>

    <div class="quick-cards">
      <a
        v-for="card in cards"
        :key="card.title"
        :href="card.link"
        class="quick-card"
      >
        <div class="card-header">
          <span class="card-num">{{ card.num }}</span>
          <b class="card-title">{{ card.title }}</b>
          <span class="card-arrow">↗</span>
        </div>
        <p class="card-desc">{{ card.desc }}</p>
      </a>
    </div>

    <!-- GitHub 官方开源地址 -->
    <div class="home-github-bar">
      <div class="github-bar-left">
        <svg class="github-icon" viewBox="0 0 24 24" width="22" height="22">
          <path fill="currentColor" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/>
        </svg>
        <div class="github-bar-text">
          <b>开源代码仓库 · GitHub</b>
          <span>面向个人的本地 Coding Agent，欢迎 Star 支持与参与共建</span>
        </div>
      </div>
      <div class="github-bar-actions">
        <a
          href="https://github.com/mimimaster/piwin"
          target="_blank"
          rel="noreferrer"
          class="github-btn-primary"
        >
          <span>github.com/mimimaster/piwin</span>
          <span class="btn-arrow">↗</span>
        </a>
        <a
          href="https://github.com/mimimaster"
          target="_blank"
          rel="noreferrer"
          class="github-btn-secondary"
        >
          作者 @mimimaster ↗
        </a>
      </div>
    </div>

    <!-- LINUX DO 社区特别致谢 -->
    <div class="home-community-bar">
      <div class="community-bar-left">
        <span class="community-badge">特别致谢</span>
        <div class="community-bar-text">
          <b>LINUX DO 社区 · 新的理想型社区</b>
          <span>衷心感谢 LINUX DO (linux.do) 社区伙伴们在早期探索、架构讨论与 Agent 实战中的真诚反馈与极客支持</span>
        </div>
      </div>
      <div class="community-bar-actions">
        <a
          href="https://linux.do"
          target="_blank"
          rel="noreferrer"
          class="community-btn-primary"
        >
          <span>访问 linux.do</span>
          <span class="btn-arrow">↗</span>
        </a>
      </div>
    </div>
  </section>
</template>

<style scoped>
.home-quick-nav {
  max-width: 1152px;
  margin: 2.5rem auto 4rem;
  padding: 0 24px;
}

.quick-nav-header {
  text-align: center;
  margin-bottom: 24px;
}

.quick-nav-header h3 {
  font-family: var(--font-serif);
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--t1);
  margin: 0 0 8px;
}

.quick-nav-header p {
  font-size: 0.92rem;
  color: var(--t3);
  margin: 0;
  line-height: 1.6;
}

.quick-cards {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.quick-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 18px 20px;
  border-radius: 12px;
  border: 1px solid var(--l2);
  background: var(--s1);
  text-decoration: none;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.quick-card:hover {
  border-color: var(--zhu);
  background: var(--s3);
  transform: translateY(-2px);
  box-shadow: var(--sh2);
}

.card-header {
  display: flex;
  align-items: center;
  gap: 10px;
}

.card-num {
  font-family: var(--vp-font-family-mono);
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--zhu);
  background: var(--s2);
  border: 1px solid var(--l1);
  padding: 2px 7px;
  border-radius: 6px;
  letter-spacing: 0.05em;
  flex-shrink: 0;
}

.card-title {
  font-family: var(--font-sans);
  font-size: 0.98rem;
  font-weight: 600;
  color: var(--t1);
  flex: 1;
  transition: color 0.15s ease;
}

.quick-card:hover .card-title {
  color: var(--zhu);
}

.card-arrow {
  font-size: 0.88rem;
  color: var(--t4);
  transition: transform 0.15s ease, color 0.15s ease;
}

.quick-card:hover .card-arrow {
  color: var(--zhu);
  transform: translate(2px, -2px);
}

.card-desc {
  font-size: 0.84rem;
  color: var(--t3);
  line-height: 1.55;
  margin: 0;
}


/* GitHub 官方栏目 */
.home-github-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 16px;
  margin-top: 24px;
  padding: 16px 20px;
  border-radius: 12px;
  border: 1px solid var(--l2);
  background: var(--s2);
  box-shadow: var(--sh1);
}

.github-bar-left {
  display: flex;
  align-items: center;
  gap: 14px;
}

.github-icon {
  color: var(--t1);
  flex-shrink: 0;
}

.github-bar-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.github-bar-text b {
  font-size: 0.95rem;
  color: var(--t1);
}

.github-bar-text span {
  font-size: 0.8rem;
  color: var(--t3);
}

.github-bar-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.github-btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 8px;
  background: var(--zhu);
  color: var(--on-zhu);
  font-family: var(--vp-font-family-mono);
  font-size: 0.78rem;
  font-weight: 500;
  text-decoration: none;
  transition: all 0.15s ease;
}

.github-btn-primary:hover {
  background: var(--zhu-lift);
  transform: translateY(-1px);
}

.github-btn-secondary {
  display: inline-flex;
  align-items: center;
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid var(--l2);
  background: var(--s1);
  color: var(--t2);
  font-family: var(--vp-font-family-mono);
  font-size: 0.78rem;
  text-decoration: none;
  transition: all 0.15s ease;
}

.github-btn-secondary:hover {
  border-color: var(--zhu);
  color: var(--zhu);
}

/* LINUX DO 社区致谢栏目 */
.home-community-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 16px;
  margin-top: 14px;
  padding: 16px 20px;
  border-radius: 12px;
  border: 1px solid var(--l2);
  background: var(--s2);
  box-shadow: var(--sh1);
}

.community-bar-left {
  display: flex;
  align-items: center;
  gap: 14px;
}

.community-badge {
  font-family: var(--font-serif);
  font-size: 0.76rem;
  font-weight: 600;
  color: #c6412a;
  background: rgba(198, 65, 42, 0.08);
  border: 1px solid rgba(198, 65, 42, 0.2);
  padding: 3px 8px;
  border-radius: 6px;
  white-space: nowrap;
  flex-shrink: 0;
}

.community-bar-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.community-bar-text b {
  font-size: 0.95rem;
  color: var(--t1);
}

.community-bar-text span {
  font-size: 0.8rem;
  color: var(--t3);
  line-height: 1.45;
}

.community-bar-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.community-btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 8px;
  border: 1px solid var(--l2);
  background: var(--s1);
  color: var(--t2);
  font-family: var(--vp-font-family-mono);
  font-size: 0.78rem;
  font-weight: 500;
  text-decoration: none;
  transition: all 0.15s ease;
}

.community-btn-primary:hover {
  border-color: #c6412a;
  color: #c6412a;
  transform: translateY(-1px);
}

@media (max-width: 720px) {
  .quick-cards {
    grid-template-columns: 1fr;
  }
  .home-github-bar,
  .home-community-bar {
    flex-direction: column;
    align-items: flex-start;
  }
  .github-bar-actions,
  .community-bar-actions {
    width: 100%;
    justify-content: flex-start;
  }
}
</style>
