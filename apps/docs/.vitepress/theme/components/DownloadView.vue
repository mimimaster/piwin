<script setup lang="ts">
const releasesUrl = 'https://github.com/mimimaster/piwin/releases';
</script>

<template>
  <div class="download-container">
    <header class="download-header">
      <h1 class="serif title">客户端下载</h1>
      <p class="subtitle">选择适合您系统的安装包，开箱即用。</p>
    </header>

    <div class="download-grid">
      <!-- macOS -->
      <div class="download-card">
        <h2 class="platform-name">macOS</h2>
        <div class="platform-meta">
          <p class="version">最低要求：macOS 12.0 及以上</p>
          <p class="note warn">仅支持 Apple Silicon（M1 / M2 / M3 / M4 芯片），暂不支持 Intel 处理器</p>
        </div>
        <a :href="releasesUrl" target="_blank" rel="noopener noreferrer" class="btn btn-primary">
          下载 .dmg
        </a>
      </div>

      <!-- Windows -->
      <div class="download-card">
        <h2 class="platform-name">Windows</h2>
        <div class="platform-meta">
          <p class="version">最低要求：Windows 10 (1809+) / Windows 11</p>
          <p class="note">64 位系统，需 Microsoft Edge WebView2 运行时</p>
        </div>
        <a :href="releasesUrl" target="_blank" rel="noopener noreferrer" class="btn btn-primary">
          下载安装包 (.exe)
        </a>
      </div>

      <!-- iOS -->
      <div class="download-card card-disabled">
        <div class="card-head">
          <h2 class="platform-name">iOS</h2>
          <span class="badge-pending">暂未上线</span>
        </div>
        <div class="platform-meta">
          <p class="version">适配系统：iOS 16.0 及以上</p>
          <p class="note">移动端随身任务看板，正在内测中，敬请期待</p>
        </div>
        <button type="button" disabled class="btn btn-disabled">
          暂未上线
        </button>
      </div>
    </div>

    <div class="download-footer">
      <span>查看全部历史版本与源码：</span>
      <a :href="releasesUrl" target="_blank" rel="noopener noreferrer">
        GitHub Releases ↗
      </a>
    </div>
  </div>
</template>

<style scoped>
.download-container {
  max-width: 960px;
  margin: 0 auto;
  padding: 3rem 20px 5rem;
  color: var(--t1);
}

.download-header {
  text-align: center;
  margin-bottom: 2.5rem;
}

.title {
  font-family: var(--font-serif);
  font-size: 2.2rem;
  font-weight: 700;
  margin: 0 0 0.5rem;
  color: var(--t1);
}

.subtitle {
  font-size: 1rem;
  color: var(--t3);
  margin: 0;
}

.download-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  margin-bottom: 2.5rem;
}

@media (max-width: 840px) {
  .download-grid {
    grid-template-columns: 1fr;
    max-width: 420px;
    margin-left: auto;
    margin-right: auto;
  }
}

.download-card {
  background: var(--s3);
  border: 1px solid var(--l2);
  border-radius: 10px;
  padding: 22px;
  display: flex;
  flex-direction: column;
}

.card-disabled {
  background: var(--s2);
}

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.platform-name {
  font-size: 1.25rem;
  font-weight: 600;
  margin: 0;
  color: var(--t1);
}

.badge-pending {
  font-size: 0.72rem;
  color: var(--lamp);
  background: var(--lamp-wash);
  padding: 2px 6px;
  border-radius: 4px;
  font-weight: 500;
}

.platform-meta {
  margin: 14px 0 20px;
  flex: 1;
}

.version {
  font-size: 0.85rem;
  color: var(--t2);
  margin: 0 0 4px;
}

.note {
  font-size: 0.8rem;
  color: var(--t3);
  margin: 0;
  line-height: 1.45;
}

.note.warn {
  color: var(--zhu);
}

.btn {
  display: block;
  width: 100%;
  text-align: center;
  padding: 10px 14px;
  border-radius: 6px;
  font-size: 0.88rem;
  font-weight: 500;
  text-decoration: none;
  border: none;
  cursor: pointer;
  box-sizing: border-box;
}

.btn-primary {
  background: var(--zhu);
  color: var(--on-zhu) !important;
  transition: opacity 0.15s ease;
}

.btn-primary:hover {
  opacity: 0.9;
}

.btn-disabled {
  background: var(--s1);
  color: var(--t4);
  cursor: not-allowed;
  border: 1px solid var(--l2);
}

.download-footer {
  text-align: center;
  font-size: 0.88rem;
  color: var(--t3);
  padding-top: 1.5rem;
  border-top: 1px solid var(--l2);
}

.download-footer a {
  color: var(--zhu);
  text-decoration: none;
}

.download-footer a:hover {
  text-decoration: underline;
}
</style>
