<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

interface ReleaseAsset {
  file: string;
  url: string;
  size: number;
  sha256: string;
}

interface ReleaseEntry {
  version: string;
  kind: 'formal' | 'patch';
  date: string;
  notes: { title: string; items: string[] }[];
  assets: Record<string, ReleaseAsset>;
}

interface ReleaseManifest {
  latest: Record<string, ReleaseAsset & { version: string }>;
  releases: ReleaseEntry[];
}

// 安装包发布在带版本号的固定地址，这份清单是唯一会变的文件：
// 发版只更新清单，文档站不用重新构建。
const DOWNLOAD_ORIGIN = 'https://dl.piwinwin.com';
const MANIFEST_URL = `${DOWNLOAD_ORIGIN}/releases.json`;
const MAC_PLATFORM = 'macos-aarch64';
const WINDOWS_PLATFORM = 'windows-x64';
// 清单读到之前（或读不到时）按钮仍然可用。
const FALLBACK_URLS: Record<string, string> = {
  [MAC_PLATFORM]: `${DOWNLOAD_ORIGIN}/piwinwin_0.0.0_aarch64.dmg?v=59cdb22b`,
  [WINDOWS_PLATFORM]: `${DOWNLOAD_ORIGIN}/piwinwin_0.0.0_x64-setup.exe?v=fd5da357`,
};
const RECENT_RELEASE_COUNT = 5;
const releasesUrl = 'https://github.com/mimimaster/piwin/releases';

const manifest = ref<ReleaseManifest>();
const showAllReleases = ref(false);

function isReleaseManifest(value: unknown): value is ReleaseManifest {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<ReleaseManifest>;
  return Array.isArray(candidate.releases) && typeof candidate.latest === 'object' && candidate.latest !== null;
}

// 只接受自家下载域名下的地址，清单被污染时也不会把按钮指到别处。
function trustedUrl(url: string | undefined): string | undefined {
  return url?.startsWith(`${DOWNLOAD_ORIGIN}/`) ? url : undefined;
}

function formatSize(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}

function latestFor(platform: string) {
  const latest = manifest.value?.latest[platform];
  const url = trustedUrl(latest?.url);
  if (!latest || !url) return { url: FALLBACK_URLS[platform], caption: undefined, sha256Url: undefined };
  return {
    url,
    caption: `v${latest.version} · ${formatSize(latest.size)}`,
    sha256Url: `${url}.sha256`,
  };
}

const mac = computed(() => latestFor(MAC_PLATFORM));
const windows = computed(() => latestFor(WINDOWS_PLATFORM));
const releases = computed(() => manifest.value?.releases ?? []);
const visibleReleases = computed(() =>
  showAllReleases.value ? releases.value : releases.value.slice(0, RECENT_RELEASE_COUNT),
);
const hiddenReleaseCount = computed(() => releases.value.length - visibleReleases.value.length);

function assetLinks(release: ReleaseEntry) {
  return [
    { label: 'macOS (.dmg)', url: trustedUrl(release.assets[MAC_PLATFORM]?.url) },
    { label: 'Windows (.exe)', url: trustedUrl(release.assets[WINDOWS_PLATFORM]?.url) },
  ].filter((link): link is { label: string; url: string } => link.url !== undefined);
}

onMounted(async () => {
  try {
    const response = await fetch(MANIFEST_URL);
    if (!response.ok) return;
    const body: unknown = await response.json();
    if (isReleaseManifest(body)) manifest.value = body;
  } catch {
    // 读不到清单就保留兜底链接，页面本身不该因此报错。
  }
});
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
          <p class="note warn">暂时只支持 M 系列芯片</p>
        </div>
        <a :href="mac.url" class="btn btn-primary">
          下载 .dmg
        </a>
        <p v-if="mac.caption" class="build-caption">
          {{ mac.caption }} · <a :href="mac.sha256Url">SHA-256</a>
        </p>
      </div>

      <!-- Windows -->
      <div class="download-card">
        <h2 class="platform-name">Windows</h2>
        <div class="platform-meta">
          <p class="version">最低要求：Windows 10 (1809+) / Windows 11</p>
          <p class="note">64 位系统，需 Microsoft Edge WebView2 运行时</p>
        </div>
        <a :href="windows.url" class="btn btn-primary">
          下载安装包 (.exe)
        </a>
        <p v-if="windows.caption" class="build-caption">
          {{ windows.caption }} · <a :href="windows.sha256Url">SHA-256</a>
        </p>
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

    <section v-if="releases.length > 0" class="changelog">
      <h2 class="serif changelog-title">更新日志</h2>
      <article v-for="release in visibleReleases" :key="release.version" class="release">
        <header class="release-head">
          <span class="release-version">v{{ release.version }}</span>
          <span v-if="release.kind === 'formal'" class="badge-formal">正式版</span>
          <time class="release-date">{{ release.date }}</time>
        </header>
        <div v-for="group in release.notes" :key="group.title" class="release-group">
          <h3 v-if="group.title" class="release-group-title">{{ group.title }}</h3>
          <ul class="release-items">
            <li v-for="item in group.items" :key="item">{{ item }}</li>
          </ul>
        </div>
        <p class="release-assets">
          <a v-for="link in assetLinks(release)" :key="link.label" :href="link.url">{{ link.label }}</a>
        </p>
      </article>
      <button
        v-if="hiddenReleaseCount > 0"
        type="button"
        class="btn btn-quiet"
        @click="showAllReleases = true"
      >
        查看更早的 {{ hiddenReleaseCount }} 个版本
      </button>
    </section>

    <div class="download-footer">
      <span>源码与正式版存档：</span>
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

.build-caption {
  margin: 10px 0 0;
  font-size: 0.78rem;
  color: var(--t3);
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.build-caption a,
.release-assets a {
  color: var(--zhu);
  text-decoration: none;
}

.build-caption a:hover,
.release-assets a:hover {
  text-decoration: underline;
}

.changelog {
  max-width: 720px;
  margin: 0 auto 2.5rem;
}

.changelog-title {
  font-family: var(--font-serif);
  font-size: 1.4rem;
  font-weight: 700;
  margin: 0 0 0.5rem;
  color: var(--t1);
}

.release {
  padding: 18px 0;
  border-top: 1px solid var(--l2);
}

.release-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 8px;
}

.release-version {
  font-size: 1.05rem;
  font-weight: 600;
  color: var(--t1);
  font-variant-numeric: tabular-nums;
}

.badge-formal {
  font-size: 0.72rem;
  color: var(--zhu);
  background: var(--zhu-wash);
  padding: 2px 6px;
  border-radius: 4px;
  font-weight: 500;
}

.release-date {
  margin-left: auto;
  font-size: 0.8rem;
  color: var(--t3);
  font-variant-numeric: tabular-nums;
}

.release-group-title {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--t3);
  margin: 10px 0 4px;
}

.release-items {
  margin: 0;
  padding-left: 1.2em;
  list-style: disc;
  font-size: 0.9rem;
  line-height: 1.7;
  color: var(--t2);
}

.release-assets {
  display: flex;
  gap: 16px;
  margin: 10px 0 0;
  font-size: 0.8rem;
}

.btn-quiet {
  width: auto;
  margin: 4px auto 0;
  background: transparent;
  color: var(--t2);
  border: 1px solid var(--l2);
}

.btn-quiet:hover {
  color: var(--t1);
}
</style>
