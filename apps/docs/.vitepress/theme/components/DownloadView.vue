<script setup lang="ts">
import { ref, onMounted } from 'vue';

type DetectedOs = 'macos' | 'windows' | 'ios' | 'other';

const currentOs = ref<DetectedOs>('macos');
const copiedText = ref<string | null>(null);

onMounted(() => {
  if (typeof window !== 'undefined' && window.navigator) {
    const ua = window.navigator.userAgent.toLowerCase();
    if (/iphone|ipad|ipod/.test(ua)) {
      currentOs.value = 'ios';
    } else if (/win/.test(ua)) {
      currentOs.value = 'windows';
    } else if (/mac/.test(ua)) {
      currentOs.value = 'macos';
    } else {
      currentOs.value = 'other';
    }
  }
});

function copyToClipboard(text: string) {
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => {
      copiedText.value = text;
      setTimeout(() => {
        if (copiedText.value === text) {
          copiedText.value = null;
        }
      }, 2000);
    });
  }
}

const releasesUrl = 'https://github.com/mimimaster/piwin/releases';
const webview2Url = 'https://developer.microsoft.com/zh-cn/microsoft-edge/webview2/';
</script>

<template>
  <div class="download-container">
    <!-- 极简 Hero 标头 -->
    <header class="download-header">
      <h1 class="serif title">客户端下载</h1>
      <p class="subtitle">选择适合您设备的版本，开箱即用，开启智能编程结对体验</p>
    </header>

    <!-- 三栏平台卡片：macOS / Windows / iOS -->
    <div class="cards-grid">
      <!-- 1. macOS -->
      <div class="card" :class="{ 'is-active': currentOs === 'macos' }">
        <div class="card-top">
          <div class="os-icon">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
              <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 4.88c.61-.74 1.02-1.77.91-2.8-.88.04-1.95.59-2.58 1.33-.55.64-1.03 1.68-.9 2.69 1 .08 2-.48 2.57-1.22z"/>
            </svg>
          </div>
          <div>
            <div class="card-title-row">
              <h2 class="card-title">macOS</h2>
              <span v-if="currentOs === 'macos'" class="badge-accent">当前系统</span>
            </div>
            <span class="card-version">v0.1.0 · Apple Silicon 原生</span>
          </div>
        </div>

        <!-- 版本限制说明 -->
        <div class="spec-list">
          <div class="spec-row">
            <span class="spec-label">系统版本：</span>
            <span class="spec-val">macOS 12.0 及更高版本</span>
          </div>
          <div class="spec-row">
            <span class="spec-label">硬件架构：</span>
            <span class="spec-val highlight-warn">仅支持 Apple Silicon（M1/M2/M3/M4）</span>
          </div>
          <div class="spec-row">
            <span class="spec-label">架构限制：</span>
            <span class="spec-val note-text">Intel 芯片 Mac 暂未支持</span>
          </div>
        </div>

        <!-- 下载行动按钮 -->
        <div class="action-wrap">
          <a
            :href="releasesUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="btn btn-primary"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            <span>下载 macOS 版 (.dmg)</span>
          </a>
        </div>

        <!-- 极简门禁提示 -->
        <div class="helper-box">
          <p class="helper-text">首次打开如提示无法验证开发者：</p>
          <div class="code-copy-row">
            <code>xattr -cr /Applications/Piwin.app</code>
            <button
              type="button"
              class="copy-btn"
              @click="copyToClipboard('xattr -cr /Applications/Piwin.app')"
            >
              {{ copiedText === 'xattr -cr /Applications/Piwin.app' ? '已复制' : '复制' }}
            </button>
          </div>
        </div>
      </div>

      <!-- 2. Windows -->
      <div class="card" :class="{ 'is-active': currentOs === 'windows' }">
        <div class="card-top">
          <div class="os-icon icon-win">
            <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor">
              <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4h-13.051M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-13.051-1.899"/>
            </svg>
          </div>
          <div>
            <div class="card-title-row">
              <h2 class="card-title">Windows</h2>
              <span v-if="currentOs === 'windows'" class="badge-accent">当前系统</span>
            </div>
            <span class="card-version">v0.1.0 · 64 位版本</span>
          </div>
        </div>

        <!-- 版本限制说明 -->
        <div class="spec-list">
          <div class="spec-row">
            <span class="spec-label">系统版本：</span>
            <span class="spec-val">Windows 10 (1809+) / Windows 11</span>
          </div>
          <div class="spec-row">
            <span class="spec-label">硬件架构：</span>
            <span class="spec-val">64 位处理器 (x86_64)</span>
          </div>
          <div class="spec-row">
            <span class="spec-label">依赖要求：</span>
            <span class="spec-val note-text">需 Microsoft Edge WebView2</span>
          </div>
        </div>

        <!-- 下载行动按钮 -->
        <div class="action-wrap">
          <a
            :href="releasesUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="btn btn-primary"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            <span>下载 Windows 安装包 (.exe / .msi)</span>
          </a>
          <a
            :href="releasesUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="btn btn-sub"
          >
            <span>下载绿色便携版 (.zip) ↗</span>
          </a>
        </div>

        <!-- 极简依赖提示 -->
        <div class="helper-box">
          <p class="helper-text">
            Win 11 已自带 WebView2；如遇白屏或缺失提示：
            <a :href="webview2Url" target="_blank" rel="noopener noreferrer" class="helper-link">
              下载微软官方运行时 ↗
            </a>
          </p>
        </div>
      </div>

      <!-- 3. iOS (暂未上线) -->
      <div class="card card-disabled">
        <div class="card-top">
          <div class="os-icon icon-ios">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
              <path d="M17 1.01L7 1c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-1.99-2-1.99zM17 19H7V5h10v14zm-1-6h-3V8h-2v5H8l4 4 4-4z"/>
            </svg>
          </div>
          <div>
            <div class="card-title-row">
              <h2 class="card-title">iOS 移动端</h2>
              <span class="badge-pending">暂未上线</span>
            </div>
            <span class="card-version text-amber">研发中 · 即将开启 TestFlight</span>
          </div>
        </div>

        <!-- 版本限制说明 -->
        <div class="spec-list">
          <div class="spec-row">
            <span class="spec-label">适配系统：</span>
            <span class="spec-val">iOS 16.0 及以上版本</span>
          </div>
          <div class="spec-row">
            <span class="spec-label">设备类型：</span>
            <span class="spec-val">iPhone 与 iPad</span>
          </div>
          <div class="spec-row">
            <span class="spec-label">核心定位：</span>
            <span class="spec-val note-text">随身看板、安全拦截确认与任务推送</span>
          </div>
        </div>

        <!-- 禁用状态按钮 -->
        <div class="action-wrap">
          <button type="button" disabled class="btn btn-disabled">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            <span>暂未上线 · 敬请期待</span>
          </button>
        </div>

        <!-- 极简说明 -->
        <div class="helper-box">
          <p class="helper-text">
            iOS 移动伴侣正在进行稳定性测试。当前可先行使用手机 Safari 浏览器直连远端 Host 的 Web 端。
          </p>
        </div>
      </div>
    </div>

    <!-- 底部极简指引 -->
    <div class="bottom-bar">
      <span>查看所有历史包与源码：</span>
      <a :href="releasesUrl" target="_blank" rel="noopener noreferrer" class="link-zhu">
        GitHub Releases ↗
      </a>
      <span class="dot-sep">·</span>
      <a href="/docs/getting-started" class="link-sub">
        快速上手配置指南 →
      </a>
    </div>
  </div>
</template>

<style scoped>
.download-container {
  max-width: 1080px;
  margin: 0 auto;
  padding: 3rem 20px 5rem;
  color: var(--t1);
}

.download-header {
  text-align: center;
  margin-bottom: 3rem;
}

.title {
  font-family: var(--font-serif);
  font-size: 2.3rem;
  font-weight: 700;
  margin: 0 0 0.75rem;
  color: var(--t1);
}

.subtitle {
  font-size: 1.05rem;
  color: var(--t3);
  margin: 0;
}

/* 三列卡片布局 */
.cards-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
  margin-bottom: 3rem;
}

@media (max-width: 960px) {
  .cards-grid {
    grid-template-columns: 1fr;
    max-width: 480px;
    margin-left: auto;
    margin-right: auto;
  }
}

.card {
  background: var(--s3);
  border: 1px solid var(--l2);
  border-radius: 14px;
  padding: 24px;
  display: flex;
  flex-direction: column;
  box-shadow: var(--sh1);
  transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
}

.card:hover {
  transform: translateY(-2px);
  box-shadow: var(--sh2);
  border-color: var(--l3);
}

.card.is-active {
  border-color: var(--zhu);
  box-shadow: 0 0 0 2px var(--zhu-wash), var(--sh2);
}

.card-disabled {
  background: var(--s2);
  opacity: 0.92;
}

/* 卡片顶部 */
.card-top {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 18px;
}

.os-icon {
  width: 48px;
  height: 48px;
  border-radius: 10px;
  background: var(--s1);
  border: 1px solid var(--l2);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--t1);
  flex-shrink: 0;
}

.icon-win {
  color: #0078d7;
  background: rgba(0, 120, 215, 0.08);
  border-color: rgba(0, 120, 215, 0.2);
}

.icon-ios {
  color: var(--lamp);
  background: var(--lamp-wash);
  border-color: rgba(184, 128, 31, 0.25);
}

.card-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.card-title {
  font-size: 1.25rem;
  font-weight: 600;
  margin: 0;
  color: var(--t1);
}

.card-version {
  font-size: 0.8rem;
  color: var(--t3);
  display: block;
  margin-top: 2px;
}

.text-amber {
  color: var(--lamp);
  font-weight: 500;
}

.badge-accent {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--on-zhu);
  background: var(--zhu);
  padding: 1px 7px;
  border-radius: 4px;
}

.badge-pending {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--lamp);
  background: var(--lamp-wash);
  border: 1px solid rgba(184, 128, 31, 0.3);
  padding: 1px 7px;
  border-radius: 4px;
}

/* 规格与版本限制列表 */
.spec-list {
  background: var(--s1);
  border-radius: 8px;
  padding: 12px 14px;
  margin-bottom: 20px;
  font-size: 0.82rem;
  display: flex;
  flex-direction: column;
  gap: 6px;
  border: 1px solid var(--l1);
}

.spec-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  line-height: 1.4;
}

.spec-label {
  color: var(--t3);
  flex-shrink: 0;
}

.spec-val {
  color: var(--t1);
  font-weight: 500;
  text-align: right;
}

.highlight-warn {
  color: var(--zhu);
  font-weight: 600;
}

.note-text {
  color: var(--t3);
  font-weight: normal;
}

/* 按钮区 */
.action-wrap {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 16px;
}

.btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 11px 16px;
  border-radius: 8px;
  font-size: 0.9rem;
  font-weight: 500;
  text-decoration: none;
  cursor: pointer;
  transition: all 0.15s ease;
  border: 1px solid transparent;
}

.btn-primary {
  background: var(--zhu);
  color: var(--on-zhu) !important;
}

.btn-primary:hover {
  background: var(--zhu-lift);
}

.btn-sub {
  background: transparent;
  color: var(--t2) !important;
  font-size: 0.82rem;
  padding: 6px 12px;
}

.btn-sub:hover {
  color: var(--zhu) !important;
}

.btn-disabled {
  background: var(--s1);
  color: var(--t4);
  border-color: var(--l2);
  cursor: not-allowed;
}

/* 极简提示框 */
.helper-box {
  margin-top: auto;
  padding: 10px 12px;
  background: var(--s2);
  border: 1px solid var(--l1);
  border-radius: 6px;
}

.helper-text {
  font-size: 0.78rem;
  color: var(--t3);
  margin: 0;
  line-height: 1.45;
}

.helper-link {
  color: var(--zhu);
  text-decoration: underline;
}

.code-copy-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 6px;
  background: var(--s1);
  padding: 4px 8px;
  border-radius: 4px;
}

.code-copy-row code {
  font-family: var(--vp-font-family-mono);
  font-size: 0.75rem;
  color: var(--zhu);
}

.copy-btn {
  font-size: 0.72rem;
  background: var(--s3);
  border: 1px solid var(--l2);
  color: var(--t2);
  padding: 2px 6px;
  border-radius: 4px;
  cursor: pointer;
}

.copy-btn:hover {
  color: var(--zhu);
}

/* 底部精简条 */
.bottom-bar {
  text-align: center;
  font-size: 0.9rem;
  color: var(--t3);
  padding-top: 1.5rem;
  border-top: 1px solid var(--l2);
}

.link-zhu {
  color: var(--zhu);
  font-weight: 500;
  text-decoration: none;
}

.link-zhu:hover {
  text-decoration: underline;
}

.link-sub {
  color: var(--t2);
  text-decoration: none;
}

.link-sub:hover {
  color: var(--zhu);
}

.dot-sep {
  margin: 0 10px;
  color: var(--l3);
}
</style>
