<script setup lang="ts">
import OrchestrationFlow from './OrchestrationFlow.vue';

interface Principle {
  title: string;
  text: string;
}

const principles: readonly Principle[] = [
  { title: '隔离噪声', text: '高噪声的搜索与试读留在 scout 的子上下文，主上下文只收压缩后的证据。' },
  { title: '集中判断', text: '架构、歧义与终审始终由 Lead 负责，便宜模型只承担已定方案的机械实现。' },
  { title: '单写者', text: '同一时刻只有一个 sidekick 在独立 worktree 里写代码，改动可审、可回滚。' },
  { title: '验证成流', text: '审查与测试各自产出独立证据；tester 在后台快照里跑，不阻塞你的反馈。' },
];
</script>

<template>
  <section class="home-orch">
    <header v-reveal class="home-orch-head">
      <span class="home-orch-kicker">AUTO 智能编排</span>
      <h2>一句话需求，如何变成可审查的交付</h2>
      <p>
        Auto 不是多角色扮演，而是一套由 Host 执行的工程协议。下图按真实协议绘制，点选任一阶段查看这一步发生了什么。
      </p>
    </header>

    <div v-reveal="80">
      <OrchestrationFlow />
    </div>

    <div class="home-orch-principles">
      <div
        v-for="(principle, index) in principles"
        :key="principle.title"
        v-reveal="index * 70"
        class="home-orch-principle"
      >
        <span class="home-orch-index">{{ String(index + 1).padStart(2, '0') }}</span>
        <b>{{ principle.title }}</b>
        <p>{{ principle.text }}</p>
      </div>
    </div>

    <a v-reveal class="home-orch-more" href="/docs/auto-orchestration">
      <span>
        <b>设计笔记 · Auto 智能编排：一种 Lead 驱动的多智能体执行协议</b>
        <small>为什么先写 Goal、上下文污染从何而来、为什么写操作必须单线程</small>
      </span>
      <span class="home-orch-arrow" aria-hidden="true">阅读全文 →</span>
    </a>
  </section>
</template>

<style scoped>
.home-orch {
  max-width: 1152px;
  margin: 4.5rem auto 0;
  padding: 0 24px;
}

.home-orch-head {
  max-width: 720px;
  margin: 0 auto 28px;
  text-align: center;
}

.home-orch-kicker {
  font: 600 0.72rem var(--vp-font-family-mono);
  letter-spacing: 0.18em;
  color: var(--zhu);
}

.home-orch-head h2 {
  margin: 10px 0 10px;
  padding: 0;
  border: none;
  font-family: var(--font-serif);
  font-size: 1.75rem;
  font-weight: 600;
  line-height: 1.35;
  letter-spacing: -0.01em;
  color: var(--t1);
}

.home-orch-head h2::before {
  display: none;
}

.home-orch-head p {
  margin: 0;
  font-size: 0.95rem;
  line-height: 1.7;
  color: var(--t3);
}

.home-orch-principles {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
  margin-top: 16px;
}

.home-orch-principle {
  padding: 16px 18px;
  border-radius: 12px;
  border: 1px solid var(--l2);
  background: var(--s1);
}

.home-orch-index {
  display: block;
  margin-bottom: 8px;
  font: 600 0.72rem var(--vp-font-family-mono);
  color: var(--zhu);
  letter-spacing: 0.06em;
}

.home-orch-principle b {
  font-family: var(--font-serif);
  font-size: 1.02rem;
  color: var(--t1);
}

.home-orch-principle p {
  margin: 6px 0 0;
  font-size: 0.83rem;
  line-height: 1.65;
  color: var(--t3);
}

.home-orch-more {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 14px;
  padding: 16px 20px;
  border-radius: 12px;
  border: 1px solid var(--l2);
  background: var(--s3);
  box-shadow: var(--sh1);
  text-decoration: none;
  transition: border-color 0.18s ease, transform 0.18s ease, box-shadow 0.18s ease;
}

.home-orch-more:hover {
  border-color: var(--zhu);
  transform: translateY(-2px);
  box-shadow: var(--sh2);
  text-decoration: none;
}

.home-orch-more b {
  display: block;
  font-family: var(--font-serif);
  font-size: 1rem;
  color: var(--t1);
}

.home-orch-more small {
  display: block;
  margin-top: 3px;
  font-size: 0.82rem;
  font-weight: 400;
  color: var(--t3);
}

.home-orch-arrow {
  flex-shrink: 0;
  font: 500 0.8rem var(--vp-font-family-mono);
  color: var(--zhu);
  transition: transform 0.18s ease;
}

.home-orch-more:hover .home-orch-arrow {
  transform: translateX(3px);
}

@media (max-width: 960px) {
  .home-orch-principles {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 560px) {
  .home-orch-head h2 {
    font-size: 1.4rem;
  }

  .home-orch-principles {
    grid-template-columns: 1fr;
  }

  .home-orch-more {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
