---
layout: home

hero:
  name: "Piwin · 砚"
  text: "私有化 AI 智能体工作台"
  tagline: "单一 Host 权威 · 零上下文污染检索 · 子代理并行编排 · 砚墨宣纸文人美学"
  image:
    src: /logo.png
    alt: Piwin 桌面端图标
  actions:
    - theme: brand
      text: 快速起步概览
      link: /docs/getting-started
    - theme: alt
      text: 架构与设计愿景
      link: /docs/about
    - theme: alt
      text: 特性画廊
      link: /docs/gallery

features:
  - title: 砚石宣纸 · 双面美学
    details: 融入东方文人书斋气质，提供温润舒目的「纸面」与深邃沉静的「墨面」，辅以朱砂红印与金石书口线。
  - title: 智能体语义代码搜索
    details: 基于 Devin Fast-Context 逆向与 Scout 架构，只读子代理深入代码库勘探，实现 0 上下文污染的代码拓扑检索。
  - title: 子代理协同编排 · 内置 Ultra / Fusion
    details: 输入框一键切换编排方案：Ultra Code 先派 Scout 只读侦察摸清依赖，Fusion 用 Lead 规划审查 + Sidekick 执行节点分工推进，主会话只留结论。
  - title: 极速视觉委托架构
    details: 主思考模型与快速视觉模型分工协作，大幅降低 Token 消耗与响应延迟，支持本地及云端各类多模态模型。
  - title: 全双工实时语音 Live
    details: 说话面与工作面契约解耦，还原像真人结对编程一样“边语音探讨、边下达指令、边写代码”的沉浸式体验。
  - title: 纯私有化多端生态
    details: 开箱即用一体包（macOS/Windows）、Web 远程自适应与 iOS 壳子，代码与状态 100% 留在本地机器。
---

<PromoShowcase />

<div class="home-quick-nav">
  <div class="quick-nav-header">
    <h3 class="serif">核心能力导航 · 研墨深耕</h3>
    <p>Piwin 构筑于 Pi 内核之上，具备清晰分层、独立 Host 权威、多端解耦契约以及模块化扩展生态。</p>
  </div>

  <div class="quick-cards">
    <a href="/docs/code-search" class="quick-card">
      <div class="card-icon">🔍</div>
      <div class="card-content">
        <b>Code Search 代码检索</b>
        <span>Devin Fast-Context 逆向架构，0-Token 上下文污染拓扑梳理</span>
      </div>
    </a>

    <a href="/docs/subagent-orchestration" class="quick-card">
      <div class="card-icon">⚡</div>
      <div class="card-content">
        <b>子代理编排 (Ultra & Fusion)</b>
        <span>Scout 只读探路，Lead 规划 + Sidekick 机械执行，Worktree 隔离合入</span>
      </div>
    </a>

    <a href="/docs/realtime-voice" class="quick-card">
      <div class="card-icon">🎙️</div>
      <div class="card-content">
        <b>全双工实时语音 Live</b>
        <span>边聊边写，说话面与工作面契约解耦，像真人结对一样丝滑协作</span>
      </div>
    </a>

    <a href="/docs/artifact-rendering" class="quick-card">
      <div class="card-icon">🎨</div>
      <div class="card-content">
        <b>Artifact 渲染与画布</b>
        <span>Inline 行内微预览与 Canvas 大报告分屏画布，所见即所得沙箱</span>
      </div>
    </a>

    <a href="/docs/extensions" class="quick-card">
      <div class="card-icon">🧩</div>
      <div class="card-content">
        <b>扩展生态与 MCP 推荐</b>
        <span>内置 pi-deepseek-cache 缓存提速、llm-wiki 与 goal，支持运行时热插拔</span>
      </div>
    </a>

    <a href="/docs/permissions" class="quick-card">
      <div class="card-icon">🛡️</div>
      <div class="card-content">
        <b>权限策略与安全拦截</b>
        <span>YOLO 极速运行 + Allowlist 规则引擎，底层硬核拦截 rm -rf 高危指令</span>
      </div>
    </a>

    <a href="/docs/knowledge-and-media" class="quick-card">
      <div class="card-icon">📚</div>
      <div class="card-content">
        <b>知识库与多媒体资料库</b>
        <span>LLM-Wiki 知识切片、划词提炼闪卡，出图与视频资产统一本地沉淀</span>
      </div>
    </a>

    <a href="/docs/gallery" class="quick-card">
      <div class="card-icon">🖼️</div>
      <div class="card-content">
        <b>实机体验与特性画廊</b>
        <span>8 大特性图解长图、5 大端上走查场景与组件墙全景高清展示</span>
      </div>
    </a>
  </div>
</div>

<style>
.home-quick-nav {
  max-width: 1152px;
  margin: 2rem auto 4rem;
  padding: 0 24px;
}

.quick-nav-header {
  text-align: center;
  margin-bottom: 24px;
}

.quick-nav-header h3 {
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--t1);
  margin-bottom: 8px;
}

.quick-nav-header p {
  font-size: 0.92rem;
  color: var(--t3);
  margin: 0;
}

.quick-cards {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.quick-card {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 16px;
  border-radius: 10px;
  border: 1px solid var(--l2);
  background: var(--s1);
  text-decoration: none;
  transition: all 0.2s ease;
}

.quick-card:hover {
  border-color: var(--zhu);
  background: var(--s3);
  transform: translateY(-2px);
  box-shadow: var(--sh2);
}

.card-icon {
  font-size: 1.5rem;
  line-height: 1;
  padding: 8px;
  border-radius: 8px;
  background: var(--s2);
  border: 1px solid var(--l1);
}

.card-content {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.card-content b {
  font-size: 0.95rem;
  color: var(--t1);
  font-weight: 600;
}

.quick-card:hover .card-content b {
  color: var(--zhu);
}

.card-content span {
  font-size: 0.8rem;
  color: var(--t3);
  line-height: 1.45;
}

@media (max-width: 720px) {
  .quick-cards {
    grid-template-columns: 1fr;
  }
}
</style>
