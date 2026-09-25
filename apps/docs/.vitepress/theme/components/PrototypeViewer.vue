<script setup lang="ts">
import { ref, computed } from 'vue';

interface Prototype {
  id: string;
  name: string;
  desc: string;
  url: string;
  isMobile?: boolean;
}

const prototypes: Prototype[] = [
  {
    id: 'shell',
    name: '桌面端工作台',
    desc: 'Inkstone 旗舰主工作台：支持纸面/墨面双模式、会话流、右侧审查器与工具卡片。',
    url: '/inkstone/proto-00-shell.html',
  },
  {
    id: 'mobile',
    name: '随身砚移动端 v3',
    desc: '触控与窄屏优化原型：抽屉式菜单、长任务状态流与审批交互。',
    url: '/inkstone/inkstone-mobile-shell-v3.html',
    isMobile: true,
  },
  {
    id: 'subagents',
    name: '异步多子代理',
    desc: '多子代理并行调度工作台：任务切片、独立 Worktree 与汇总托盘。',
    url: '/inkstone/proto-11-async-subagents.html',
  },
  {
    id: 'transcript',
    name: '会话与排版',
    desc: '沉浸式阅读与排版原型：代码高亮、步骤折叠与信息分层。',
    url: '/inkstone/proto-01-transcript.html',
  },
  {
    id: 'settings',
    name: '设置与偏好',
    desc: '配置管理面板：模型通道绑定、权限规则与快捷键定义。',
    url: '/inkstone/proto-05-settings.html',
  },
  {
    id: 'components',
    name: '原子组件墙',
    desc: 'Inkstone 规范原子组件库：按钮、标签、浮层与书口线设计。',
    url: '/inkstone/proto-07-components.html',
  },
];

const activeId = ref<string>('shell');

const currentProto = computed(() => {
  return prototypes.find((p) => p.id === activeId.value) || prototypes[0]!;
});
</script>

<template>
  <div class="prototype-viewer">
    <!-- 顶部选项卡 -->
    <div class="viewer-tabs">
      <button
        v-for="proto in prototypes"
        :key="proto.id"
        type="button"
        class="tab-btn"
        :class="{ 'is-active': activeId === proto.id }"
        @click="activeId = proto.id"
      >
        {{ proto.name }}
      </button>
    </div>

    <!-- 当前原型说明与操作条 -->
    <div class="viewer-toolbar">
      <div class="toolbar-info">
        <h3 class="proto-title">{{ currentProto.name }}</h3>
        <p class="proto-desc">{{ currentProto.desc }}</p>
      </div>
      <div class="toolbar-actions">
        <a
          :href="currentProto.url"
          target="_blank"
          rel="noopener noreferrer"
          class="open-full-btn"
        >
          全屏独立打开 ↗
        </a>
      </div>
    </div>

    <!-- 交互预览视口 -->
    <div class="preview-container" :class="{ 'preview-mobile-wrap': currentProto.isMobile }">
      <div class="preview-frame-box" :class="{ 'frame-mobile': currentProto.isMobile }">
        <iframe
          :src="currentProto.url"
          class="preview-iframe"
          title="Inkstone 交互原型预览"
          loading="lazy"
        ></iframe>
      </div>
    </div>
  </div>
</template>

<style scoped>
.prototype-viewer {
  margin: 1.5rem 0 3rem;
  color: var(--t1);
}

/* 选项卡栏 */
.viewer-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--l2);
  margin-bottom: 16px;
}

.tab-btn {
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 0.88rem;
  font-weight: 500;
  background: var(--s2);
  border: 1px solid var(--l2);
  color: var(--t2);
  cursor: pointer;
  transition: all 0.15s ease;
}

.tab-btn:hover {
  background: var(--s1);
  color: var(--t1);
}

.tab-btn.is-active {
  background: var(--zhu);
  color: var(--on-zhu);
  border-color: var(--zhu);
}

/* 说明与工具栏 */
.viewer-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.proto-title {
  font-size: 1.15rem;
  font-weight: 600;
  margin: 0 0 4px;
  color: var(--t1);
}

.proto-desc {
  font-size: 0.86rem;
  color: var(--t3);
  margin: 0;
}

.open-full-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--zhu);
  text-decoration: none;
  padding: 6px 12px;
  border: 1px solid var(--zhu);
  border-radius: 6px;
  transition: all 0.15s ease;
}

.open-full-btn:hover {
  background: var(--zhu-wash);
}

/* 预览容器 */
.preview-container {
  width: 100%;
  background: var(--s2);
  border: 1px solid var(--l2);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: var(--sh1);
}

.preview-mobile-wrap {
  display: flex;
  justify-content: center;
  padding: 24px 16px;
  background: var(--s1);
}

.preview-frame-box {
  width: 100%;
  height: 760px;
  background: var(--s4);
}

.preview-frame-box.frame-mobile {
  width: 390px;
  max-width: 100%;
  height: 800px;
  border-radius: 28px;
  border: 8px solid var(--s3);
  box-shadow: var(--sh3);
  overflow: hidden;
}

.preview-iframe {
  width: 100%;
  height: 100%;
  border: none;
  display: block;
}
</style>
